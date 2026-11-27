import { describe, expect, it } from "vitest";
import { dealStudy, defaultDealInput, type Borrower, type DealInput, type DealItem } from "@/domain/deal";
import { termStanding, TERMS, type Product, type SourceKind, type Term } from "@/domain/eligibility";
import { fundingRoutes, type Applicant, type RecordAfter } from "@/domain/funding";
import { approvalsApart, lendersPrint, opportunities, opportunityOf, speakable, type LenderReply, type OpportunityArgs } from "@/domain/opportunity";

/** Each way to fund a deal read as a card: its class, how far it can be relied on, and where each figure comes from. */
const TODAY = "2026-11-23";
const borrower: Borrower = { age: 35, basicSalary: 12000, totalSalary: 16000, serviceMonths: 120, sector: "gov" };

const items: DealItem[] = [
  { id: "a", kind: "execution", label: "قرار تنفيذ", original: 100000, pay: 100000, by: "company", confirmed: true },
  { id: "b", kind: "default", label: "تعثر", original: 50000, pay: 40000, by: "company" },
];
/** Settle two orders and recover from personal finance alone: no property, no valuation. */
const deal: DealInput = { ...defaultDealInput(), structure: "settle_personal", items, fixedCosts: 0 };

const source = (kind: SourceKind, confirmedOn: string) => ({ kind, reference: kind === "lender_staff" ? "مدير الفرع، اتصال" : "دليل منتجات الجهة 2026", confirmedOn });
const terms = (kind: SourceKind = "lender_document", except: Term[] = [], on = "2026-11-01"): Product["terms"] =>
  Object.fromEntries(TERMS.filter((term) => !except.includes(term)).map((term) => [term, termStanding(source(kind, on), TODAY)]));

const product = (id: string, lender: string, parts: Partial<Product> = {}): Product => ({
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
  requiresSalaryTransfer: false,
  acceptsLateSimah: false,
  maxLtv: null,
  notes: null,
  settledDefaultWaitMonths: 0,
  terms: terms(),
  special: [],
  ...parts,
});

const record: RecordAfter = { known: true, open: false, settledMonthsAgo: 0, delays: false, inquiries: { m6: 0, m12: 0 } };
const who: Applicant = { nationality: "saudi", salaryBank: "a", record };

function args(products: Product[], parts: Partial<OpportunityArgs> = {}, input: DealInput = deal): OpportunityArgs {
  const routes = fundingRoutes({ input, borrower, who, products });
  return { input, study: dealStudy(input, borrower), borrower, routes, chosen: null, replies: [], today: TODAY, ...parts };
}
const reply = (parts: Partial<LenderReply> = {}): LenderReply => ({ lenderId: "a", part: "personal", decision: "approved", amount: 300000, on: "2026-11-20", written: true, ...parts });
const one = (a: OpportunityArgs) => opportunityOf(a, a.routes[0]!);

