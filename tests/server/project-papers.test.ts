import { and, asc, eq, gt } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyReport } from "@/domain/credit";
import { EMPTY_PROJECT, type ProjectFacts } from "@/domain/project";
import { listClients } from "@/server/clients/directory";
import { addCreditReport } from "@/server/credit/service";
import type { Connection } from "@/server/db/client";
import { auditLog, clients, documents, notes } from "@/server/db/schema";
import { rejectDeal, reopenDeal } from "@/server/deals/service";
import { seedDemo } from "@/server/demo/seed";
import { addPaperFile, removePaperFile, reviewPaper } from "@/server/documents/service";
import { checkedPapers, getProjectPapers, projectFile } from "@/server/projects/papers";
import { getProject, listProjects, openProject, saveProject } from "@/server/projects/service";
import { testDb } from "../helpers/db";

let c: Connection;
const now = new Date("2026-11-23T09:00:00Z");
const later = new Date("2026-11-23T10:00:00Z");
const actor = { userId: null, ip: "10.0.0.7" };
const people: Record<string, number> = {};

/** Land on a paper deed with nothing else in hand yet. Every figure is made up. */
const LAND: ProjectFacts = { ...EMPTY_PROJECT, borrowerType: "individual", city: "الطائف", deed: "paper", landValue: 40_000_000, constructionCost: 20_000_000, gfa: 9000 };
const input = (owner: string, facts: Partial<ProjectFacts> = {}) => ({ owner, requested: 15_000_000, facts: { ...LAND, ...facts } });

beforeAll(async () => {
  c = await testDb();
  await seedDemo(c.db, now);
  for (const row of await c.db.select({ id: clients.id, name: clients.fullName }).from(clients)) people[row.name] = row.id;
  people["مالك"] = (await openProject(c.db, { input: input("مالك"), actor, now })).clientId;
  people["شركة"] = (await openProject(c.db, { input: input("شركة", { borrowerType: "company" }), actor, now })).clientId;
});
afterAll(async () => {
  await c.close();
});

