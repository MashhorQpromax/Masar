import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PaperFact } from "@/domain/eligibility";
import { getAnalysis } from "@/server/analysis/service";
import type { Connection } from "@/server/db/client";
import { auditLog, clients, deals as dealRows, documentFiles, documents } from "@/server/db/schema";
import { roadView } from "@/server/deals/views";
import { seedDemo } from "@/server/demo/seed";
import { fileStanding, relyOnPaper, statePaper } from "@/server/documents/facts";
import { addPaper, addPaperFile, getPapers, movePaperFile, removePaperFile, reviewPaper } from "@/server/documents/service";
import { getFunding } from "@/server/funding/service";
import { SYSTEM } from "@/server/shared/actor";
import { testDb } from "../helpers/db";

/**
 * What a checked paper states, held against the client's file: the figures a person writes down when
 * they find a paper good, the conflict a difference raises on every study of the client, and the two
 * ways out of it.
 */
let c: Connection;
const now = new Date("2026-11-22T09:00:00Z");
const later = new Date("2026-11-22T11:30:00Z");
const deals: Record<string, number> = {};
const people: Record<string, number> = {};
let seed = 0;

beforeAll(async () => {
  c = await testDb();
  await seedDemo(c.db, now);
  for (const row of await c.db.select({ id: clients.id, name: clients.fullName }).from(clients)) people[row.name.split(" ")[0]!] = row.id;
  for (const deal of (await roadView(c.db, now)).deals) deals[deal.clientName] = deal.dealId;
});
afterAll(async () => {
  await c.close();
});

const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ++seed, seed >> 8, 9, 9, 9, 9]);
const view = async (name: string) => (await getPapers(c.db, { dealId: deals[name]!, now }))!;
const paper = async (name: string, code: string) => (await view(name)).list.papers.find((p) => p.code === code)!;
const row = async (paperId: number) => (await c.db.select().from(documents).where(eq(documents.id, paperId)))[0]!;
const fact = async (name: string, of: PaperFact) => (await view(name)).facts.find((reading) => reading.fact === of)!;
const client = async (name: string) => (await c.db.select().from(clients).where(eq(clients.id, people[name]!)))[0]!;
const standing = async (name: string) => fileStanding(c.db, await client(name));
const audits = async (count: number) => (await c.db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(count)).reverse();
const lastAudit = async () => (await audits(1))[0]!;
const auditCount = async () => (await c.db.select({ id: auditLog.id }).from(auditLog)).length;

/** Keeps a file under a paper of a client and finds it good, with the figures written from it. */
async function checked(name: string, code: string, stated?: Record<string, number>): Promise<number> {
  const clientId = people[name]!;
  await addPaperFile(c.db, { clientId, code, file: { name: `${code}.jpg`, bytes: jpeg() }, actor: SYSTEM, now });
  const [kept] = await c.db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.clientId, clientId), eq(documents.code, code)));
  await reviewPaper(c.db, { clientId, paperId: kept!.id, review: { verdict: "verified", ...(stated ? { stated } : {}) }, actor: SYSTEM, now });
  return kept!.id;
}

/** Sends a paper back, so that what was written from it no longer counts. */
const sentBack = async (name: string, paperId: number) => reviewPaper(c.db, { clientId: people[name]!, paperId, review: { verdict: "rejected", note: "للاختبار" }, actor: SYSTEM, now });

describe("the demonstration's files held against their papers", () => {
  it("has a client whose file and identity card give two years of birth", async () => {
    const card = await paper("سالم", "id");
    expect(card).toMatchObject({ status: "verified", stated: { birthYear: 1986 } });
    expect(await fact("سالم", "birthYear")).toEqual({ fact: "birthYear", file: 1989, stated: [{ paperId: card.id, code: "id", label: null, value: 1986 }], state: "conflict", papersAgree: true });
    // His salary certificate was sent back, so nothing stands behind his salary and nothing against it.
    expect(await fact("سالم", "totalSalary")).toMatchObject({ file: 15200, stated: [], state: "unstated" });
    expect(await standing("سالم")).toMatchObject({ disputed: ["birthYear"], incomeProven: false });
  });

  it("has a client whose papers say what the file says", async () => {
    expect((await view("فهد")).facts.map((reading) => [reading.fact, reading.file, reading.state])).toEqual([
      ["totalSalary", 19800, "agrees"],
      ["basicSalary", 14500, "agrees"],
      ["birthYear", 1985, "agrees"],
    ]);
    expect(await standing("فهد")).toMatchObject({ disputed: [], incomeProven: true });
    expect((await paper("فهد", "salary_cert")).stated).toEqual({ totalSalary: 19800, basicSalary: 14500 });
  });

  it("has nothing behind a file whose papers nobody has looked at", async () => {
    expect((await view("ريم")).facts.every((reading) => reading.state === "unstated")).toBe(true);
    expect(await standing("ريم")).toMatchObject({ disputed: [], incomeProven: false });
  });
});