describe("the class of an opportunity", () => {
  it("is ready on confirmed written terms while the lender has not replied, and says the default does not guarantee it", () => {
    const o = one(args([product("p1", "a")]));
    expect(o.class).toBe("ready");
    expect(o.reasons).toEqual([{ code: "MET" }]);
    // The deal pays an order and a default: the warning stands, with the lender's wait.
    expect(o.settlement).toEqual({ pays: true, waits: [{ lender: "جهة a", part: "personal", months: 0, left: 0, confirmed: true }] });
    expect(speakable(o)).toBe(true);
  });

  it("is confirmed only by a recent written yes from every lender in it", () => {
    expect(one(args([product("p1", "a")], { replies: [reply()] })).class).toBe("confirmed");
    // A yes the employee wrote down without the lender's paper is not a confirmation.
    expect(one(args([product("p1", "a")], { replies: [reply({ written: false })] })).class).toBe("ready");
    // A yes older than three months is history: the lender is asked again.
    expect(one(args([product("p1", "a")], { replies: [reply({ on: "2026-08-22" })] })).class).toBe("ready");
    expect(one(args([product("p1", "a")], { replies: [reply({ on: "2026-08-23" })] })).class).toBe("confirmed");
    // Only the lender's latest answer counts, and only its own.
    expect(one(args([product("p1", "a")], { replies: [reply({ decision: "rejected", amount: null }), reply()] })).class).toBe("not_viable");
    expect(one(args([product("p1", "a")], { replies: [reply({ lenderId: "b" })] })).class).toBe("ready");
  });

  it("stays theoretical while a condition has no source, and paying the default changes nothing of that", () => {
    const o = one(args([product("p1", "a", { terms: terms("lender_document", ["salary", "settled"]) })]));
    expect(o.class).toBe("theoretical");
    expect(o.reasons[0]).toMatchObject({ code: "DOUBTS" });
    expect(o.confidence).toBe("low");
    const conditions = o.assumptions.find((a) => a.key === "conditions")!;
    expect(conditions).toMatchObject({ footing: "none", source: { kind: "open", terms: ["salary", "settled"], facts: 0 } });
    expect(o.settlement?.waits[0]).toMatchObject({ months: 0, confirmed: false });
  });

  it("is not viable when a lender said no, when a confirmed condition refuses, or when the client is left short", () => {
    const refused = one(args([product("p1", "a")], { replies: [reply({ decision: "rejected", amount: null })] }));
    expect(refused.class).toBe("not_viable");
    expect(refused.reasons[0]).toEqual({ code: "REFUSED", lender: "جهة a", part: "personal", on: "2026-11-20" });
    // A refusal older than its validity no longer refuses, and no longer lets the card pass either.
    const before = one(args([product("p1", "a")], { replies: [reply({ decision: "rejected", amount: null, on: "2026-06-01" })] }));
    expect(before.class).toBe("theoretical");
    expect(before.reasons[0]).toMatchObject({ code: "REFUSED_BEFORE" });

    // The lender says in writing that it takes the military only, and the client works for the government.
    const blocked = one(args([product("p1", "a", { sectors: ["military"] })]));
    expect(blocked.class).toBe("not_viable");
    expect(blocked.reasons[0]).toEqual({ code: "BLOCKED", count: 1 });

    // 300,000 approved against 140,000 settled and the office's fee: anything short of the settlement is a deficit.
    const short = one(args([product("p1", "a")], { replies: [reply({ amount: 100000 })] }));
    expect(short.class).toBe("not_viable");
    expect(short.reasons[0]).toMatchObject({ code: "DEFICIT" });
    expect(speakable(short)).toBe(false);
  });

  it("never lets a written yes pass over a confirmed condition that refuses", () => {
    const o = one(args([product("p1", "a", { sectors: ["military"] })], { replies: [reply()] }));
    expect(o.class).toBe("not_viable");
  });

  it("stays an opportunity when the lender waits after a paid default: the wait is time to pass, said with its months", () => {
    // Six months after the default is paid, in writing. Nothing refuses: it is the one thing left to do.
    const waits = one(args([product("p1", "a", { settledDefaultWaitMonths: 6 })]));
    expect(waits.class).toBe("ready");
    expect(waits.reasons).toEqual([{ code: "ACTIONS", count: 1 }]);
    expect(waits.route.blockers).toEqual([]);
    expect(waits.settlement?.waits[0]).toMatchObject({ months: 6, left: 6, confirmed: true });
    expect(speakable(waits)).toBe(true);
  });
});

