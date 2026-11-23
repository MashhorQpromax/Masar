import { asc, desc, eq, gt } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { termsOf } from "@/domain/eligibility";
import { getAnalysis } from "@/server/analysis/service";
import { answerCondition, answersOf, getAsked } from "@/server/clients/conditions";
import type { Connection } from "@/server/db/client";
import { auditLog, clients, conditionAnswers, productConditions, termSources } from "@/server/db/schema";
import { getDeal, reviseDeal } from "@/server/deals/service";
import { roadView } from "@/server/deals/views";
import { seedDemo } from "@/server/demo/seed";
import { getFunding } from "@/server/funding/service";
import { addCondition, addLender, addProduct, confirmTerms, listCatalogue, listProducts, removeCondition, updateProductTerms } from "@/server/lenders/service";
import { testDb } from "../helpers/db";

/**
 * A lender's special conditions, from the day one is written down to the day a client is answered
 * for: what is kept, what each change does to the confirmation of the list, and what every reading of
 * the lender says at each step.
 */
let c: Connection;
const now = new Date("2026-11-22T09:00:00Z");
const actor = { userId: null, ip: "10.0.0.7" };
const LENDER = "شركة الاختبار للتمويل";
const paper = { kind: "lender_document", reference: "خطاب شروط التمويل، نوفمبر 2026" };
const deal: Record<string, number> = {};
const people: Record<string, number> = {};
let productId = 0;

beforeAll(async () => {
  c = await testDb();
  await seedDemo(c.db, now);
  for (const found of (await roadView(c.db, now)).deals) deal[found.clientName] = found.dealId;
  for (const row of await c.db.select({ id: clients.id, name: clients.fullName }).from(clients)) people[row.name] = row.id;
  // A lender that takes the client as she is: no salary transfer, a paid default taken at once, every term in writing.
  const { lenderId } = await addLender(c.db, { input: { name: LENDER, type: "finance_company" }, actor });
  const added = await addProduct(c.db, {
    lenderId,
    input: {
      financeType: "personal",
      scope: { name: "تمويل نقدي", sectors: ["gov", "semi_gov", "military"], nationalities: ["saudi"], minAge: 21 },
      terms: { rate: 5.5, rateType: "flat", maxAmount: 400_000, maxTenor: 60, maxAgeAtMaturity: 65, minSalary: 4000, minServiceMonths: 3, maxLtv: null, requiresSalaryTransfer: false, acceptsLateSimah: true, settledDefaultWaitMonths: 0 },
    },
    actor,
  });
  productId = added.productId;
  await confirmTerms(c.db, { productId, input: { ...paper, terms: termsOf("personal") }, actor, now });
});
afterAll(async () => {
  await c.close();
});

const code = async (run: () => Promise<unknown>) => run().then(() => "ok", (error) => error.code ?? String(error));
const params = async (run: () => Promise<unknown>) => run().then(() => null, (error) => error.params);
const lastId = async () => (await c.db.select({ id: auditLog.id }).from(auditLog).orderBy(desc(auditLog.id)).limit(1))[0]?.id ?? 0;
const eventsAfter = async (id: number) => c.db.select({ action: auditLog.action, entity: auditLog.entity, entityId: auditLog.entityId, details: auditLog.details }).from(auditLog).where(gt(auditLog.id, id)).orderBy(asc(auditLog.id));
const seen = async () => (await listProducts(c.db, { now })).find((p) => p.id === String(productId))!;
const special = async () => (await seen()).terms!.special!.state;
const confirmList = () => confirmTerms(c.db, { productId, input: { ...paper, terms: ["special"] }, actor, now });
/** The way to fund her deal through the lender under test. */
const route = async (name = "نورة") => (await getFunding(c.db, { dealId: deal[name]!, now }))!.routes.find((r) => r.personal?.product.lenderName === LENDER)!;
const doubts = async (name = "نورة") => (await route(name)).doubts.map((d) => d.finding.check.code);

