import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { experience, rulesByLender, rulesFor } from "@/domain/knowledge";
import type { Connection } from "@/server/db/client";
import { auditLog, clients, deals, lenderRules, lenders, outcomes } from "@/server/db/schema";
import { getDeal } from "@/server/deals/service";
import { roadView } from "@/server/deals/views";
import { seedDemo } from "@/server/demo/seed";
import { getFunding } from "@/server/funding/service";
import { addRule, archiveRule, decisionFacts, getKnowledge, listRules, recentDecisions, recordDecision } from "@/server/knowledge/service";
import { SYSTEM } from "@/server/shared/actor";
import { testDb } from "../helpers/db";

let c: Connection;
const now = new Date("2026-11-22T09:00:00Z");
const ids: Record<string, number> = {};
const lenderOf: Record<string, number> = {};

beforeAll(async () => {
  c = await testDb();
  await seedDemo(c.db, now);
  for (const deal of (await roadView(c.db, now)).deals) ids[deal.clientName] = deal.dealId;
  // The road shows deals in progress. The finished one is found by its client.
  const [done] = await c.db.select({ dealId: deals.id }).from(deals).innerJoin(clients, eq(clients.id, deals.clientId)).where(eq(clients.fullName, "ماجد"));
  ids["ماجد"] = done!.dealId;
  for (const lender of await c.db.select().from(lenders)) lenderOf[lender.name] = lender.id;
});
afterAll(async () => {
  await c.close();
});

const lastEvent = async () => (await c.db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(1))[0]!;
const code = async (work: Promise<unknown>) => work.then(() => "ok", (error: { code?: string }) => error.code ?? "threw");