describe("the figures of an opportunity", () => {
  it("counts the deal on the amount the lender approved, and tells what it changes against the deal as it stands", () => {
    const a = args([product("p1", "a")], { replies: [reply()] });
    const o = one(a);
    expect(o.input.bankPersonal).toBe(300000);
    expect(o.financing).toBe(300000);
    // What goes out first: the 100,000 order, the 40,000 default, and the lender's admin fee of 1% on 300,000.
    expect(o.cost).toBe(143000);
    // Ten percent on what is settled and ten on the financing: 14,000 + 30,000.
    expect(o.fee).toBe(44000);
    // 300,000 - 143,000 - 44,000.
    expect(o.study.clientNet).toBe(113000);
    expect(o.net.net).toBe(113000);
    expect(o.financingDiff).toBe(300000 - a.study.financing.personal);
    // A lender's written amount is confirmed; the default without a creditor's letter is not.
    expect(o.net.lines.find((l) => l.part === "personal")?.certainty).toBe("confirmed");
    expect(o.net.lines.find((l) => l.part === "obligations")?.certainty).toBe("estimated");
  });

  it("is as reliable as its weakest link, and a lender employee's word caps it", () => {
    const sure = { ...deal, items: items.map((i) => ({ ...i, confirmed: true })) };
    // Everything on paper: the terms, the lender's yes, every creditor's letter.
    expect(one(args([product("p1", "a")], { replies: [reply()] }, sure)).confidence).toBe("high");
    // The same, with one default still without its letter.
    expect(one(args([product("p1", "a")], { replies: [reply()] })).confidence).toBe("medium");
    // Terms on an employee's word and an amount worked out from them: never more than medium.
    const word = one(args([product("p1", "a", { terms: terms("lender_staff") })], {}, sure));
    expect(word.class).toBe("ready");
    expect(word.confidence).toBe("medium");
    expect(word.assumptions.find((a) => a.key === "conditions")).toMatchObject({ footing: "verbal", source: { kind: "term" } });
    // Written terms and an amount worked out from them, every letter in: high, before the lender replies.
    expect(one(args([product("p1", "a")], {}, sure)).confidence).toBe("high");
  });

  it("says where each assumption comes from, with its date", () => {
    const o = one(args([product("p1", "a", { terms: terms("lender_document", ["rate"]) })]));
    const amount = o.assumptions.find((a) => a.key === "amount")!;
    expect(amount).toMatchObject({ footing: "estimate", source: { kind: "computed", open: ["rate"], valuation: false } });
    const conditions = o.assumptions.find((a) => a.key === "conditions")!;
    expect(conditions.source).toMatchObject({ kind: "term", source: { kind: "lender_document", confirmedOn: "2026-11-01" }, until: "2027-02-01" });
    expect(o.assumptions.find((a) => a.key === "obligations")).toMatchObject({ footing: "estimate", source: { kind: "letters", confirmed: 1, all: 2 } });
  });

  it("reads a mortgage as an estimate until a lender values the property and offers", () => {
    const both = { ...deal, structure: "settle_refi_personal" as const, propertyValue: 900000, items: [...items, { id: "c", kind: "mortgage_payoff" as const, label: "مخالصة", original: 300000, pay: 300000, by: "company" as const, confirmed: true }] };
    const products = [product("m1", "a", { financeType: "mortgage", maxAgeAtMaturity: 70, maxTenor: 300, rate: 5, rateType: "reducing", maxLtv: 90 }), product("p1", "a")];
    const o = one(args(products, {}, both));
    expect(o.assumptions.find((a) => a.key === "amount" && a.part === "mortgage")).toMatchObject({ footing: "estimate", source: { kind: "computed", valuation: true } });
    expect(o.confidence).toBe("medium");
  });
});

