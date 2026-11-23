import { asc, desc, eq, gt, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EMPTY_PROJECT, projectStudy, type ProjectFacts } from "@/domain/project";
import { getClientCard, listClients } from "@/server/clients/directory";
import type { Connection } from "@/server/db/client";
import { auditLog, clients, deals } from "@/server/db/schema";
import { seedDemo } from "@/server/demo/seed";
import { PROJECT_AMOUNT_MAX, projectFactsOf, projectInputSchema } from "@/server/projects/input";
import { getProject, isProjectFile, listProjects, openProject, saveProject } from "@/server/projects/service";
import { testDb } from "../helpers/db";

let c: Connection;
const now = new Date("2026-11-22T09:00:00Z");
const later = new Date("2026-11-22T11:30:00Z");
const afterThat = new Date("2026-11-22T13:00:00Z");
const actor = { userId: null, ip: "10.0.0.7" };
const people: Record<string, number> = {};

beforeAll(async () => {
  c = await testDb();
  await seedDemo(c.db, now);
  for (const row of await c.db.select({ id: clients.id, name: clients.fullName }).from(clients)) people[row.name] = row.id;
});
afterAll(async () => {
  await c.close();
});

const code = async (run: () => Promise<unknown>) => run().then(() => "ok", (error) => error.code ?? String(error));
const params = async (run: () => Promise<unknown>) => run().then(() => null, (error) => error.params);
const row = async (id: number) => (await c.db.select().from(clients).where(eq(clients.id, id)))[0]!;
const files = async () => (await c.db.select({ id: clients.id }).from(clients)).length;
const lastId = async () => (await c.db.select({ id: auditLog.id }).from(auditLog).orderBy(desc(auditLog.id)).limit(1))[0]?.id ?? 0;
const eventsAfter = async (id: number) => c.db.select({ action: auditLog.action, entityId: auditLog.entityId, details: auditLog.details }).from(auditLog).where(gt(auditLog.id, id)).orderBy(asc(auditLog.id));

/** A block of flats on registered land that a company builds. Every figure is made up. */
const FLATS: ProjectFacts = {
  ...EMPTY_PROJECT,
  borrowerType: "company",
  city: "الرياض",
  district: "الملقا",
  landArea: 2400,
  landValue: 30_000_000,
  valuer: "مكتب تقييم معتمد",
  valuationDate: "2026-10-05",
  deed: "registered",
  projectType: "residential",
  purpose: "build",
  constructionCost: 20_000_000,
  gfa: 9600,
  equityCash: 4_000_000,
  hasFeasibility: true,
  hasPermit: true,
};
const input = (over: Record<string, unknown> = {}, facts: Record<string, unknown> = {}) => ({ owner: "شركة البناء الحديث", requested: 14_000_000, facts: { ...FLATS, ...facts }, ...over });

describe("the project the demo starts with", () => {
  it("is one file with no deal, studied on its land and its income", async () => {
    const projects = await listProjects(c.db);
    expect(projects).toHaveLength(1);
    const [project] = projects;
    expect(project!.client).toMatchObject({ fullName: "بندر", fileNo: "C-022", financeType: "project", sector: "self", basicSalary: null, totalSalary: null });
    expect(project!.requested).toBe(66_000_000);
    expect(project!.facts).toMatchObject({ projectType: "hotel", city: "جدة", deed: "registered", keys: 180, hasPermit: true });
    expect(project!.study).toMatchObject({ verdict: "feasible_restructure", ltv: 68.8, ltc: 41.8, equityPct: 64.6, dscr: 0.86, cashoutPart: 4_000_000 });
    expect(project!.study.alerts.map((alert) => alert.code)).toEqual(["INDIVIDUAL_BORROWER", "CASH_ABOVE_LAND_LIMIT", "ABOVE_BUILD_COST", "LOW_COVER"]);
    expect(project!.study.structures.map((way) => way.id)).toEqual(["dev", "tdf", "cashout", "jv", "fund", "prelease"]);
    expect(project!.study.gaps.filter((gap) => gap.critical).map((gap) => gap.code)).toEqual(["STATEMENTS", "CREDIT_REPORT", "USE_OF_FUNDS"]);
    expect(await c.db.select().from(deals).where(eq(deals.clientId, project!.client.id))).toEqual([]);
    const card = await getClientCard(c.db, project!.client.id);
    expect(card!.deals).toEqual([]);
    expect(isProjectFile(card!.client)).toBe(true);
  });

  it("was opened, then changed once, and the log says each without a figure", async () => {
    const events = await c.db.select({ action: auditLog.action, details: auditLog.details }).from(auditLog).where(eq(auditLog.entityId, people["بندر"]!)).orderBy(asc(auditLog.id));
    const ofFile = events.filter((event) => event.action.startsWith("client.") || event.action.startsWith("project."));
    expect(ofFile).toEqual([
      { action: "client.create", details: { fileNo: "C-022" } },
      { action: "project.save", details: { created: true } },
      { action: "project.save", details: { changed: ["hasPermit"] } },
    ]);
  });

  it("reads a salary file as no project", async () => {
    expect(await getProject(c.db, people["سالم"]!)).toBeNull();
    expect(await getProject(c.db, 9999)).toBeNull();
    expect(isProjectFile(await row(people["سالم"]!))).toBe(false);
  });
});