describe("writing a lender's special conditions down", () => {
  it("starts with an empty list that is a term like the others", async () => {
    const product = await seen();
    expect(product.special).toEqual([]);
    expect(product.verified).toBe(true);
    expect((await route()).eligibility).toBe("eligible");
  });

  it("keeps a condition, holds every client against it, and takes the list's confirmation back", async () => {
    const before = await lastId();
    const added = await addCondition(c.db, { productId, input: { kind: "min_amount", amount: 20000 }, actor });
    expect(added.unconfirmed).toBe(true);
    expect((await seen()).special).toEqual([{ id: String(added.conditionId), kind: "min_amount", amount: 20000 }]);
    expect(await special()).toBe("unconfirmed");
    expect((await seen()).verified).toBe(false);
    expect(await eventsAfter(before)).toEqual([
      {
        action: "lender.condition_add",
        entity: "product",
        entityId: productId,
        details: { lender: LENDER, product: "تمويل نقدي", condition: { id: added.conditionId, kind: "min_amount", amount: 20000 }, unconfirmed: true },
      },
    ]);
    // The source confirmed another list: until someone reads this one in a source, nothing rests on it.
    expect([(await route()).eligibility, await doubts()]).toEqual(["needs_verification", ["SPECIAL_LIST"]]);
    await confirmList();
    expect((await route()).eligibility).toBe("eligible");
    // The other terms kept their sources.
    expect(await c.db.select({ term: termSources.term }).from(termSources).where(eq(termSources.productId, productId))).toHaveLength(termsOf("personal").length);
  });

  it("writes each kind with only what it measures or asks, and the catalogue shows them in order", async () => {
    const limit = await addCondition(c.db, { productId, input: { kind: "inquiries", count: 3, months: 6 }, actor });
    // Confirmed again, then changed again: an addition to a list nobody confirmed drops nothing.
    expect(limit.unconfirmed).toBe(true);
    const post = await addCondition(c.db, { productId, input: { kind: "contract", contracts: ["fixed_term", "permanent"] }, actor });
    expect(post.unconfirmed).toBe(false);
    const rows = await c.db.select().from(productConditions).where(eq(productConditions.productId, productId)).orderBy(asc(productConditions.id));
    expect(rows.map((row) => [row.kind, row.amount, row.count, row.months, row.contracts, row.text, row.unmet, row.active])).toEqual([
      ["min_amount", 20000, null, null, null, null, "block", true],
      ["inquiries", null, 3, 6, null, null, "block", true],
      ["contract", null, null, null, ["permanent", "fixed_term"], null, "block", true],
    ]);
    const kept = (await listCatalogue(c.db, { now })).flatMap((lender) => lender.products).find((p) => p.id === String(productId))!;
    expect(kept.special!.map((condition) => condition.kind)).toEqual(["min_amount", "inquiries", "contract"]);
  });

  it("refuses a condition the list already holds, one that asks nothing, and what is not a condition", async () => {
    const before = await lastId();
    const rows = () => c.db.select({ id: productConditions.id }).from(productConditions).where(eq(productConditions.productId, productId));
    const count = (await rows()).length;
    const refused: [unknown, string, string?][] = [
      [{ kind: "min_amount", amount: 30000 }, "CONDITION_REFUSED", "TWICE"],
      [{ kind: "inquiries", count: 5, months: 6 }, "CONDITION_REFUSED", "TWICE"],
      [{ kind: "contract", contracts: ["permanent"] }, "CONDITION_REFUSED", "TWICE"],
      [{ kind: "min_amount", amount: 500 }, "INVALID_INPUT"],
      [{ kind: "inquiries", count: 3, months: 9 }, "INVALID_INPUT"],
      [{ kind: "inquiries", count: -1, months: 6 }, "INVALID_INPUT"],
      [{ kind: "contract", contracts: [] }, "INVALID_INPUT"],
      [{ kind: "contract", contracts: ["seasonal"] }, "INVALID_INPUT"],
      [{ kind: "other", text: " ", unmet: "block" }, "INVALID_INPUT"],
      [{ kind: "guarantor", text: "كفيل", unmet: "maybe" }, "INVALID_INPUT"],
      [{ kind: "medical", text: "فحص طبي", unmet: "block" }, "INVALID_INPUT"],
      [null, "INVALID_INPUT"],
    ];
    for (const [input, expected, problem] of refused) {
      expect(await code(() => addCondition(c.db, { productId, input, actor })), JSON.stringify(input)).toBe(expected);
      if (problem) expect(await params(() => addCondition(c.db, { productId, input, actor }))).toEqual({ problem });
    }
    expect(await code(() => addCondition(c.db, { productId: 999999, input: { kind: "min_amount", amount: 20000 }, actor }))).toBe("NOT_FOUND");
    expect(await rows()).toHaveLength(count);
    expect(await eventsAfter(before)).toEqual([]);
  });

  it("refuses a least amount above the most the product lends, and a lender that takes every contract", async () => {
    const other = (await listProducts(c.db, { now })).find((p) => p.lenderName !== LENDER && p.financeType === "personal")!;
    const id = Number(other.id);
    expect(await params(() => addCondition(c.db, { productId: id, input: { kind: "min_amount", amount: other.maxAmount + 1 }, actor }))).toEqual({ problem: "ABOVE_MOST" });
    expect(await params(() => addCondition(c.db, { productId: id, input: { kind: "contract", contracts: ["permanent", "fixed_term", "probation"] }, actor }))).toEqual({ problem: "EVERY_CONTRACT" });
    expect((await listProducts(c.db, { now })).find((p) => p.id === other.id)!.special).toEqual([]);
  });
});

