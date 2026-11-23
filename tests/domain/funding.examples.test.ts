import { describe, expect, it } from "vitest";
import { analyzeCredit, emptyReport, type CreditReport, type Facility } from "@/domain/credit";
import { dealStudy, defaultDealInput, type Borrower, type DealInput, type DealItem } from "@/domain/deal";
import type { Product } from "@/domain/eligibility";
import { fundingRoutes, knownRecord, recordAfterSettlement, recordChecks, type Applicant, type RecordAfter } from "@/domain/funding";

/** Worked examples of how lenders are held against a deal, small enough to check by hand. */
const borrower: Borrower = { age: 35, basicSalary: 12000, totalSalary: 16000, serviceMonths: 120, sector: "gov" };

const items: DealItem[] = [
  { id: "a", kind: "execution", label: "قرار تنفيذ", original: 100000, pay: 100000, by: "company" },
  { id: "b", kind: "default", label: "تعثر", original: 50000, pay: 40000, by: "company" },
  { id: "c", kind: "mortgage_payoff", label: "مخالصة العقاري", original: 400000, pay: 380000, by: "company", confirmed: true },
  { id: "d", kind: "personal_payoff", label: "مخالصة الشخصي", original: 60000, pay: 60000, by: "bank", monthly: 2000 },
];

const deal: DealInput = { ...defaultDealInput(), items, propertyValue: 800000, transferTaxPct: 0, fixedCosts: 10000 };

const product = (id: string, lender: string, parts: Partial<Product>): Product => ({
  id,
  lenderId: lender,
  lenderName: `جهة ${lender}`,
  lenderType: "bank",
  bankCode: lender,
  financeType: "personal",
  name: "منتج",
  minSalary: 4000,
  minAge: 21,
  maxAgeAtMaturity: 65,
  minServiceMonths: 3,
  sectors: ["gov", "military", "semi_gov"],
  nationalities: ["saudi"],
  maxTenor: 60,
  maxAmount: 2_000_000,
  rate: 3.2,
  rateType: "flat",
  requiresSalaryTransfer: true,
  acceptsLateSimah: false,
  maxLtv: null,
  notes: null,
  settledDefaultWaitMonths: 0,
  verified: true,
  ...parts,
});

const mortgageOf = (id: string, lender: string, parts: Partial<Product> = {}): Product =>
  product(id, lender, { financeType: "mortgage", maxAgeAtMaturity: 70, maxTenor: 300, maxAmount: 5_000_000, rate: 5, rateType: "reducing", maxLtv: 90, ...parts });

const clean: RecordAfter = { known: true, open: false, settledMonthsAgo: null, delays: false };
const who = (parts: Partial<Applicant> = {}): Applicant => ({ nationality: "saudi", salaryBank: "a", record: clean, ...parts });

