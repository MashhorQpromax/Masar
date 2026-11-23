import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { termsOf as termsOfKind, type Product } from "@/domain/eligibility";
import type { Connection } from "@/server/db/client";
import { auditLog, clients, products } from "@/server/db/schema";
import { getDeal, setDealStage } from "@/server/deals/service";
import { roadView } from "@/server/deals/views";
import { seedDemo } from "@/server/demo/seed";
import { applyRoute, getFunding, setSalaryBank } from "@/server/funding/service";
import { confirmTerms, listCatalogue, listProducts, seedCatalogue, updateProductTerms, withdrawTerms } from "@/server/lenders/service";
import { SYSTEM } from "@/server/shared/actor";
import { testDb } from "../helpers/db";

let c: Connection;
const now = new Date("2026-11-22T09:00:00Z");
const ids: Record<string, number> = {};

beforeAll(async () => {
  c = await testDb();
  await seedDemo(c.db, now);
  for (const deal of (await roadView(c.db, now)).deals) ids[deal.clientName] = deal.dealId;
});
afterAll(async () => {
  await c.close();
});

const funding = async (name: string) => (await getFunding(c.db, { dealId: ids[name]!, now }))!;

describe("the lender catalogue", () => {
  it("starts with the base lenders and is filled once only", async () => {
    const all = await listProducts(c.db);
    expect(all).toHaveLength(14);
    expect(all.every((p) => !p.verified && p.settledDefaultWaitMonths == null)).toBe(true);
    expect(await seedCatalogue(c.db)).toEqual({ lenders: 0, products: 0 });
    expect(await listProducts(c.db)).toHaveLength(14);
  });

  it("leaves out a product that was switched off", async () => {
    const [first] = await listProducts(c.db);
    await c.db.update(products).set({ active: false }).where(eq(products.id, Number(first!.id)));
    expect((await listProducts(c.db)).map((p) => p.id)).not.toContain(first!.id);
    await c.db.update(products).set({ active: true }).where(eq(products.id, Number(first!.id)));
  });
});