describe("opening a project", () => {
  it("opens a file for the owner, keeps what is known, and answers with the study", async () => {
    const before = await lastId();
    const opened = await openProject(c.db, { input: input(), phone: "055 000 0088", actor, now });
    const client = await row(opened.clientId);
    expect(client).toMatchObject({ fullName: "شركة البناء الحديث", fileNo: "C-023", phone: "966550000088", financeType: "project", requestedAmount: 14_000_000, sector: "self", birthYear: null });
    expect(client.extra).toEqual(FLATS);
    expect(client.createdAt).toEqual(now);
    expect(opened.study).toEqual(projectStudy(FLATS, 14_000_000));
    expect(opened.study).toMatchObject({ verdict: "feasible", ltv: 46.7, ltc: 28, alerts: [] });
    expect(await eventsAfter(before)).toEqual([
      { action: "client.create", entityId: opened.clientId, details: { fileNo: "C-023" } },
      { action: "project.save", entityId: opened.clientId, details: { created: true } },
    ]);
    expect(await c.db.select().from(deals).where(eq(deals.clientId, opened.clientId))).toEqual([]);
    people["شركة البناء الحديث"] = opened.clientId;
  });

  it("opens one without a phone, and with nearly nothing known", async () => {
    const opened = await openProject(c.db, { input: { owner: "مالك أرض", requested: 0, facts: EMPTY_PROJECT }, actor, now });
    const client = await row(opened.clientId);
    expect(client).toMatchObject({ phone: null, requestedAmount: 0, financeType: "project" });
    // With nothing known the study asks for what it needs before it answers.
    expect(opened.study).toMatchObject({ verdict: "needs_info", ltv: null, ltc: null, dscr: null });
    expect((await getProject(c.db, opened.clientId))!.study).toEqual(opened.study);
    people["مالك أرض"] = opened.clientId;
  });

  it("shows in the list of everyone by what it is, where it is and what its study says", async () => {
    const { rows } = await listClients(c.db, { q: "البناء الحديث" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fileNo: "C-023", deal: null, project: { type: "residential", city: "الرياض", district: "الملقا", requested: 14_000_000, verdict: "feasible" } });
    const everyone = (await listClients(c.db)).rows;
    expect(everyone.filter((found) => found.project).map((found) => found.name).sort()).toEqual(["بندر", "شركة البناء الحديث", "مالك أرض"].sort());
    expect(everyone.find((found) => found.name === "سالم")!.project).toBeNull();
  });

  it("refuses a phone that is no number, and one another file holds", async () => {
    const count = await files();
    const before = await lastId();
    expect(await code(() => openProject(c.db, { input: input({ owner: "مالك آخر" }), phone: "12345", actor, now }))).toBe("BAD_PHONE");
    expect(await code(() => openProject(c.db, { input: input({ owner: "مالك آخر" }), phone: "0550000088", actor, now }))).toBe("PHONE_TAKEN");
    expect(await params(() => openProject(c.db, { input: input({ owner: "مالك آخر" }), phone: "+966 55 000 0088", actor, now }))).toEqual({ fileNo: "C-023" });
    // Nothing of a refused opening stays: no file and no line in the log.
    expect(await files()).toBe(count);
    expect(await eventsAfter(before)).toEqual([]);
  });

  it("refuses what is not a project as a person may write it", async () => {
    const count = await files();
    const refused: [string, unknown][] = [
      ["a name of one letter", input({ owner: " ب " })],
      ["no name", input({ owner: undefined })],
      ["a request below nothing", input({ requested: -1 })],
      ["a request beyond any project", input({ requested: PROJECT_AMOUNT_MAX + 1 })],
      ["a request that is no number", input({ requested: Number.NaN })],
      ["a request written as text", input({ requested: "14000000" })],
      ["a kind that does not exist", input({}, { projectType: "tower" })],
      ["a deed that does not exist", input({}, { deed: "gold" })],
      ["half a room", input({}, { keys: 12.5 })],
      ["more nights sold than there are", input({}, { occupancy: 140 })],
      ["a day that is not in the calendar", input({}, { valuationDate: "2026-02-30" })],
      ["a day written another way", input({}, { valuationDate: "05/10/2026" })],
      ["a land worth less than nothing", input({}, { landValue: -5 })],
      ["a yes that is not a yes", input({}, { hasPermit: "yes" })],
      ["facts left out", { owner: "مالك آخر", requested: 1 }],
      ["nothing at all", null],
    ];
    for (const [what, bad] of refused) expect(await code(() => openProject(c.db, { input: bad, actor, now })), what).toBe("INVALID_INPUT");
    expect(await files()).toBe(count);
  });
});