describe("what the engine measures for each client", () => {
  it("reads the contract from the file and the inquiries from the record", async () => {
    await confirmList();
    // She has a permanent post and two inquiries in six months.
    expect((await route()).eligibility).toBe("eligible");
    // The same lender refuses a record with five, for certain: its list is confirmed.
    const analysis = (await getAnalysis(c.db, { clientId: people["ريم"]!, now }))!.analysis!;
    const busy = analysis.kinds.flatMap((kind) => [...kind.today.fits, ...(kind.cleared?.fits ?? [])]).filter((fit) => fit.product.id === String(productId));
    expect(busy.length).toBeGreaterThan(0);
    for (const fit of busy) {
      expect(fit.eligibility).toBe("not_eligible");
      expect(fit.blockers.map((blocker) => blocker.check.code)).toContain("INQUIRIES");
    }
  });

  it("needs checking when the file does not say how the client is employed", async () => {
    await c.db.update(clients).set({ contractType: null }).where(eq(clients.id, people["نورة"]!));
    expect([(await route()).eligibility, await doubts()]).toEqual(["needs_verification", ["CONTRACT_MISSING"]]);
    const analysis = (await getAnalysis(c.db, { clientId: people["نورة"]!, now }))!.analysis!;
    expect(analysis.gaps).toContainEqual({ kind: "missing", code: "CONTRACT" });
  });

  it("keeps the kind of contract with the facts a deal is computed from", async () => {
    const view = (await getDeal(c.db, { dealId: deal["نورة"]!, now }))!;
    const { client, input } = view;
    const borrower = { fullName: client.fullName, birthYear: client.birthYear, sector: client.sector, basicSalary: client.basicSalary, totalSalary: client.totalSalary, serviceMonths: client.serviceMonths };
    const before = await lastId();
    await reviseDeal(c.db, { dealId: deal["نورة"]!, borrower: { ...borrower, contractType: "probation" }, input, actor, now });
    expect((await c.db.select().from(clients).where(eq(clients.id, client.id)))[0]!.contractType).toBe("probation");
    expect((await eventsAfter(before)).find((event) => event.action === "client.update")!.details).toEqual({ changed: ["contractType"] });
    // On probation the lender refuses her: it takes a permanent or a fixed-term contract.
    const refused = await route();
    expect([refused.eligibility, refused.blockers.map((b) => b.finding.check.code)]).toEqual(["not_eligible", ["CONTRACT"]]);
    // A form that does not send the contract leaves it as it is. One that sends none clears it. What is not a contract is refused.
    await reviseDeal(c.db, { dealId: deal["نورة"]!, borrower, input, actor, now });
    expect((await c.db.select().from(clients).where(eq(clients.id, client.id)))[0]!.contractType).toBe("probation");
    expect(await code(() => reviseDeal(c.db, { dealId: deal["نورة"]!, borrower: { ...borrower, contractType: "seasonal" }, input, actor, now }))).toBe("INVALID_INPUT");
    await reviseDeal(c.db, { dealId: deal["نورة"]!, borrower: { ...borrower, contractType: "permanent" }, input, actor, now });
    expect((await route()).eligibility).toBe("eligible");
  });
});