describe("a lender's terms", () => {
  const termsOf = (p: Awaited<ReturnType<typeof listProducts>>[number]) => ({
    rate: p.rate,
    rateType: p.rateType,
    maxAmount: p.maxAmount,
    maxTenor: p.maxTenor,
    maxAgeAtMaturity: p.maxAgeAtMaturity,
    minSalary: p.minSalary,
    minServiceMonths: p.minServiceMonths,
    maxLtv: p.maxLtv,
    requiresSalaryTransfer: p.requiresSalaryTransfer,
    acceptsLateSimah: p.acceptsLateSimah,
    settledDefaultWaitMonths: p.settledDefaultWaitMonths ?? null,
  });

  it("lists the catalogue lender by lender", async () => {
    const catalogue = await listCatalogue(c.db);
    expect(catalogue).toHaveLength(10);
    expect(catalogue[0]).toMatchObject({ name: "مصرف الراجحي", type: "bank" });
    expect(catalogue[0]!.products.map((p) => p.financeType)).toEqual(["personal", "mortgage", "auto"]);
  });

  it("records a correction and names what changed", async () => {
    const product = (await listProducts(c.db)).find((p) => p.lenderName === "دار التمليك")!;
    const id = Number(product.id);
    const corrected = { ...termsOf(product), rate: 6.1, settledDefaultWaitMonths: 6 };
    expect(await updateProductTerms(c.db, { productId: id, terms: corrected, actor: SYSTEM })).toEqual({ unconfirmed: [] });
    const [row] = await c.db.select().from(products).where(eq(products.id, id));
    expect(row).toMatchObject({ rate: 6.1, settledDefaultWaitMonths: 6, verifiedAt: null });
    const entries = () => c.db.select().from(auditLog).where(eq(auditLog.action, "lender.product_update"));
    expect(await entries()).toMatchObject([{ entity: "product", entityId: id, details: { changed: ["rate", "settledDefaultWaitMonths"], unconfirmed: [] } }]);

    // Saving the same terms again changes nothing and writes nothing.
    await updateProductTerms(c.db, { productId: id, terms: corrected, actor: SYSTEM });
    expect(await entries()).toHaveLength(1);

    // Back to what the catalogue started with.
    await updateProductTerms(c.db, { productId: id, terms: termsOf(product), actor: SYSTEM });
    expect((await c.db.select().from(products).where(eq(products.id, id)))[0]).toMatchObject({ rate: 6.4, settledDefaultWaitMonths: null });
  });

  it("keeps the share of the property's value to mortgages, and refuses terms out of range", async () => {
    const personal = (await listProducts(c.db)).find((p) => p.financeType === "personal")!;
    await updateProductTerms(c.db, { productId: Number(personal.id), terms: { ...termsOf(personal), maxLtv: 80 }, actor: SYSTEM });
    expect((await c.db.select().from(products).where(eq(products.id, Number(personal.id))))[0]!.maxLtv).toBeNull();
    await expect(updateProductTerms(c.db, { productId: Number(personal.id), terms: { ...termsOf(personal), rate: 45 }, actor: SYSTEM })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(updateProductTerms(c.db, { productId: 999999, terms: termsOf(personal), actor: SYSTEM })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("the lenders of a deal", () => {
  it("runs every mortgage lender through the deal's own numbers", async () => {
    const view = await funding("سالم");
    expect(view.routes).toHaveLength(4);
    expect(view.chosen).toBeNull();
    expect(view.offerRecorded).toBe(false);
    // The record was read after the order was paid: a default settled this month, nothing open.
    expect(view.record).toEqual({ known: true, open: false, settledMonthsAgo: 0, delays: false });
    for (const route of view.routes) {
      expect(route.mortgage!.amount).toBeGreaterThan(0);
      expect(route.personal!.amount).toBeGreaterThan(0);
      // Nobody has confirmed any lender's terms yet, and each one says so.
      expect(route.verified).toBe(false);
      expect(route.conditions.some((n) => n.check.code === "SETTLED_UNCONFIRMED")).toBe(true);
    }
    const nets = view.routes.map((r) => r.study.clientNet);
    expect(nets).toEqual([...nets].sort((a, b) => b - a));
  });

  it("asks for a salary transfer only from a bank the salary is not paid into", async () => {
    const view = await funding("سالم");
    const asks = (lender: string) => view.routes.flatMap((r) => r.conditions).some((n) => n.lender === lender && n.check.code === "SALARY_TRANSFER");
    expect(asks("مصرف الراجحي")).toBe(false);
    expect(asks("البنك الأهلي السعودي")).toBe(true);

    await setSalaryBank(c.db, { clientId: view.client.id, bankCode: "snb", actor: SYSTEM, now });
    const moved = await funding("سالم");
    expect(moved.routes.flatMap((r) => r.conditions).some((n) => n.lender === "البنك الأهلي السعودي" && n.check.code === "SALARY_TRANSFER")).toBe(false);
    await expect(setSalaryBank(c.db, { clientId: view.client.id, bankCode: "nowhere", actor: SYSTEM, now })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await setSalaryBank(c.db, { clientId: view.client.id, bankCode: "rajhi", actor: SYSTEM, now });
  });

  it("offers personal lenders only when the deal has no mortgage", async () => {
    const view = await funding("نورة");
    expect(view.routes.length).toBeGreaterThan(4);
    expect(view.routes.every((r) => r.mortgage === null && r.personal !== null)).toBe(true);
  });

  it("puts the chosen lender's terms on the deal and computes it again", async () => {
    const before = await funding("سالم");
    const route = before.routes[0]!;
    const { study } = await applyRoute(c.db, { dealId: ids["سالم"]!, key: route.key, actor: SYSTEM, now });
    expect(study.clientNet).toBe(route.study.clientNet);

    const after = await funding("سالم");
    expect(after.chosen).toBe(route.key);
    expect(after.input).toMatchObject(route.terms);
    expect(after.input.items).toEqual(before.input.items);
    expect(after.deal.clientNet).toBe(route.study.clientNet);
    expect(after.deal.targetBank).toBe(route.mortgage!.product.lenderName);

    const [entry] = await c.db.select().from(auditLog).where(eq(auditLog.action, "deal.route"));
    expect(entry).toMatchObject({ entity: "deal", entityId: ids["سالم"], details: { route: route.key, verified: false } });
  });

  it("does not replace an offer a lender actually gave", async () => {
    const view = await funding("فهد");
    expect(view.offerRecorded).toBe(true);
    await expect(applyRoute(c.db, { dealId: ids["فهد"]!, key: view.routes[0]!.key, actor: SYSTEM, now })).rejects.toMatchObject({ code: "OFFER_RECORDED" });
    expect((await getDeal(c.db, { dealId: ids["فهد"]!, now }))!.input.targetBank).toBe("بنك الراتب");
  });

  it("refuses a route the catalogue no longer has, and a lender that would turn the client down", async () => {
    await expect(applyRoute(c.db, { dealId: ids["ريم"]!, key: "m0-p0", actor: SYSTEM, now })).rejects.toMatchObject({ code: "ROUTE_GONE" });

    // Every lender is now known to wait a year after a default is paid: the deal pays one, so each refuses.
    await c.db.update(products).set({ settledDefaultWaitMonths: 12 });
    const view = await funding("ريم");
    expect(view.routes.every((r) => r.status === "fail" && r.refusals.some((n) => n.check.code === "SETTLED_WAIT"))).toBe(true);
    await expect(applyRoute(c.db, { dealId: ids["ريم"]!, key: view.routes[0]!.key, actor: SYSTEM, now })).rejects.toMatchObject({ code: "ROUTE_REFUSED" });

    // Confirmed to take the client at once, the lenders still refuse: one of her loans was paid late last month.
    await c.db.update(products).set({ settledDefaultWaitMonths: 0 });
    const late = await funding("ريم");
    expect(late.record).toEqual({ known: true, open: false, settledMonthsAgo: 0, delays: true });
    expect(late.routes.every((r) => r.refusals.some((n) => n.check.code === "RECORD_LATE"))).toBe(true);

    // A lender that accepts late payments takes her, on that condition.
    await c.db.update(products).set({ acceptsLateSimah: true });
    const open = await funding("ريم");
    expect(open.routes.every((r) => r.status === "warn" && r.conditions.some((n) => n.check.code === "RECORD_LATE"))).toBe(true);
    await c.db.update(products).set({ acceptsLateSimah: false });
    await c.db.update(products).set({ settledDefaultWaitMonths: null });
  });

  it("leaves a deal that ended as it is", async () => {
    const [client] = await c.db.select({ id: clients.id }).from(clients).where(eq(clients.fullName, "نورة"));
    expect(client).toBeTruthy();
    const view = await funding("نورة");
    for (const stage of ["clearance", "simah_update", "bank_submit", "approval", "disbursement", "recovered", "closed"] as const) {
      await setDealStage(c.db, { dealId: ids["نورة"]!, stage, actor: SYSTEM, now });
    }
    expect((await funding("نورة")).ended).toBe(true);
    await expect(applyRoute(c.db, { dealId: ids["نورة"]!, key: view.routes[0]!.key, actor: SYSTEM, now })).rejects.toMatchObject({ code: "DEAL_ENDED" });
  });

  it("reads every route strictly: no reliable answer until its lenders' terms are confirmed with a source", async () => {
    const valuesOf = (p: Product) => ({
      rate: p.rate,
      rateType: p.rateType,
      maxAmount: p.maxAmount,
      maxTenor: p.maxTenor,
      maxAgeAtMaturity: p.maxAgeAtMaturity,
      minSalary: p.minSalary,
      minServiceMonths: p.minServiceMonths,
      maxLtv: p.maxLtv ?? null,
      requiresSalaryTransfer: p.requiresSalaryTransfer,
      acceptsLateSimah: p.acceptsLateSimah,
      settledDefaultWaitMonths: p.settledDefaultWaitMonths ?? null,
    });
    const paper = { kind: "lender_document", reference: "خطاب شروط التمويل، نوفمبر 2026" };
    const rajhi = (view: Awaited<ReturnType<typeof funding>>) => view.routes.find((r) => r.mortgage?.product.lenderName === "مصرف الراجحي" && r.personal?.product.lenderName === "مصرف الراجحي")!;

    // Nobody confirmed a term: every route needs checking, whatever its numbers say.
    const before = await funding("سالم");
    expect(before.routes.map((r) => r.eligibility)).toEqual(["needs_verification", "needs_verification", "needs_verification", "needs_verification"]);
    const open = rajhi(before);
    expect(open.blockers).toEqual([]);
    expect(open.strength).toBeNull();
    expect(open.doubts.map((d) => [d.finding.term, d.finding.doubt])).toEqual([
      ["salary", "TERM_UNCONFIRMED"],
      ["sector", "TERM_UNCONFIRMED"],
      ["nationality", "TERM_UNCONFIRMED"],
      ["age", "TERM_UNCONFIRMED"],
      ["service", "TERM_UNCONFIRMED"],
      ["transfer", "TERM_UNCONFIRMED"],
      ["settled", "TERM_NOT_KNOWN"],
    ]);

    // The office asks the bank: it takes a client the day a default is paid, and gives its terms in writing.
    const both = [open.mortgage!.product, open.personal!.product];
    for (const product of both) {
      await updateProductTerms(c.db, { productId: Number(product.id), terms: { ...valuesOf(product), settledDefaultWaitMonths: 0 }, actor: SYSTEM });
      await confirmTerms(c.db, { productId: Number(product.id), input: { ...paper, terms: termsOfKind(product.financeType) }, actor: SYSTEM, now });
    }
    const confirmed = await funding("سالم");
    expect(rajhi(confirmed)).toMatchObject({ eligibility: "eligible", verified: true, strength: "written", doubts: [], blockers: [] });
    // A reliable answer is listed before the ones that still need checking.
    expect(confirmed.routes[0]!.key).toBe(open.key);
    expect(confirmed.routes.slice(1).every((r) => r.eligibility === "needs_verification")).toBe(true);

    // What an employee said is a source too, and the answer says it rests on a word.
    await confirmTerms(c.db, { productId: Number(both[1]!.id), input: { kind: "lender_staff", reference: "موظف خدمة العملاء في الفرع الرئيسي", terms: ["service"] }, actor: SYSTEM, now });
    expect(rajhi(await funding("سالم"))).toMatchObject({ eligibility: "eligible", strength: "verbal" });

    // Three months and a day later nobody asked again: the answer is no longer one.
    const stale = rajhi((await getFunding(c.db, { dealId: ids["سالم"]!, now: new Date("2027-02-23T09:00:00Z") }))!);
    expect(stale.eligibility).toBe("needs_verification");
    expect(new Set(stale.doubts.map((d) => d.finding.doubt))).toEqual(new Set(["TERM_EXPIRED"]));

    // The bank now says, in writing, that it waits a year after a paid default. That is a confirmed refusal.
    await updateProductTerms(c.db, { productId: Number(both[0]!.id), terms: { ...valuesOf(both[0]!), settledDefaultWaitMonths: 12 }, actor: SYSTEM });
    expect(rajhi(await funding("سالم")).eligibility).toBe("needs_verification");
    await confirmTerms(c.db, { productId: Number(both[0]!.id), input: { ...paper, terms: ["settled"] }, actor: SYSTEM, now });
    const refused = await funding("سالم");
    expect(rajhi(refused).eligibility).toBe("not_eligible");
    expect(rajhi(refused).blockers.map((b) => [b.lender, b.finding.check.code, b.finding.basis])).toEqual([["مصرف الراجحي", "SETTLED_WAIT", "lender"]]);
    expect(refused.routes.at(-1)!.key).toBe(open.key);
    await expect(applyRoute(c.db, { dealId: ids["سالم"]!, key: open.key, actor: SYSTEM, now })).rejects.toMatchObject({ code: "ROUTE_REFUSED" });

    // Back to a catalogue nobody confirmed.
    for (const product of both) {
      await withdrawTerms(c.db, { productId: Number(product.id), terms: termsOfKind(product.financeType), actor: SYSTEM });
      await updateProductTerms(c.db, { productId: Number(product.id), terms: valuesOf(product), actor: SYSTEM });
    }
    expect((await listProducts(c.db)).every((p) => !p.verified && p.settledDefaultWaitMonths == null)).toBe(true);
  });

  it("answers nothing for a deal that does not exist", async () => {
    expect(await getFunding(c.db, { dealId: 999999, now })).toBeNull();
    await expect(applyRoute(c.db, { dealId: 999999, key: "m1", actor: SYSTEM, now })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