describe("what a person writes, as it is kept", () => {
  it("reads nothing and zero as not known, and tidies a line of text", () => {
    const read = projectInputSchema.parse(input({ owner: "  مالك   أرض  " }, { landValue: 0, keys: 0, city: "  ", district: "  حي   الملقا ", valuer: null, valuationDate: null }));
    expect(read.owner).toBe("مالك   أرض");
    expect(read.facts).toMatchObject({ landValue: null, keys: null, city: null, district: "حي الملقا", valuer: null, valuationDate: null });
    // A missing line is the same as an empty one.
    const { city: _city, ...withoutCity } = FLATS;
    expect(projectInputSchema.parse({ owner: "مالك أرض", requested: 0, facts: withoutCity }).facts.city).toBeNull();
  });

  it("takes the largest amounts and the edges of what is counted", () => {
    const read = projectInputSchema.parse(input({ requested: PROJECT_AMOUNT_MAX }, { landValue: PROJECT_AMOUNT_MAX, occupancy: 100, keys: 100_000, projectType: "hotel" }));
    expect(read).toMatchObject({ requested: PROJECT_AMOUNT_MAX, facts: { landValue: PROJECT_AMOUNT_MAX, occupancy: 100, keys: 100_000 } });
    expect(projectInputSchema.safeParse(input({}, { occupancy: 100.5 })).success).toBe(false);
    expect(projectInputSchema.safeParse(input({}, { keys: 100_001 })).success).toBe(false);
    expect(projectInputSchema.safeParse(input({ owner: "م".repeat(121) })).success).toBe(false);
  });

  it("drops what a project does not hold", () => {
    const read = projectInputSchema.parse({ ...input(), fee: 10, facts: { ...FLATS, basicSalary: 9000 } });
    expect(Object.keys(read).sort()).toEqual(["facts", "owner", "requested"]);
    expect(Object.keys(read.facts).sort()).toEqual(Object.keys(EMPTY_PROJECT).sort());
  });
});

describe("what a file kept before the rebuild reads as", () => {
  const OLD = JSON.stringify({ landArea: 3000, landValue: 45_000_000, constructionCost: null, gfa: null, keys: null, adr: null, occupancy: null, equityCash: null, borrowerType: "individual", city: " الخبر ", district: null, valuer: null, valuationDate: "2026-09-14", deed: "electronic", projectType: "commercial", purpose: "cashout", nearHaram: false, hasPermit: true, hasFeasibility: false, existingLien: true });

  it("reads the text the old system wrote", () => {
    expect(projectFactsOf(OLD)).toEqual({ ...EMPTY_PROJECT, landArea: 3000, landValue: 45_000_000, borrowerType: "individual", city: "الخبر", valuationDate: "2026-09-14", deed: "electronic", projectType: "commercial", purpose: "cashout", hasPermit: true, existingLien: true });
    expect(projectFactsOf(JSON.parse(OLD))).toEqual(projectFactsOf(OLD));
  });

  it("reads each value on its own, and what is not what it should be as not known", () => {
    const odd = { landValue: "45000000", landArea: -3, keys: Number.NaN, adr: 0, deed: "gold", projectType: 7, city: 12, district: "   ", valuationDate: "2026-13-01", nearHaram: "yes", hasPermit: 1, existingLien: true, somethingElse: "x" };
    expect(projectFactsOf(odd)).toEqual({ ...EMPTY_PROJECT, existingLien: true });
    expect(projectFactsOf(JSON.stringify(odd))).toEqual({ ...EMPTY_PROJECT, existingLien: true });
    for (const nothing of [null, undefined, "", "not json", "[1,2]", [1, 2], 42, true]) expect(projectFactsOf(nothing), String(nothing)).toEqual(EMPTY_PROJECT);
  });

  it("studies such a file as it stands, and keeps it in the new shape once saved", async () => {
    const opened = await openProject(c.db, { input: { owner: "مالك قديم", requested: 20_000_000, facts: EMPTY_PROJECT }, actor, now });
    // The old system kept the facts as text. Moved as it is, the column holds one string.
    await c.db.update(clients).set({ extra: sql`to_jsonb(${OLD}::text)` }).where(eq(clients.id, opened.clientId));
    const [kept] = await c.db.select({ as: sql<string>`jsonb_typeof(${clients.extra})` }).from(clients).where(eq(clients.id, opened.clientId));
    expect(kept!.as).toBe("string");
    const project = (await getProject(c.db, opened.clientId))!;
    expect(project.facts).toEqual(projectFactsOf(OLD));
    expect(project.study).toMatchObject({ ltv: 44.4, verdict: "needs_info" });
    expect(project.study.alerts.map((alert) => alert.code)).toEqual(["DEED_UNREGISTERED", "INDIVIDUAL_BORROWER", "EXISTING_LIEN"]);
    // Saving what the page showed changes one fact, and only that one is named.
    const before = await lastId();
    await saveProject(c.db, { clientId: opened.clientId, input: { owner: "مالك قديم", requested: 20_000_000, facts: { ...project.facts, existingLien: false } }, actor, now: later });
    expect(await eventsAfter(before)).toEqual([{ action: "project.save", entityId: opened.clientId, details: { changed: ["existingLien"] } }]);
    expect((await row(opened.clientId)).extra).toEqual({ ...projectFactsOf(OLD), existingLien: false });
  });
});