describe("what the office wrote down about lenders", () => {
  it("starts with what the catalogue knows and what the demo office added", async () => {
    const rules = await listRules(c.db);
    expect(rules).toHaveLength(11);
    const groups = rulesByLender(rules);
    // What holds for every lender comes first.
    expect(groups[0]!.lenderId).toBeNull();
    expect(groups[0]!.rules).toHaveLength(5);
    expect(groups.slice(1).every((group) => group.lenderId != null && group.lenderName)).toBe(true);
    // A note a person wrote carries their name. What the catalogue started with carries none.
    expect(rules.filter((rule) => rule.author).map((rule) => rule.author).sort()).toEqual(["خالد", "منى", "منى"]);
    const rajhi = groups.find((group) => group.lenderName === "مصرف الراجحي")!;
    expect(rajhi.rules.map((rule) => rule.kind)).toEqual(["tip", "condition"]);
  });

  it("gives a route the notes that bear on its lender and its kind of finance", async () => {
    const rules = await listRules(c.db);
    const bearing = rulesFor(rules, { lenderId: lenderOf["البنك السعودي للاستثمار"]!, financeType: "mortgage" });
    expect(bearing[0]!.title).toBe("لا فحص طبي حتى 2.5 مليون");
    expect(bearing.slice(1).every((rule) => rule.lenderId == null && (rule.financeType == null || rule.financeType === "mortgage"))).toBe(true);
    expect(bearing.map((rule) => rule.title)).toContain("الإيقاف أو قرار التنفيذ يغلق كل الجهات");
    expect(bearing.map((rule) => rule.title)).not.toContain("كثرة الاستعلامات تضر");
  });

  it("adds a note, the newest first under its lender, and says so in the log", async () => {
    const lenderId = lenderOf["بنك البلاد"]!;
    const { id } = await addRule(c.db, { rule: { lenderId, financeType: "personal", kind: "condition", title: "  يطلب كشف حساب 6 أشهر للقطاع الخاص  ", body: "  " }, actor: SYSTEM, now });
    const mine = (await listRules(c.db)).filter((rule) => rule.lenderId === lenderId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id, title: "يطلب كشف حساب 6 أشهر للقطاع الخاص", body: null, kind: "condition", financeType: "personal", lenderName: "بنك البلاد", author: null });
    expect(await lastEvent()).toMatchObject({ action: "lender.rule_add", entity: "rule", entityId: id, details: { title: "يطلب كشف حساب 6 أشهر للقطاع الخاص", kind: "condition", lender: "بنك البلاد" } });

    const general = await addRule(c.db, { rule: { lenderId: null, financeType: null, kind: "tip", title: "اطلب خطاب المخالصة مختوماً", body: "بعض الجهات ترفض الخطاب الإلكتروني." }, actor: SYSTEM, now });
    const first = rulesByLender(await listRules(c.db))[0]!;
    expect(first.lenderId).toBeNull();
    expect(first.rules[0]).toMatchObject({ id: general.id, lenderName: null, financeType: null });
  });

  it("refuses a note that says nothing, a kind it does not know and a lender that is not there", async () => {
    const good = { lenderId: null, financeType: null, kind: "tip", title: "ملاحظة صالحة", body: null };
    const before = (await listRules(c.db)).length;
    expect(await code(addRule(c.db, { rule: { ...good, title: " ا " }, actor: SYSTEM }))).toBe("INVALID_INPUT");
    expect(await code(addRule(c.db, { rule: { ...good, kind: "rumour" }, actor: SYSTEM }))).toBe("INVALID_INPUT");
    expect(await code(addRule(c.db, { rule: { ...good, financeType: "barter" }, actor: SYSTEM }))).toBe("INVALID_INPUT");
    expect(await code(addRule(c.db, { rule: { ...good, title: "ط".repeat(121) }, actor: SYSTEM }))).toBe("INVALID_INPUT");
    expect(await code(addRule(c.db, { rule: { ...good, lenderId: 9999 }, actor: SYSTEM }))).toBe("NOT_FOUND");
    expect((await listRules(c.db)).length).toBe(before);
  });

  it("removes a note from the screens once, keeps it stored, and logs who removed it", async () => {
    const { id } = await addRule(c.db, { rule: { lenderId: null, financeType: "auto", kind: "warning", title: "ملاحظة ستُحذف", body: null }, actor: SYSTEM, now });
    await archiveRule(c.db, { ruleId: id, actor: SYSTEM });
    expect((await listRules(c.db)).some((rule) => rule.id === id)).toBe(false);
    expect((await c.db.select().from(lenderRules).where(eq(lenderRules.id, id)))[0]!.active).toBe(false);
    expect(await lastEvent()).toMatchObject({ action: "lender.rule_archive", entity: "rule", entityId: id, details: { title: "ملاحظة ستُحذف" } });
    expect(await code(archiveRule(c.db, { ruleId: id, actor: SYSTEM }))).toBe("NOT_FOUND");
    expect(await code(archiveRule(c.db, { ruleId: 9999, actor: SYSTEM }))).toBe("NOT_FOUND");
  });

  it("does not show a note about a lender that left the catalogue", async () => {
    const lenderId = lenderOf["النايفات للتمويل"]!;
    await addRule(c.db, { rule: { lenderId, financeType: null, kind: "tip", title: "ملاحظة عن جهة ستخرج", body: null }, actor: SYSTEM, now });
    await c.db.update(lenders).set({ active: false }).where(eq(lenders.id, lenderId));
    expect((await listRules(c.db)).some((rule) => rule.lenderId === lenderId)).toBe(false);
    expect(await code(addRule(c.db, { rule: { lenderId, financeType: null, kind: "tip", title: "ملاحظة أخرى", body: null }, actor: SYSTEM }))).toBe("NOT_FOUND");
    await c.db.update(lenders).set({ active: true }).where(eq(lenders.id, lenderId));
    expect((await listRules(c.db)).some((rule) => rule.lenderId === lenderId)).toBe(true);
  });
});