describe("what a person answers for each client", () => {
  let guarantor = 0;
  let employer = 0;

  it("lists what the lenders ask about a client, unanswered", async () => {
    expect((await getAsked(c.db, { clientId: people["نورة"]! }))!).toMatchObject({ client: { fileNo: "C-017", fullName: "نورة" }, lenders: [], open: 0 });
    guarantor = (await addCondition(c.db, { productId, input: { kind: "guarantor", text: "  موظف   حكومي ", unmet: "action" }, actor })).conditionId;
    employer = (await addCondition(c.db, { productId, input: { kind: "employer", unmet: "block" }, actor })).conditionId;
    await confirmList();
    const view = (await getAsked(c.db, { clientId: people["نورة"]! }))!;
    expect(view.open).toBe(2);
    expect(view.lenders.map((lender) => [lender.name, lender.products.map((p) => [p.name, p.financeType])])).toEqual([[LENDER, [["تمويل نقدي", "personal"]]]]);
    // Only what a person answers is listed: the engine answers the rest itself.
    expect(view.lenders[0]!.products[0]!.conditions).toEqual([
      { id: guarantor, kind: "guarantor", text: "موظف حكومي", unmet: "action", answer: null, answeredAt: null, answeredBy: null },
      { id: employer, kind: "employer", text: null, unmet: "block", answer: null, answeredAt: null, answeredBy: null },
    ]);
    expect(await getAsked(c.db, { clientId: 999999 })).toBeNull();
  });

  it("never takes an unanswered question as met, though the list is confirmed", async () => {
    expect([(await route()).eligibility, await doubts()]).toEqual(["needs_verification", ["ASKED_OPEN", "ASKED_OPEN"]]);
    const analysis = (await getAnalysis(c.db, { clientId: people["نورة"]!, now }))!.analysis!;
    expect(analysis.steps.filter((step) => step.code === "ASK_CLIENT")).toContainEqual({
      code: "ASK_CLIENT",
      lender: LENDER,
      questions: [
        { kind: "guarantor", text: "موظف حكومي" },
        { kind: "employer", text: null },
      ],
      // Her record has an order to pay first, so the client is asked before anything is paid for her.
      beforePaying: true,
    });
    const steps = analysis.steps.map((step) => step.code);
    expect(steps.indexOf("ASK_CLIENT")).toBeLessThan(steps.indexOf("CREDIT"));
  });

  it("keeps an answer with who gave it, and every reading of the lender follows it", async () => {
    const before = await lastId();
    await answerCondition(c.db, { clientId: people["نورة"]!, conditionId: guarantor, answer: "met", actor, now });
    await answerCondition(c.db, { clientId: people["نورة"]!, conditionId: employer, answer: "met", actor, now });
    expect(await answersOf(c.db, people["نورة"]!)).toEqual({ [guarantor]: "met", [employer]: "met" });
    expect((await eventsAfter(before))[0]).toEqual({
      action: "client.condition_answer",
      entity: "client",
      entityId: people["نورة"]!,
      details: { lender: LENDER, product: "تمويل نقدي", condition: guarantor, kind: "guarantor", answer: "met", before: null },
    });
    expect((await route()).eligibility).toBe("eligible");
    const view = (await getAsked(c.db, { clientId: people["نورة"]! }))!;
    expect(view.open).toBe(0);
    expect(view.lenders[0]!.products[0]!.conditions.map((condition) => [condition.answer, condition.answeredAt])).toEqual([
      ["met", now],
      ["met", now],
    ]);
    // An answer is about one client. Nobody answered for him.
    expect(await answersOf(c.db, people["سالم"]!)).toEqual({});
    expect((await getAsked(c.db, { clientId: people["سالم"]! }))!.open).toBe(2);
  });

  it("reads an unmet condition by what the lender does about it", async () => {
    // No guarantor yet: something to bring.
    await answerCondition(c.db, { clientId: people["نورة"]!, conditionId: guarantor, answer: "unmet", actor, now });
    const asked = await route();
    expect([asked.eligibility, asked.actions.map((a) => a.finding.check.code)]).toEqual(["conditional", ["ASKED"]]);
    // An employer the lender does not list: a refusal no figure overrides.
    await answerCondition(c.db, { clientId: people["نورة"]!, conditionId: employer, answer: "unmet", actor, now });
    const refused = await route();
    expect([refused.eligibility, refused.blockers.map((b) => b.finding.check.code)]).toEqual(["not_eligible", ["ASKED"]]);
  });

  it("replaces an answer, takes one back, and writes nothing when nothing changed", async () => {
    const before = await lastId();
    await answerCondition(c.db, { clientId: people["نورة"]!, conditionId: employer, answer: "unmet", actor, now });
    expect(await eventsAfter(before)).toEqual([]);
    await answerCondition(c.db, { clientId: people["نورة"]!, conditionId: employer, answer: "met", actor, now });
    await answerCondition(c.db, { clientId: people["نورة"]!, conditionId: guarantor, answer: null, actor, now });
    expect((await eventsAfter(before)).map((event) => event.details)).toMatchObject([
      { condition: employer, answer: "met", before: "unmet" },
      { condition: guarantor, answer: null, before: "unmet" },
    ]);
    expect(await answersOf(c.db, people["نورة"]!)).toEqual({ [employer]: "met" });
    expect(await c.db.select().from(conditionAnswers).where(eq(conditionAnswers.clientId, people["نورة"]!))).toHaveLength(1);
    expect([(await route()).eligibility, await doubts()]).toEqual(["needs_verification", ["ASKED_OPEN"]]);
    await answerCondition(c.db, { clientId: people["نورة"]!, conditionId: guarantor, answer: null, actor, now });
    expect(await eventsAfter(before)).toHaveLength(2);
  });

  it("refuses an answer to what the engine measures, to a client or a condition that is not there", async () => {
    const [measured] = await c.db.select({ id: productConditions.id }).from(productConditions).where(eq(productConditions.kind, "min_amount"));
    expect(await code(() => answerCondition(c.db, { clientId: people["نورة"]!, conditionId: measured!.id, answer: "met", actor, now }))).toBe("INVALID_INPUT");
    expect(await code(() => answerCondition(c.db, { clientId: 999999, conditionId: guarantor, answer: "met", actor, now }))).toBe("NOT_FOUND");
    expect(await code(() => answerCondition(c.db, { clientId: people["نورة"]!, conditionId: 999999, answer: "met", actor, now }))).toBe("NOT_FOUND");
  });

  it("takes a condition off the list, and what was answered for it answers nothing any more", async () => {
    const before = await lastId();
    expect(await removeCondition(c.db, { conditionId: employer, actor })).toEqual({ unconfirmed: true });
    expect((await eventsAfter(before))[0]).toEqual({
      action: "lender.condition_remove",
      entity: "product",
      entityId: productId,
      details: { lender: LENDER, product: "تمويل نقدي", condition: { id: employer, kind: "employer", text: null, unmet: "block" }, unconfirmed: true },
    });
    // The row stays, with the answer that was given for it.
    expect((await c.db.select().from(productConditions).where(eq(productConditions.id, employer)))[0]!.active).toBe(false);
    expect(await c.db.select().from(conditionAnswers).where(eq(conditionAnswers.conditionId, employer))).toHaveLength(1);
    expect(await answersOf(c.db, people["نورة"]!)).toEqual({});
    expect((await seen()).special!.map((condition) => condition.kind)).toEqual(["min_amount", "inquiries", "contract", "guarantor"]);
    expect(await special()).toBe("unconfirmed");
    expect(await code(() => answerCondition(c.db, { clientId: people["نورة"]!, conditionId: employer, answer: "met", actor, now }))).toBe("NOT_FOUND");
    // Taking it off again changes nothing and writes nothing.
    const again = await lastId();
    expect(await removeCondition(c.db, { conditionId: employer, actor })).toEqual({ unconfirmed: false });
    expect(await eventsAfter(again)).toEqual([]);
    expect(await code(() => removeCondition(c.db, { conditionId: 999999, actor }))).toBe("NOT_FOUND");
    // The same question can be written again, and it starts unanswered.
    const written = await addCondition(c.db, { productId, input: { kind: "employer", unmet: "block" }, actor });
    expect((await getAsked(c.db, { clientId: people["نورة"]! }))!.lenders[0]!.products[0]!.conditions.map((condition) => [condition.id, condition.answer])).toEqual([
      [guarantor, null],
      [written.conditionId, null],
    ]);
  });

  it("does not ask about a product that was stopped", async () => {
    const { setProductActive } = await import("@/server/lenders/service");
    await setProductActive(c.db, { productId, active: false, actor });
    expect((await getAsked(c.db, { clientId: people["نورة"]! }))!).toMatchObject({ lenders: [], open: 0 });
    await setProductActive(c.db, { productId, active: true, actor });
    expect((await getAsked(c.db, { clientId: people["نورة"]! }))!.open).toBe(2);
  });

  it("asks a person about a stored condition the engine cannot measure, and never drops it", async () => {
    // A row from a newer build, or one damaged in storage: it is still something the lender asks.
    const [odd] = await c.db.insert(productConditions).values({ productId, kind: "inquiries", count: 2, months: 9 }).returning({ id: productConditions.id });
    const [unknown] = await c.db.insert(productConditions).values({ productId, kind: "medical", text: "فحص طبي" }).returning({ id: productConditions.id });
    const special = (await seen()).special!;
    expect(special.slice(-2)).toEqual([
      { id: String(odd!.id), kind: "other", text: null, unmet: "block" },
      { id: String(unknown!.id), kind: "other", text: "فحص طبي", unmet: "block" },
    ]);
    await c.db.delete(productConditions).where(gt(productConditions.id, odd!.id - 1));
  });
});