describe("changing a project", () => {
  it("keeps the change, moves the file's clock, and names what changed without a value", async () => {
    const id = people["شركة البناء الحديث"]!;
    const before = await lastId();
    const saved = await saveProject(c.db, { clientId: id, input: input({ owner: "شركة البناء الحديث المحدودة", requested: 24_000_000 }, { landValue: 32_500_000, purpose: "build_cashout" }), actor, now: afterThat });
    const client = await row(id);
    expect(client).toMatchObject({ fullName: "شركة البناء الحديث المحدودة", requestedAmount: 24_000_000, fileNo: "C-023", phone: "966550000088" });
    expect(client.extra).toEqual({ ...FLATS, landValue: 32_500_000, purpose: "build_cashout" });
    expect(client.updatedAt).toEqual(afterThat);
    expect(client.createdAt).toEqual(now);
    // 24 over 32.5 million is above 70%: the study answers on what was just saved.
    expect(saved.study).toMatchObject({ ltv: 73.8, verdict: "weak", cashoutPart: 4_000_000 });
    expect((await getProject(c.db, id))!.study).toEqual(saved.study);
    const events = await eventsAfter(before);
    expect(events).toEqual([{ action: "project.save", entityId: id, details: { changed: ["owner", "requested", "landValue", "purpose"] } }]);
    expect(JSON.stringify(events)).not.toMatch(/32|24|المحدودة/);
    // The list of everyone shows the new answer, and the file moves to the top.
    const { rows } = await listClients(c.db);
    expect(rows[0]).toMatchObject({ name: "شركة البناء الحديث المحدودة", project: { verdict: "weak", requested: 24_000_000 } });
    people["شركة البناء الحديث"] = id;
  });

  it("writes nothing when nothing changed", async () => {
    const id = people["شركة البناء الحديث"]!;
    const before = await lastId();
    const same = input({ owner: "شركة البناء الحديث المحدودة", requested: 24_000_000 }, { landValue: 32_500_000, purpose: "build_cashout" });
    const saved = await saveProject(c.db, { clientId: id, input: same, actor, now: new Date("2026-11-23T08:00:00Z") });
    expect(saved.study.verdict).toBe("weak");
    expect(await eventsAfter(before)).toEqual([]);
    expect((await row(id)).updatedAt).toEqual(afterThat);
  });

  it("refuses a file that is gone, a file that is no project, and what is not a project", async () => {
    const salaried = await row(people["سالم"]!);
    const before = await lastId();
    expect(await code(() => saveProject(c.db, { clientId: 9999, input: input(), actor, now: later }))).toBe("NOT_FOUND");
    expect(await code(() => saveProject(c.db, { clientId: salaried.id, input: input(), actor, now: later }))).toBe("NOT_A_PROJECT");
    expect(await code(() => saveProject(c.db, { clientId: people["شركة البناء الحديث"]!, input: input({ requested: -1 }), actor, now: later }))).toBe("INVALID_INPUT");
    // A salary file is never turned into a project by a save.
    expect(await row(salaried.id)).toEqual(salaried);
    expect(await eventsAfter(before)).toEqual([]);
  });
});