describe("the opportunities of a deal", () => {
  it("are ranked by class, then in the order the routes come", () => {
    const products = [product("p1", "a", { terms: terms("lender_document", ["special"]) }), product("p2", "b"), product("p3", "c", { sectors: ["military"] })];
    const list = opportunities(args(products, { replies: [reply({ lenderId: "b" })] }));
    expect(list.map((o) => [o.route.personal?.product.lenderId, o.class])).toEqual([
      ["b", "confirmed"],
      ["a", "theoretical"],
      ["c", "not_viable"],
    ]);
  });

  it("reads the deal's own route on the deal's own numbers, its offer included", () => {
    const withOffer = { ...deal, bankPersonal: 250000 };
    const a = args([product("p1", "a")], {}, withOffer);
    const o = opportunityOf({ ...a, chosen: a.routes[0]!.key }, a.routes[0]!);
    expect(o.chosen).toBe(true);
    expect(o.financing).toBe(250000);
    expect(o.financingDiff).toBe(0);
    expect(o.assumptions.find((x) => x.key === "amount")).toMatchObject({ footing: "written", source: { kind: "offer" } });
  });

  it("prints the lenders' terms, so a changed term or source changes the print", () => {
    const route = (p: Product) => fundingRoutes({ input: deal, borrower, who, products: [p] })[0]!;
    const print = (p: Product) => JSON.stringify(lendersPrint(route(p)));
    expect(print(product("p1", "a"))).toBe(print(product("p1", "a")));
    expect(print(product("p1", "a", { rate: 3.5 }))).not.toBe(print(product("p1", "a")));
    expect(print(product("p1", "a", { terms: terms("lender_staff") }))).not.toBe(print(product("p1", "a")));
    expect(lendersPrint(null)).toBeNull();
  });
});

describe("a written approval the deal is not counted on", () => {
  const study = dealStudy(deal, borrower);
  const counted = study.financing.personal;
  const other = counted - 3000;

  it("is said with both amounts when a lender's written yes names another amount than the deal's", () => {
    expect(counted).toBeGreaterThan(3000);
    expect(approvalsApart(study, [], TODAY)).toEqual([]);
    expect(approvalsApart(study, [reply({ amount: other })], TODAY)).toEqual([{ part: "personal", lenderId: "a", approved: other, counted, on: "2026-11-20" }]);
    // More than the deal counts is as much a difference as less.
    expect(approvalsApart(study, [reply({ amount: counted + 5000, decision: "approved_modified" })], TODAY)).toMatchObject([{ approved: counted + 5000 }]);
  });

  it("is silent once the deal is counted on the approved amount", () => {
    expect(approvalsApart(study, [reply({ amount: counted })], TODAY)).toEqual([]);
    // Two lenders said yes in writing: the deal on either one's amount is counted on a written word.
    expect(approvalsApart(study, [reply({ lenderId: "b", amount: other }), reply({ amount: counted })], TODAY)).toEqual([]);
  });

  it("reads only an answer that is written, an approval, recent, and the lender's latest", () => {
    expect(approvalsApart(study, [reply({ amount: other, written: false })], TODAY)).toEqual([]);
    expect(approvalsApart(study, [reply({ amount: null, decision: "rejected" })], TODAY)).toEqual([]);
    expect(approvalsApart(study, [reply({ amount: other, on: "2026-08-01" })], TODAY)).toEqual([]);
    // The lender took its yes back: its latest answer is the one that stands.
    expect(approvalsApart(study, [reply({ amount: null, decision: "rejected", on: "2026-11-22" }), reply({ amount: other })], TODAY)).toEqual([]);
    // Two written approvals and the deal on neither: the newest is the one said.
    expect(approvalsApart(study, [reply({ lenderId: "b", amount: other - 1000, on: "2026-11-22" }), reply({ amount: other })], TODAY)).toMatchObject([{ lenderId: "b", approved: other - 1000 }]);
  });

  it("looks at each part the deal has, and at no other", () => {
    // The deal has no mortgage: an answer about one says nothing of it.
    expect(approvalsApart(study, [reply({ part: "mortgage", amount: 500000 })], TODAY)).toEqual([]);
    const both = { financing: { ...study.financing, mortgage: 600000 } };
    expect(approvalsApart(both, [reply({ part: "mortgage", amount: 550000 }), reply({ amount: other })], TODAY).map((one) => [one.part, one.approved, one.counted])).toEqual([
      ["mortgage", 550000, 600000],
      ["personal", other, counted],
    ]);
  });
});