const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4\n${text}\n%%EOF\n`);
const code = async (run: () => Promise<unknown>) =>
  run().then(
    () => "ok",
    (error) => error.code ?? String(error),
  );
const lastId = async () => (await c.db.select({ id: auditLog.id }).from(auditLog).orderBy(asc(auditLog.id))).at(-1)?.id ?? 0;
const eventsAfter = async (id: number) => c.db.select({ action: auditLog.action, details: auditLog.details }).from(auditLog).where(gt(auditLog.id, id)).orderBy(asc(auditLog.id));
const paperId = async (clientId: number, paper: string) =>
  (
    await c.db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.clientId, clientId), eq(documents.code, paper)))
  )[0]!.id;
/** Sends one made-up page for a paper and, when asked, says it is good. */
async function send(clientId: number, paper: string, verdict?: "verified" | "rejected"): Promise<number> {
  const { fileId } = await addPaperFile(c.db, { clientId, code: paper, file: { name: `${paper}.pdf`, bytes: pdf(`${clientId} ${paper}`) }, actor, now });
  if (verdict) await reviewPaper(c.db, { clientId, paperId: await paperId(clientId, paper), review: verdict === "verified" ? { verdict } : { verdict, note: "غير واضح" }, actor, now });
  return fileId;
}
const critical = async (clientId: number) => (await getProject(c.db, clientId))!.study.gaps.filter((gap) => gap.critical).map((gap) => gap.code);
const state = (list: { papers: { code: string; status: string }[] }) => Object.fromEntries(list.papers.map((paper) => [paper.code, paper.status]));

describe("the papers of the demo's project", () => {
  it("holds the file against what a lender asks of a person's project", async () => {
    const view = (await getProjectPapers(c.db, people["بندر"]!))!;
    expect(view.rejected).toBe(false);
    expect(view.facts).toMatchObject({ projectType: "hotel", borrowerType: "individual" });
    expect(state(view.list)).toEqual({
      id: "missing",
      address: "missing",
      simah: "missing",
      obligations: "missing",
      bank_12: "rejected",
      deed: "verified",
      valuation: "verified",
      permit: "verified",
      lien: "missing",
      zoning: "missing",
      feasibility: "received",
      boq: "missing",
      sources_uses: "missing",
    });
    expect(view.list).toMatchObject({ required: 10, missing: 6, verified: 3, toCheck: 1 });
    expect(view.list.papers.find((paper) => paper.code === "bank_12")!.note).toMatch(/اثنا عشر شهراً/);
    // The owner brings the valuation of a project. Nothing on the list is the office's to bring.
    expect(view.list.papers.every((paper) => paper.by === "client")).toBe(true);
  });

  it("stops the study asking for what was checked, and leaves what waits or was sent back", async () => {
    const project = (await getProject(c.db, people["بندر"]!))!;
    expect(project.checked.sort()).toEqual(["deed", "permit", "valuation"]);
    expect(project.held).toEqual(["DEED_COPY", "PERMIT", "VALUATION_REPORT"]);
    expect(project.study.gaps.map((gap) => gap.code)).toEqual(["STATEMENTS", "CREDIT_REPORT", "OWNER_CASH", "USE_OF_FUNDS", "OPERATOR_LETTER"]);
    expect(project.study.verdict).toBe("feasible_restructure");
    expect(project.rejected).toBe(false);
  });

  it("is no project's file for a salary file, or for a file that is not there", async () => {
    expect(await getProjectPapers(c.db, people["سالم"]!)).toBeNull();
    expect(await getProjectPapers(c.db, 9999)).toBeNull();
    expect(await projectFile(c.db, people["سالم"]!)).toBeNull();
    expect(await projectFile(c.db, 9999)).toBeNull();
    expect(await projectFile(c.db, people["بندر"]!)).toEqual({ rejected: false });
    expect(await checkedPapers(c.db, [])).toEqual(new Map());
  });
});

describe("a checked paper answers its gap", () => {
  it("starts with everything owed and no verdict", async () => {
    const id = people["مالك"]!;
    expect(await critical(id)).toEqual(["DEED_COPY", "FEASIBILITY", "PERMIT", "VALUATION_REPORT", "STATEMENTS", "CREDIT_REPORT", "OWNER_CASH", "USE_OF_FUNDS"]);
    const project = (await getProject(c.db, id))!;
    expect(project).toMatchObject({ checked: [], held: [], rejected: false });
    expect(project.study.verdict).toBe("needs_info");
    expect((await getProjectPapers(c.db, id))!.list).toMatchObject({ required: 10, missing: 10, verified: 0, toCheck: 0 });
  });

  it("answers nothing while it only arrived, or was sent back", async () => {
    const id = people["مالك"]!;
    await send(id, "deed");
    expect(await critical(id)).toContain("DEED_COPY");
    await reviewPaper(c.db, { clientId: id, paperId: await paperId(id, "deed"), review: { verdict: "rejected", note: "صورة غير واضحة" }, actor, now });
    expect(await critical(id)).toContain("DEED_COPY");
    expect((await getProject(c.db, id))!.held).toEqual([]);
  });

  it("answers its gap once a person says it is good, and owes it again when its file is taken out", async () => {
    const id = people["مالك"]!;
    await reviewPaper(c.db, { clientId: id, paperId: await paperId(id, "deed"), review: { verdict: "verified" }, actor, now });
    expect((await getProject(c.db, id))!.held).toEqual(["DEED_COPY"]);
    expect(await critical(id)).not.toContain("DEED_COPY");
    // The copy of a paper deed does not put the land in the register: that still blocks.
    expect((await getProject(c.db, id))!.study.alerts.map((alert) => alert.code)).toContain("DEED_UNREGISTERED");

    const [file] = (await getProjectPapers(c.db, id))!.list.papers.find((paper) => paper.code === "deed")!.files;
    await removePaperFile(c.db, { clientId: id, fileId: file!.id, actor, now });
    expect((await getProject(c.db, id))!.held).toEqual([]);
    expect(await critical(id)).toContain("DEED_COPY");
  });

  it("reaches a verdict when enough is answered, and says the same wherever the file is listed", async () => {
    const id = people["مالك"]!;
    for (const paper of ["deed", "feasibility", "permit", "valuation"]) await send(id, paper, "verified");
    expect(await critical(id)).toEqual(["STATEMENTS", "CREDIT_REPORT", "OWNER_CASH", "USE_OF_FUNDS"]);
    expect((await getProject(c.db, id))!.study.verdict).toBe("needs_info");

    await send(id, "bank_12", "verified");
    const project = (await getProject(c.db, id))!;
    expect(project.held).toEqual(["DEED_COPY", "FEASIBILITY", "PERMIT", "VALUATION_REPORT", "STATEMENTS"]);
    expect(project.study.verdict).toBe("feasible");
    expect((await listProjects(c.db)).find((found) => found.client.id === id)!.study).toEqual(project.study);
    expect((await listClients(c.db, { q: "مالك" })).rows.find((row) => row.id === id)!.project).toMatchObject({ verdict: "feasible", rejected: false });
  });

  it("counts the owner's credit report once it was read into the record", async () => {
    const id = people["مالك"]!;
    expect(await critical(id)).toContain("CREDIT_REPORT");
    await addCreditReport(c.db, { clientId: id, consent: true, reading: { report: { ...emptyReport(), reportDate: "2026/11/20" }, warnings: [], confidence: "high" }, actor, now });
    expect((await getProject(c.db, id))!.checked).toContain("simah");
    expect(await critical(id)).not.toContain("CREDIT_REPORT");
    expect(state((await getProjectPapers(c.db, id))!.list).simah).toBe("verified");
  });

  it("asks a company for its own statements and report before it lets the gap go", async () => {
    const id = people["شركة"]!;
    const list = (await getProjectPapers(c.db, id))!.list;
    expect(list.papers.filter((paper) => paper.required).map((paper) => paper.code)).toEqual(expect.arrayContaining(["cr", "fin_statements", "zakat", "simah_company"]));
    await send(id, "bank_12", "verified");
    expect(await critical(id)).toContain("STATEMENTS");
    await send(id, "fin_statements", "verified");
    expect(await critical(id)).not.toContain("STATEMENTS");
    await addCreditReport(c.db, { clientId: id, consent: true, reading: { report: { ...emptyReport(), reportDate: "2026/11/20" }, warnings: [], confidence: "high" }, actor, now });
    expect(await critical(id)).toContain("CREDIT_REPORT");
    await send(id, "simah_company", "verified");
    expect(await critical(id)).not.toContain("CREDIT_REPORT");
  });

  it("reads each file against its own papers only", async () => {
    const checked = await checkedPapers(c.db, [people["مالك"]!, people["شركة"]!, people["بندر"]!]);
    expect(checked.get(people["مالك"]!)!.sort()).toEqual(["bank_12", "deed", "feasibility", "permit", "simah", "valuation"]);
    expect(checked.get(people["شركة"]!)!.sort()).toEqual(["bank_12", "fin_statements", "simah", "simah_company"]);
    expect(checked.get(people["بندر"]!)!.sort()).toEqual(["deed", "permit", "valuation"]);
  });

  it("follows who borrows: papers that answered a person's gap may not answer a company's", async () => {
    const id = people["مالك"]!;
    await saveProject(c.db, { clientId: id, input: input("مالك", { borrowerType: "company" }), actor, now: later });
    expect(await critical(id)).toEqual(expect.arrayContaining(["STATEMENTS", "CREDIT_REPORT"]));
    await saveProject(c.db, { clientId: id, input: input("مالك"), actor, now: later });
    expect(await critical(id)).toEqual(["OWNER_CASH", "USE_OF_FUNDS"]);
  });
});

describe("rejecting a project's file, and reopening it", () => {
  it("marks the file, keeps the reason, and says so wherever the file is listed", async () => {
    const id = people["مالك"]!;
    const before = await lastId();
    await rejectDeal(c.db, { clientId: id, reason: "المطلوب فوق ما تموله الجهات", actor, now: later });
    const project = (await getProject(c.db, id))!;
    expect(project.rejected).toBe(true);
    // The study still reads as it stood: rejecting a file changes no number in it.
    expect(project.study.verdict).toBe("feasible");
    expect((await getProjectPapers(c.db, id))!.rejected).toBe(true);
    expect(await projectFile(c.db, id)).toEqual({ rejected: true });
    expect((await listClients(c.db, { q: "مالك" })).rows.find((row) => row.id === id)!.project).toMatchObject({ rejected: true });
    const [note] = await c.db.select({ kind: notes.kind, body: notes.body }).from(notes).where(eq(notes.clientId, id));
    expect(note).toEqual({ kind: "status", body: "المطلوب فوق ما تموله الجهات" });
    expect(await eventsAfter(before)).toEqual([{ action: "client.reject", details: { from: "study", reason: "المطلوب فوق ما تموله الجهات", dealId: null } }]);
  });

  it("changes nothing in a rejected file", async () => {
    const id = people["مالك"]!;
    const [row] = await c.db.select().from(clients).where(eq(clients.id, id));
    const before = await lastId();
    expect(await code(() => saveProject(c.db, { clientId: id, input: input("مالك", { landValue: 90_000_000 }), actor, now: later }))).toBe("FILE_REJECTED");
    expect((await c.db.select().from(clients).where(eq(clients.id, id)))[0]).toEqual(row);
    expect(await eventsAfter(before)).toEqual([]);
    // Its papers stay as they were.
    expect((await getProjectPapers(c.db, id))!.list.verified).toBe(6);
  });

  it("goes back under study with what changed, and takes changes again", async () => {
    const id = people["مالك"]!;
    const before = await lastId();
    await reopenDeal(c.db, { clientId: id, note: "دخل شريك برأس مال", actor, now: later });
    expect((await getProject(c.db, id))!.rejected).toBe(false);
    expect(await eventsAfter(before)).toEqual([{ action: "client.reopen", details: { from: "rejected" } }]);
    expect(await code(() => saveProject(c.db, { clientId: id, input: input("مالك", { equityCash: 5_000_000 }), actor, now: later }))).toBe("ok");
    expect(await critical(id)).toEqual(["USE_OF_FUNDS"]);
  });
});