describe("the record a lender will read after the settlement", () => {
  const report = (facilities: Partial<Facility>[], parts: Partial<CreditReport> = {}): CreditReport => ({
    ...emptyReport(),
    facilities: facilities.map((f) => ({ lender: "بنك", creditorType: "bank", product: "تمويل شخصي", status: "current", ...f })),
    ...parts,
  });
  const known = (r: CreditReport) => knownRecord(r, analyzeCredit(r));
  /** These reports give no count of inquiries, which is not a count of none. */
  const none = { m6: null, m12: null };

  it("shows a default paid just now when the deal settles one and no report was read", () => {
    expect(recordAfterSettlement(deal, null)).toEqual({ known: false, open: false, settledMonthsAgo: 0, delays: false, inquiries: null });
  });

  it("stays open when an order is left outside the deal", () => {
    const left = items.map((i) => (i.id === "a" ? { ...i, by: "out" as const } : i));
    expect(recordAfterSettlement({ ...deal, items: left }, null).open).toBe(true);
  });

  it("stays open when the report shows an unpaid default and the deal pays none", () => {
    const unpaid = known(report([{ status: "default", defaultAmount: 30000, defaultNow: 30000 }]));
    expect(unpaid).toEqual({ unpaid: true, settledMonthsAgo: null, delays: false, inquiries: none });
    const payoffsOnly = { ...deal, items: [items[2]!, items[3]!] };
    expect(recordAfterSettlement(payoffsOnly, unpaid).open).toBe(true);
    // The same record with a deal that pays its orders reads as settled today.
    expect(recordAfterSettlement(deal, unpaid)).toEqual({ known: true, open: false, settledMonthsAgo: 0, delays: false, inquiries: none });
  });

  it("keeps the age of a default that was paid before the deal", () => {
    const paid = known(report([{ status: "settled", defaultAmount: 30000, defaultNow: 0, settledMonthsAgo: 8 }]));
    expect(paid).toEqual({ unpaid: false, settledMonthsAgo: 8, delays: false, inquiries: none });
    expect(recordAfterSettlement({ ...deal, items: [items[2]!, items[3]!] }, paid).settledMonthsAgo).toBe(8);
  });

  it("no longer counts a default paid two years ago or more", () => {
    expect(known(report([{ status: "settled", defaultAmount: 30000, settledMonthsAgo: 24 }])).settledMonthsAgo).toBeNull();
    expect(known(report([{ status: "settled", defaultAmount: 30000, settledMonthsAgo: 23 }])).settledMonthsAgo).toBe(23);
  });

  it("carries recent late payments, which paying a debt off does not remove", () => {
    const late = known(report([{ worstDelay: 60, lastDelayMonthsAgo: 2 }]));
    expect(late.delays).toBe(true);
    expect(recordAfterSettlement(deal, late)).toEqual({ known: true, open: false, settledMonthsAgo: 0, delays: true, inquiries: none });
  });
});

describe("whether a lender takes that record", () => {
  const p = (parts: Partial<Product>) => product("1", "a", parts);
  const settled = (monthsAgo: number): RecordAfter => ({ ...clean, settledMonthsAgo: monthsAgo });
  const outcome = (lender: Product, record: RecordAfter) => recordChecks(lender, record).map((c) => `${c.code}:${c.status}`);

  it("passes a clean record", () => {
    expect(outcome(p({}), clean)).toEqual(["RECORD_CLEAN:pass"]);
  });

  it("refuses an open default whatever the lender", () => {
    expect(outcome(p({ acceptsLateSimah: true, settledDefaultWaitMonths: 0 }), { ...clean, open: true })).toEqual(["RECORD_OPEN:fail"]);
  });

  it("takes a paid default at once when the lender is known to", () => {
    expect(outcome(p({ settledDefaultWaitMonths: 0 }), settled(0))).toEqual(["SETTLED_ACCEPTED:pass"]);
  });

  it("says how many months are left when the lender waits", () => {
    expect(recordChecks(p({ settledDefaultWaitMonths: 12 }), settled(0))).toEqual([{ key: "simah", status: "fail", code: "SETTLED_WAIT", params: { months: 12 } }]);
    expect(recordChecks(p({ settledDefaultWaitMonths: 12 }), settled(8))).toEqual([{ key: "simah", status: "fail", code: "SETTLED_WAIT", params: { months: 4 } }]);
    expect(outcome(p({ settledDefaultWaitMonths: 12 }), settled(12))).toEqual(["SETTLED_ACCEPTED:pass"]);
  });

  it("makes it a condition to confirm when nobody has asked the lender", () => {
    expect(outcome(p({ settledDefaultWaitMonths: null }), settled(0))).toEqual(["SETTLED_UNCONFIRMED:warn"]);
  });

  it("holds late payments against a lender that does not accept them", () => {
    expect(outcome(p({}), { ...clean, delays: true })).toEqual(["RECORD_LATE:fail"]);
    expect(outcome(p({ acceptsLateSimah: true }), { ...clean, delays: true })).toEqual(["RECORD_LATE:warn"]);
    expect(outcome(p({ settledDefaultWaitMonths: 0 }), { ...settled(0), delays: true })).toEqual(["SETTLED_ACCEPTED:pass", "RECORD_LATE:fail"]);
  });

  it("asks for the report when none was read", () => {
    expect(outcome(p({}), { ...clean, known: false })).toEqual(["RECORD_UNKNOWN:warn"]);
    expect(outcome(p({}), { ...settled(0), known: false })).toEqual(["SETTLED_ACCEPTED:pass", "RECORD_UNKNOWN:warn"]);
  });
});