describe("what lenders decided", () => {
  const refusal = (lenderId: number) => ({ lenderId, part: "mortgage", decision: "rejected", approvedAmount: null, asks: [], reason: "simah", note: null, onDeal: false });

  it("starts with the answers of the demo office, added up lender by lender", async () => {
    const facts = await decisionFacts(c.db);
    expect(facts).toHaveLength(18);
    const mortgage = experience(facts, "mortgage");
    const snb = mortgage.get(lenderOf["البنك الأهلي السعودي"]!)!;
    expect(snb).toMatchObject({ n: 4, approved: 3, rejected: 1 });
    expect(snb.conditions[0]).toEqual(["salary_transfer", 3]);
    expect(snb.reasons).toEqual([["employer", 1]]);
    // What it gave against what was expected: 990/990, 760/820 and 600/640.
    expect(snb.ratio).toBe(0.95);
    expect([...experience(facts, "personal").keys()]).toHaveLength(6);
    expect(experience(facts, "auto").size).toBe(0);
    const recent = await recentDecisions(c.db, { limit: 5 });
    expect(recent).toHaveLength(5);
    expect(recent[0]).toMatchObject({ lenderName: "بنك الرياض", decision: "rejected", reason: "simah", financeType: "personal" });
  });

  it("records a refusal with the client's facts as the file holds them, and leaves the deal alone", async () => {
    const dealId = ids["سالم"]!;
    const before = (await getDeal(c.db, { dealId, now }))!;
    const funding = (await getFunding(c.db, { dealId, now }))!;
    const lenderId = lenderOf["مصرف الراجحي"]!;
    const expected = Math.max(...funding.routes.flatMap((route) => (route.mortgage?.product.lenderId === String(lenderId) ? [route.mortgage.amount] : [])));
    const { id, study } = await recordDecision(c.db, { dealId, decision: { ...refusal(lenderId), note: "  طلب مرور ستة أشهر  " }, actor: SYSTEM, now });
    expect(study).toBeNull();
    const [row] = await c.db.select().from(outcomes).where(eq(outcomes.id, id));
    expect(row).toMatchObject({
      clientId: before.client.id,
      lenderId,
      financeType: "mortgage",
      sector: before.client.sector,
      salary: before.client.totalSalary,
      decision: "rejected",
      approvedAmount: null,
      estimatedAmount: expected,
      requestedAmount: before.study.financing.mortgage,
      conditions: [],
      reason: "simah",
      note: "طلب مرور ستة أشهر",
    });
    expect(row!.age).toBe(now.getFullYear() - before.client.birthYear!);
    expect(["clean", "late", "default", "unknown"]).toContain(row!.simah);
    expect(await lastEvent()).toMatchObject({ action: "lender.decision", entity: "client", entityId: before.client.id, details: { lender: "مصرف الراجحي", part: "mortgage", decision: "rejected", onDeal: false } });
    const after = (await getDeal(c.db, { dealId, now }))!;
    expect(after.input).toEqual(before.input);
    expect((await recentDecisions(c.db, { clientId: before.client.id })).map((line) => line.id)).toEqual([id]);
  });

  it("puts an approved amount on the deal when asked, and the deal is computed on it", async () => {
    const dealId = ids["ريم"]!;
    const before = (await getDeal(c.db, { dealId, now }))!;
    expect(before.input.bankMortgage ?? null).toBeNull();
    const lenderId = lenderOf["البنك الأهلي السعودي"]!;
    const approved = Math.round((before.study.financing.mortgage * 0.9) / 1000) * 1000;
    const answer = await recordDecision(c.db, {
      dealId,
      decision: { lenderId, part: "mortgage", decision: "approved_modified", approvedAmount: approved, asks: ["valuation", "medical", "valuation"], reason: "simah", note: null, onDeal: true },
      actor: SYSTEM,
      now,
    });
    const [row] = await c.db.select().from(outcomes).where(eq(outcomes.id, answer.id));
    // What was asked is kept once each, and a yes carries no reason for a refusal.
    expect(row).toMatchObject({ decision: "approved_modified", approvedAmount: approved, conditions: ["valuation", "medical"], reason: null, requestedAmount: before.study.financing.mortgage });
    const after = (await getDeal(c.db, { dealId, now }))!;
    expect(after.input.bankMortgage).toBe(approved);
    expect(after.study.financing.mortgage).toBe(approved);
    expect(after.study.financing.source).toBe("bank");
    expect(answer.study?.financing.mortgage).toBe(approved);
    expect((await getFunding(c.db, { dealId, now }))!.offerRecorded).toBe(true);
    expect(await lastEvent()).toMatchObject({ action: "lender.decision", details: { decision: "approved_modified", onDeal: true } });
  });

  it("records an approval without touching the deal when not asked to", async () => {
    const dealId = ids["فهد"]!;
    const before = (await getDeal(c.db, { dealId, now }))!;
    const lenderId = lenderOf["مصرف الإنماء"]!;
    const { id, study } = await recordDecision(c.db, { dealId, decision: { lenderId, part: "personal", decision: "approved", approvedAmount: 150000, asks: ["salary_transfer"], reason: null, note: null, onDeal: false }, actor: SYSTEM, now });
    expect(study).toBeNull();
    expect((await getDeal(c.db, { dealId, now }))!.input).toEqual(before.input);
    const [row] = await c.db.select().from(outcomes).where(eq(outcomes.id, id));
    expect(row).toMatchObject({ financeType: "personal", approvedAmount: 150000, conditions: ["salary_transfer"] });
  });

  it("refuses an answer that does not hold together, and records nothing", async () => {
    const dealId = ids["سالم"]!;
    const lenderId = lenderOf["مصرف الراجحي"]!;
    const count = async () => (await c.db.select({ id: outcomes.id }).from(outcomes)).length;
    const before = await count();
    const yes = { lenderId, part: "mortgage", decision: "approved", approvedAmount: 500000, asks: [], reason: null, note: null, onDeal: false };
    // A yes says how much.
    expect(await code(recordDecision(c.db, { dealId, decision: { ...yes, approvedAmount: null }, actor: SYSTEM, now }))).toBe("INVALID_INPUT");
    expect(await code(recordDecision(c.db, { dealId, decision: { ...yes, approvedAmount: -5 }, actor: SYSTEM, now }))).toBe("INVALID_INPUT");
    expect(await code(recordDecision(c.db, { dealId, decision: { ...yes, decision: "maybe" }, actor: SYSTEM, now }))).toBe("INVALID_INPUT");
    expect(await code(recordDecision(c.db, { dealId, decision: { ...yes, asks: ["a_kidney"] }, actor: SYSTEM, now }))).toBe("INVALID_INPUT");
    expect(await code(recordDecision(c.db, { dealId, decision: { ...yes, part: "auto" }, actor: SYSTEM, now }))).toBe("INVALID_INPUT");
    expect(await code(recordDecision(c.db, { dealId, decision: { ...yes, lenderId: 9999 }, actor: SYSTEM, now }))).toBe("NOT_FOUND");
    expect(await code(recordDecision(c.db, { dealId: 9999, decision: yes, actor: SYSTEM, now }))).toBe("NOT_FOUND");
    // نورة's deal has no mortgage in it.
    expect(await code(recordDecision(c.db, { dealId: ids["نورة"]!, decision: yes, actor: SYSTEM, now }))).toBe("INVALID_INPUT");
    expect(await count()).toBe(before);
  });

  it("keeps a finished deal's numbers, and still takes what the lender answered", async () => {
    const dealId = ids["ماجد"]!;
    const before = (await getDeal(c.db, { dealId, now }))!;
    const lenderId = lenderOf["البنك الأهلي السعودي"]!;
    const count = async () => (await c.db.select({ id: outcomes.id }).from(outcomes)).length;
    const had = await count();
    const yes = { lenderId, part: "mortgage", decision: "approved", approvedAmount: 123000, asks: [], reason: null, note: null, onDeal: true };
    // The whole step is undone: no answer is kept for a deal that could not take it.
    expect(await code(recordDecision(c.db, { dealId, decision: yes, actor: SYSTEM, now }))).toBe("DEAL_ENDED");
    expect(await count()).toBe(had);
    await recordDecision(c.db, { dealId, decision: { ...yes, onDeal: false }, actor: SYSTEM, now });
    expect(await count()).toBe(had + 1);
    expect((await getDeal(c.db, { dealId, now }))!.input).toEqual(before.input);
  });

  it("gathers what the knowledge page shows", async () => {
    const view = await getKnowledge(c.db);
    expect(view.lenders).toHaveLength(10);
    expect(view.recent.length).toBeLessThanOrEqual(12);
    expect(view.recent[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(view.recent.at(-1)!.createdAt.getTime());
    expect(view.facts.length).toBeGreaterThan(18);
    expect(view.rules.length).toBeGreaterThan(11);
    // Nothing on this page names a client.
    expect(JSON.stringify(view)).not.toMatch(/سالم|ريم|فهد|ماجد|نورة|هند/);
  });
});