// Last in this file: it adds a lender to the catalogue the readings above were made against.
describe("a least amount and the most a product lends", () => {
  it("refuses to lower the most under a least amount written for the product, until the condition is taken off", async () => {
    const terms = { rate: 4.1, rateType: "flat", maxAmount: 300_000, maxTenor: 60, maxAgeAtMaturity: 65, minSalary: 4000, minServiceMonths: 3, maxLtv: null, requiresSalaryTransfer: false, acceptsLateSimah: false, settledDefaultWaitMonths: null };
    const { lenderId } = await addLender(c.db, { input: { name: "جهة ثانية للاختبار", type: "bank" }, actor });
    const { productId: id } = await addProduct(c.db, { lenderId, input: { financeType: "personal", scope: { name: "تمويل", sectors: ["gov"], nationalities: ["saudi"], minAge: 21 }, terms }, actor });
    const { conditionId } = await addCondition(c.db, { productId: id, input: { kind: "min_amount", amount: 50_000 }, actor });
    const lower = (maxAmount: number) => updateProductTerms(c.db, { productId: id, terms: { ...terms, maxAmount }, actor });
    const before = await lastId();
    expect(await code(() => lower(40_000))).toBe("AMOUNT_BELOW_LEAST");
    expect(await params(() => lower(40_000))).toEqual({ least: "50000" });
    // Nothing was kept and nothing was written to the log.
    expect((await listProducts(c.db, { now })).find((p) => p.id === String(id))!.maxAmount).toBe(300_000);
    expect(await eventsAfter(before)).toEqual([]);
    // Down to the least itself is still a product that lends something.
    expect(await code(() => lower(50_000))).toBe("ok");
    await removeCondition(c.db, { conditionId, actor });
    expect(await code(() => lower(40_000))).toBe("ok");
    expect((await listProducts(c.db, { now })).find((p) => p.id === String(id))!.maxAmount).toBe(40_000);
  });
});