describe("writing down what a paper states", () => {
  const reem = () => people["ريم"]!;

  it("keeps the figures with the verdict, and records them", async () => {
    const paperId = await checked("ريم", "salary_cert", { totalSalary: 14100, basicSalary: 10500 });
    expect((await row(paperId)).stated).toEqual({ totalSalary: 14100, basicSalary: 10500 });
    expect(await paper("ريم", "salary_cert")).toMatchObject({ status: "verified", stated: { totalSalary: 14100, basicSalary: 10500 } });
    expect(await lastAudit()).toMatchObject({ action: "doc.review", entity: "client", entityId: reem(), details: { paper: "salary_cert", verdict: "verified", stated: { totalSalary: 14100, basicSalary: 10500 } } });
    expect(await standing("ريم")).toMatchObject({ disputed: [], incomeProven: true });
    expect((await getAnalysis(c.db, { clientId: reem(), now }))!.file.incomeVerified).toBe(true);
  });

  it("finds a paper good with nothing written, which proves no figure", async () => {
    const paperId = await checked("ريم", "address");
    expect((await row(paperId)).stated).toBeNull();
    expect((await lastAudit()).details).toEqual({ paper: "address", verdict: "verified" });
    const cardId = await checked("ريم", "id");
    expect((await row(cardId)).stated).toBeNull();
    expect(await fact("ريم", "birthYear")).toMatchObject({ stated: [], state: "unstated" });
  });

  it("reads a year typed from the Hijri date as the year it falls in", async () => {
    const card = await paper("ريم", "id");
    await statePaper(c.db, { clientId: reem(), paperId: card.id!, stated: { birthYear: 1401 }, actor: SYSTEM, now });
    expect((await row(card.id!)).stated).toEqual({ birthYear: 1981 });
    expect(await fact("ريم", "birthYear")).toMatchObject({ file: 1981, state: "agrees" });
  });

  it("refuses a figure the paper does not state, one out of range, and a basic salary above the total", async () => {
    const certificate = (await paper("ريم", "salary_cert")).id!;
    const card = (await paper("ريم", "id")).id!;
    const before = await auditCount();
    const state = (paperId: number, stated: unknown) => statePaper(c.db, { clientId: reem(), paperId, stated, actor: SYSTEM, now });
    await expect(state(card, { totalSalary: 14100 })).rejects.toMatchObject({ code: "FIGURE_REFUSED", params: { problem: "NOT_ON_PAPER" } });
    await expect(state(certificate, { birthYear: 1981 })).rejects.toMatchObject({ code: "FIGURE_REFUSED", params: { problem: "NOT_ON_PAPER" } });
    await expect(state(certificate, { totalSalary: 0 })).rejects.toMatchObject({ code: "FIGURE_REFUSED", params: { problem: "OUT_OF_RANGE" } });
    await expect(state(certificate, { totalSalary: -5 })).rejects.toMatchObject({ code: "FIGURE_REFUSED", params: { problem: "OUT_OF_RANGE" } });
    await expect(state(card, { birthYear: 2015 })).rejects.toMatchObject({ code: "FIGURE_REFUSED", params: { problem: "OUT_OF_RANGE" } });
    await expect(state(certificate, { totalSalary: 10500, basicSalary: 14100 })).rejects.toMatchObject({ code: "FIGURE_REFUSED", params: { problem: "BASIC_ABOVE_TOTAL" } });
    // What is not a figure at all never reaches the paper.
    await expect(state(certificate, { totalSalary: "14100" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(state(certificate, { salary: 14100 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(state(card, { birthYear: 1981.5 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(state(certificate, "14100")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    // The same refusals stand when the figures come with the verdict.
    await expect(reviewPaper(c.db, { clientId: reem(), paperId: certificate, review: { verdict: "verified", stated: { birthYear: 1981 } }, actor: SYSTEM, now })).rejects.toMatchObject({ code: "FIGURE_REFUSED", params: { problem: "NOT_ON_PAPER" } });
    expect((await row(certificate)).stated).toEqual({ totalSalary: 14100, basicSalary: 10500 });
    expect(await auditCount()).toBe(before);
  });

  it("corrects what was written, and records what it was", async () => {
    const certificate = (await paper("ريم", "salary_cert")).id!;
    await statePaper(c.db, { clientId: reem(), paperId: certificate, stated: { totalSalary: 14150, basicSalary: 10500 }, actor: SYSTEM, now });
    expect((await row(certificate)).stated).toEqual({ totalSalary: 14150, basicSalary: 10500 });
    expect(await lastAudit()).toMatchObject({
      action: "doc.state",
      entity: "client",
      entityId: reem(),
      details: { paper: "salary_cert", stated: { totalSalary: 14150, basicSalary: 10500 }, before: { totalSalary: 14100, basicSalary: 10500 } },
    });
    // Writing the same figures again changes nothing and records nothing.
    const before = await auditCount();
    await statePaper(c.db, { clientId: reem(), paperId: certificate, stated: { totalSalary: 14150, basicSalary: 10500 }, actor: SYSTEM, now });
    expect(await auditCount()).toBe(before);
  });

  it("takes back what was written when nothing is given", async () => {
    const certificate = (await paper("ريم", "salary_cert")).id!;
    await statePaper(c.db, { clientId: reem(), paperId: certificate, stated: {}, actor: SYSTEM, now });
    expect((await row(certificate)).stated).toBeNull();
    expect(await lastAudit()).toMatchObject({ action: "doc.state", details: { paper: "salary_cert", stated: {}, before: { totalSalary: 14150, basicSalary: 10500 } } });
    expect((await standing("ريم")).incomeProven).toBe(false);
    await statePaper(c.db, { clientId: reem(), paperId: certificate, stated: { totalSalary: 14100, basicSalary: 10500 }, actor: SYSTEM, now });
  });

  it("writes only from a paper that stands as checked, and only for its own client", async () => {
    const waiting = (await paper("سالم", "bank_3")).id!;
    await expect(statePaper(c.db, { clientId: people["سالم"]!, paperId: waiting, stated: {}, actor: SYSTEM })).rejects.toMatchObject({ code: "FIGURE_REFUSED", params: { problem: "NOT_VERIFIED" } });
    const sent = (await paper("سالم", "salary_cert")).id!;
    await expect(statePaper(c.db, { clientId: people["سالم"]!, paperId: sent, stated: { totalSalary: 15200 }, actor: SYSTEM })).rejects.toMatchObject({ code: "FIGURE_REFUSED", params: { problem: "NOT_VERIFIED" } });
    const certificate = (await paper("ريم", "salary_cert")).id!;
    await expect(statePaper(c.db, { clientId: people["سالم"]!, paperId: certificate, stated: { totalSalary: 1 }, actor: SYSTEM })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(statePaper(c.db, { clientId: reem(), paperId: 999999, stated: {}, actor: SYSTEM })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("knows no figure of a paper a person added by name", async () => {
    const { paperId } = await addPaper(c.db, { clientId: reem(), label: "خطاب من جهة العمل", actor: SYSTEM, now });
    const [code] = (await c.db.select({ code: documents.code }).from(documents).where(eq(documents.id, paperId))).map((kept) => kept.code);
    await addPaperFile(c.db, { clientId: reem(), code: code!, file: { name: "خطاب.jpg", bytes: jpeg() }, actor: SYSTEM, now });
    await expect(reviewPaper(c.db, { clientId: reem(), paperId, review: { verdict: "verified", stated: { totalSalary: 9000 } }, actor: SYSTEM, now })).rejects.toMatchObject({ code: "FIGURE_REFUSED", params: { problem: "NOT_ON_PAPER" } });
    await reviewPaper(c.db, { clientId: reem(), paperId, review: { verdict: "verified" }, actor: SYSTEM, now });
    expect(await fact("ريم", "totalSalary")).toMatchObject({ state: "agrees" });
  });
});

describe("figures that no longer count", () => {
  const majed = () => people["ماجد"]!;
  const kept = async (code: string) => (await c.db.select().from(documents).where(and(eq(documents.clientId, majed()), eq(documents.code, code))))[0]!;
  const fileOf = async (paperId: number) => (await c.db.select({ id: documentFiles.id }).from(documentFiles).where(eq(documentFiles.docId, paperId)).orderBy(documentFiles.id)).map((file) => file.id);

  it("are dropped when another file arrives: the paper has to be looked at again", async () => {
    const paperId = await checked("ماجد", "salary_cert", { totalSalary: 16900 });
    expect((await standing("ماجد")).incomeProven).toBe(true);
    await addPaperFile(c.db, { clientId: majed(), code: "salary_cert", file: { name: "صفحة ثانية.jpg", bytes: jpeg() }, actor: SYSTEM, now });
    expect(await kept("salary_cert")).toMatchObject({ id: paperId, status: "received", stated: null });
    expect((await standing("ماجد")).incomeProven).toBe(false);
  });

  it("are dropped when a file of the paper is removed", async () => {
    const paper = await kept("salary_cert");
    await reviewPaper(c.db, { clientId: majed(), paperId: paper.id, review: { verdict: "verified", stated: { totalSalary: 16900 } }, actor: SYSTEM, now });
    const [first] = await fileOf(paper.id);
    await removePaperFile(c.db, { clientId: majed(), fileId: first!, actor: SYSTEM, now });
    expect(await kept("salary_cert")).toMatchObject({ status: "received", stated: null });
  });

  it("are dropped when the paper is sent back", async () => {
    const paper = await kept("salary_cert");
    await reviewPaper(c.db, { clientId: majed(), paperId: paper.id, review: { verdict: "verified", stated: { totalSalary: 12000 } }, actor: SYSTEM, now });
    expect((await standing("ماجد")).disputed).toEqual(["totalSalary"]);
    await sentBack("ماجد", paper.id);
    expect(await kept("salary_cert")).toMatchObject({ status: "rejected", stated: null });
    // A paper that was sent back says nothing: the conflict went with it.
    expect(await standing("ماجد")).toMatchObject({ disputed: [], incomeProven: false });
  });

  it("are dropped on both papers when a file moves from one to the other", async () => {
    const slip = await checked("ماجد", "payslip", { totalSalary: 16900, basicSalary: 12500 });
    const statement = await checked("ماجد", "gosi", { basicSalary: 12500 });
    expect((await standing("ماجد")).readings.map((reading) => reading.state)).toEqual(["agrees", "agrees", "unstated"]);
    const [moved] = await fileOf(statement);
    await movePaperFile(c.db, { clientId: majed(), fileId: moved!, code: "payslip", actor: SYSTEM, now });
    expect(await kept("payslip")).toMatchObject({ id: slip, status: "received", stated: null });
    expect((await kept("gosi")).stated).toBeNull();
    expect((await standing("ماجد")).readings.every((reading) => reading.state === "unstated")).toBe(true);
  });

  it("do not count while they sit beside a paper that is not checked", async () => {
    const slip = await kept("payslip");
    await c.db.update(documents).set({ stated: { totalSalary: 1 } }).where(eq(documents.id, slip.id));
    expect((await standing("ماجد")).disputed).toEqual([]);
    await c.db.update(documents).set({ stated: null }).where(eq(documents.id, slip.id));
  });
});

describe("a conflict on every study of the client", () => {
  it("leaves no lender of the deal answered, and asks it of the file once", async () => {
    const funding = (await getFunding(c.db, { dealId: deals["سالم"]!, now }))!;
    expect(funding.routes.length).toBeGreaterThan(0);
    for (const route of funding.routes) {
      expect(route.eligibility === "needs_verification" || route.eligibility === "not_eligible").toBe(true);
      const raised = route.doubts.filter((doubt) => doubt.finding.check.code === "FACT_CONFLICT");
      expect(raised.map((doubt) => [doubt.lender, doubt.finding.check.params, doubt.finding.doubt])).toEqual([["", { fact: "birthYear" }, "FACT_MISSING"]]);
      // No lender asks it: it is not among what the lenders make a condition of.
      expect([...route.conditions, ...route.refusals].some((note) => note.check.code === "FACT_CONFLICT")).toBe(false);
    }
  });

  it("is the first gap of the analysis, and settling it the first thing to do", async () => {
    const analysis = (await getAnalysis(c.db, { clientId: people["سالم"]!, now }))!.analysis!;
    const card = await paper("سالم", "id");
    expect(card.id).not.toBeNull();
    expect(analysis.gaps[0]).toEqual({ kind: "conflict", code: "CONFLICT", fact: "birthYear", file: 1989, stated: [{ code: "id", label: null, value: 1986 }] });
    expect(analysis.steps[0]).toEqual({ code: "SETTLE_CONFLICTS", facts: ["birthYear"] });
    expect(analysis.verdict).toBe("needs_verification");
    for (const fit of analysis.kinds.flatMap((kind) => kind.today.fits)) expect(fit.doubts.some((doubt) => doubt.check.code === "FACT_CONFLICT")).toBe(true);
    // The salary is not what is in dispute.
    expect(analysis.income.basis).toBe("stated");
  });
});

describe("the file takes what a paper says", () => {
  const rely = (name: string, paperId: number, of: unknown, at: Date = later) => relyOnPaper(c.db, { clientId: people[name]!, paperId, fact: of, actor: SYSTEM, now: at });
  const refused = (problem: string) => ({ code: "RELY_REFUSED", params: { problem } });

  it("refuses a paper that states nothing about the fact, and a fact nothing is in dispute about", async () => {
    const before = await auditCount();
    const card = (await paper("سالم", "id")).id!;
    const address = (await paper("سالم", "address")).id!;
    await expect(rely("سالم", address, "birthYear")).rejects.toMatchObject(refused("NOT_STATED"));
    await expect(rely("سالم", card, "totalSalary")).rejects.toMatchObject(refused("NOT_STATED"));
    // A paper that waits to be looked at, and one that was sent back, state nothing.
    await expect(rely("سالم", (await paper("سالم", "bank_3")).id!, "birthYear")).rejects.toMatchObject(refused("NOT_STATED"));
    await expect(rely("سالم", (await paper("سالم", "salary_cert")).id!, "totalSalary")).rejects.toMatchObject(refused("NOT_STATED"));
    // Another client's paper is not this client's.
    await expect(rely("فهد", card, "birthYear")).rejects.toMatchObject(refused("NOT_STATED"));
    await expect(rely("فهد", (await paper("فهد", "id")).id!, "birthYear")).rejects.toMatchObject(refused("NO_CONFLICT"));
    await expect(rely("سالم", card, "nationality")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(relyOnPaper(c.db, { clientId: 999999, paperId: card, fact: "birthYear", actor: SYSTEM })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await client("سالم")).birthYear).toBe(1989);
    expect(await auditCount()).toBe(before);
  });

  it("takes the year of the card, records it, and computes the deal again", async () => {
    const card = (await paper("سالم", "id")).id!;
    const [deal] = await c.db.select().from(dealRows).where(eq(dealRows.id, deals["سالم"]!));
    expect(deal!.computedAt!.getTime()).toBeLessThan(later.getTime());

    await rely("سالم", card, "birthYear");
    expect((await client("سالم")).birthYear).toBe(1986);
    const [changed, saved] = await audits(2);
    expect(changed).toMatchObject({ action: "client.fact_rely", entity: "client", entityId: people["سالم"], details: { paper: "id", changes: { birthYear: { from: 1989, to: 1986 } } } });
    expect(saved).toMatchObject({ action: "deal.save", entity: "deal", entityId: deals["سالم"] });
    const [after] = await c.db.select().from(dealRows).where(eq(dealRows.id, deals["سالم"]!));
    expect(after!.computedAt).toEqual(later);

    // Nothing is in dispute any more, on the papers, the lenders or the analysis.
    expect(await fact("سالم", "birthYear")).toMatchObject({ file: 1986, state: "agrees" });
    expect((await standing("سالم")).disputed).toEqual([]);
    const funding = (await getFunding(c.db, { dealId: deals["سالم"]!, now }))!;
    expect(funding.routes.some((route) => route.doubts.some((doubt) => doubt.finding.check.code === "FACT_CONFLICT"))).toBe(false);
    const analysis = (await getAnalysis(c.db, { clientId: people["سالم"]!, now }))!.analysis!;
    expect(analysis.gaps.some((gap) => gap.code === "CONFLICT")).toBe(false);
    expect(analysis.steps.some((step) => step.code === "SETTLE_CONFLICTS")).toBe(false);
    // And it cannot be taken twice.
    await expect(rely("سالم", card, "birthYear")).rejects.toMatchObject(refused("NO_CONFLICT"));
  });

  it("takes both salaries of a paper that states both, where both are in dispute", async () => {
    const certificate = (await paper("ريم", "salary_cert")).id!;
    await statePaper(c.db, { clientId: people["ريم"]!, paperId: certificate, stated: { totalSalary: 15000, basicSalary: 11200 }, actor: SYSTEM, now });
    expect((await standing("ريم")).disputed).toEqual(["totalSalary", "basicSalary"]);
    await rely("ريم", certificate, "basicSalary");
    expect(await client("ريم")).toMatchObject({ totalSalary: 15000, basicSalary: 11200 });
    expect((await audits(2))[0]).toMatchObject({
      action: "client.fact_rely",
      details: { paper: "salary_cert", changes: { totalSalary: { from: 14100, to: 15000 }, basicSalary: { from: 10500, to: 11200 } } },
    });
    expect(await standing("ريم")).toMatchObject({ disputed: [], incomeProven: true });
  });

  it("takes only the salary in dispute when the other already agrees", async () => {
    const certificate = (await paper("ريم", "salary_cert")).id!;
    await statePaper(c.db, { clientId: people["ريم"]!, paperId: certificate, stated: { totalSalary: 16000, basicSalary: 11250 }, actor: SYSTEM, now });
    expect((await standing("ريم")).disputed).toEqual(["totalSalary"]);
    await rely("ريم", certificate, "totalSalary");
    expect(await client("ريم")).toMatchObject({ totalSalary: 16000, basicSalary: 11200 });
    expect((await audits(2))[0]!.details).toEqual({ paper: "salary_cert", changes: { totalSalary: { from: 15000, to: 16000 } } });
  });

  it("settles nothing by taking one of two papers that differ", async () => {
    const certificate = (await paper("ريم", "salary_cert")).id!;
    const slip = await checked("ريم", "payslip", { totalSalary: 13000 });
    expect(await fact("ريم", "totalSalary")).toMatchObject({ state: "conflict", papersAgree: false });
    await expect(rely("ريم", certificate, "totalSalary")).rejects.toMatchObject(refused("PAPERS_DISAGREE"));
    await expect(rely("ريم", slip, "totalSalary")).rejects.toMatchObject(refused("PAPERS_DISAGREE"));
    expect((await client("ريم")).totalSalary).toBe(16000);
    // The paper that is wrong goes back, and the dispute goes with it.
    await sentBack("ريم", slip);
    expect((await standing("ريم")).disputed).toEqual([]);
  });

  it("refuses to leave the file with a basic salary above the total", async () => {
    // Only the basic wage is on a GOSI statement. The file's total stays, and it is less.
    const statement = await checked("ريم", "gosi", { basicSalary: 16500 });
    const certificate = (await paper("ريم", "salary_cert")).id!;
    await statePaper(c.db, { clientId: people["ريم"]!, paperId: certificate, stated: { totalSalary: 16000 }, actor: SYSTEM, now });
    expect(await fact("ريم", "basicSalary")).toMatchObject({ file: 11200, state: "conflict", papersAgree: true });
    const before = await auditCount();
    await expect(rely("ريم", statement, "basicSalary")).rejects.toMatchObject(refused("FILE_BASIC_ABOVE_TOTAL"));
    expect((await client("ريم")).basicSalary).toBe(11200);
    expect(await auditCount()).toBe(before);
    await sentBack("ريم", statement);
  });

  it("fills a fact the file left empty, and computes nothing for a client with no deal in progress", async () => {
    const clientId = people["هند"]!;
    await c.db.update(clients).set({ basicSalary: null }).where(eq(clients.id, clientId));
    await addPaperFile(c.db, { clientId, code: "gosi", file: { name: "gosi.jpg", bytes: jpeg() }, actor: SYSTEM, now });
    const [kept] = await c.db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.clientId, clientId), eq(documents.code, "gosi")));
    await reviewPaper(c.db, { clientId, paperId: kept!.id, review: { verdict: "verified", stated: { basicSalary: 8900 } }, actor: SYSTEM, now });
    const held = await standing("هند");
    expect(held.readings.find((reading) => reading.fact === "basicSalary")).toMatchObject({ file: null, state: "conflict", papersAgree: true });
    await relyOnPaper(c.db, { clientId, paperId: kept!.id, fact: "basicSalary", actor: SYSTEM, now: later });
    expect((await client("هند")).basicSalary).toBe(8900);
    // Her deal has ended: the last thing recorded is the change to the file, and no deal was saved after it.
    expect(await lastAudit()).toMatchObject({ action: "client.fact_rely", details: { paper: "gosi", changes: { basicSalary: { from: null, to: 8900 } } } });
  });
});