describe("the routes that fund a deal", () => {
  // Bank a: the salary bank, both products. Bank b: cheaper on both. Company c: personal only, no salary transfer.
  const a1 = product("1", "a", { rate: 3.4 });
  const a2 = mortgageOf("2", "a", { rate: 5.2 });
  const b1 = product("3", "b", { rate: 3.2 });
  const b2 = mortgageOf("4", "b", { rate: 5 });
  const c1 = product("5", "c", { lenderType: "finance_company", bankCode: null, rate: 6.5, maxAmount: 250000, requiresSalaryTransfer: false });
  const d2 = mortgageOf("6", "d", { rate: 4.9 });
  const products = [a1, a2, b1, b2, c1, d2];

  const routes = fundingRoutes({ input: deal, borrower, who: who(), products });

  it("gives one route per mortgage product, each with the personal product that serves it best", () => {
    expect(routes.map((r) => r.key)).toEqual(["m4-p3", "m2-p1", "m6-p5"]);
  });

  it("lends what the property and the salary carry on the lender's own terms", () => {
    const best = routes[0]!;
    // 90 percent of 800,000, and a third of the salary for 60 months at 3.2 percent flat: 5,333 x 60 / 1.16.
    expect(best.mortgage).toMatchObject({ amount: 720000, months: 300, installment: 4209, atCeiling: false });
    expect(best.personal).toMatchObject({ amount: 275845, months: 60, installment: 5333, atCeiling: false });
    expect(best.closes).toBe(true);
    expect(best.verified).toBe(true);
  });

  it("ranks by what the client keeps and says what each lender asks", () => {
    expect(routes[0]!.study.clientNet).toBeGreaterThan(routes[1]!.study.clientNet);
    // Bank b is not where the salary goes: taking it means moving the salary. Bank a asks nothing.
    expect(routes[0]!.conditions.map((n) => n.check.code)).toEqual(["SALARY_TRANSFER"]);
    expect(routes[0]!.status).toBe("warn");
    expect(routes[1]!.conditions).toEqual([]);
    expect(routes[1]!.status).toBe("pass");
  });

  it("never pairs two lenders that both want the salary", () => {
    // Bank d has no personal product. A bank's personal finance would need the salary too, so the company's stands.
    const lone = routes[2]!;
    expect(lone.personal!.product.id).toBe("5");
    expect(lone.oneLender).toBe(false);
    expect(lone.personal).toMatchObject({ amount: 241494, atCeiling: false });
    const forced = fundingRoutes({ input: deal, borrower, who: who(), products: [b1, d2] })[0]!;
    expect(forced.refusals.map((n) => n.check.code)).toEqual(["TWO_SALARY_TRANSFERS"]);
    expect(forced.status).toBe("fail");
  });

  it("writes terms that give the same study when they are put on the deal", () => {
    for (const r of routes) {
      expect(dealStudy({ ...deal, ...r.terms, bankMortgage: null, bankPersonal: null }, borrower)).toEqual(r.study);
    }
    expect(routes[0]!.terms).toEqual({
      targetBank: "جهة b",
      mortgageApr: 5,
      mortgageMaxAge: 70,
      mortgageMaxMonths: 300,
      ltvPct: 90,
      mortgageCeiling: 5_000_000,
      personalFlat: 3.2,
      personalMonths: 60,
      personalCeiling: 2_000_000,
      personalLender: "جهة b",
      personalLenderKind: "bank",
    });
  });

  it("stops at the lender's ceiling", () => {
    const low = fundingRoutes({ input: deal, borrower, who: who(), products: [product("1", "a", { maxAmount: 150000 }), mortgageOf("2", "a", { maxAmount: 600000 })] })[0]!;
    expect(low.personal).toMatchObject({ amount: 150000, atCeiling: true, installment: 2900 }); // 150,000 x 1.16 / 60
    expect(low.mortgage).toMatchObject({ amount: 600000, atCeiling: true });
    expect(low.study.financing).toMatchObject({ personalCeiling: 150000, mortgageCeiling: 600000 });
  });

  it("compares lenders on their own terms, not on an offer already recorded", () => {
    const withOffer = fundingRoutes({ input: { ...deal, bankMortgage: 500000, bankPersonal: 100000 }, borrower, who: who(), products });
    expect(withOffer.map((r) => [r.key, r.study.clientNet])).toEqual(routes.map((r) => [r.key, r.study.clientNet]));
  });

  it("puts a lender that would refuse the client last, with the reason", () => {
    const privateOnly = fundingRoutes({ input: deal, borrower: { ...borrower, sector: "private" }, who: who(), products: [a1, a2, product("7", "e", { sectors: ["private"], rate: 9 }), mortgageOf("8", "e", { sectors: ["private"], rate: 9 })] });
    expect(privateOnly.map((r) => [r.key, r.status])).toEqual([
      ["m8-p7", "warn"],
      ["m2-p1", "fail"],
    ]);
    expect(privateOnly[1]!.refusals).toEqual([{ lender: "جهة a", check: { key: "sector", status: "fail", code: "SECTOR", params: { sector: "private" } } }]);
  });

  it("ends the personal term before the lender's age limit", () => {
    const older = fundingRoutes({ input: deal, borrower: { ...borrower, age: 62 }, who: who(), products: [a1, a2] })[0]!;
    expect(older.terms.personalMonths).toBe(36); // 65 - 62 years
    expect(older.personal!.months).toBe(36);
  });

  it("holds every lender to the record the settlement leaves", () => {
    const waits = [product("1", "a", { settledDefaultWaitMonths: 12 }), mortgageOf("2", "a", { settledDefaultWaitMonths: 12 }), product("3", "b", { settledDefaultWaitMonths: null }), mortgageOf("4", "b", { settledDefaultWaitMonths: null })];
    const after = fundingRoutes({ input: deal, borrower, who: who({ record: recordAfterSettlement(deal, null) }), products: waits });
    expect(after.map((r) => [r.key, r.status])).toEqual([
      ["m4-p3", "warn"],
      ["m2-p1", "fail"],
    ]);
    // One lender asks a thing once, even when both of its products raise it.
    expect(after[0]!.conditions.map((n) => n.check.code)).toEqual(["SALARY_TRANSFER", "SETTLED_UNCONFIRMED", "RECORD_UNKNOWN"]);
    expect(after[1]!.refusals).toEqual([{ lender: "جهة a", check: { key: "simah", status: "fail", code: "SETTLED_WAIT", params: { months: 12 } } }]);
  });

  it("follows the deal's structure", () => {
    const personalOnly = fundingRoutes({ input: { ...deal, structure: "settle_personal" }, borrower, who: who(), products });
    expect(personalOnly.map((r) => r.key)).toEqual(["p3", "p1", "p5"]);
    expect(personalOnly.every((r) => r.mortgage === null && r.terms.mortgageApr === undefined)).toBe(true);
    expect(personalOnly[0]!.terms.targetBank).toBe("جهة b");

    const mortgageOnly = fundingRoutes({ input: { ...deal, structure: "settle_refi" }, borrower, who: who(), products });
    // All three lend the same 90 percent of the value. The salary bank asks nothing, so it leads.
    expect(mortgageOnly.map((r) => r.key)).toEqual(["m2", "m6", "m4"]);
    expect(mortgageOnly.every((r) => r.personal === null && r.terms.personalLender === undefined)).toBe(true);
  });

  it("gives no route when the catalogue has no product of the kind", () => {
    expect(fundingRoutes({ input: deal, borrower, who: who(), products: [a1] })).toEqual([]);
  });
});
