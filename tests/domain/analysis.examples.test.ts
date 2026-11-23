import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeClient, commitmentsOf, reportAgeMonths, STALE_REPORT_MONTHS, type FileFacts, type RecordFacts } from "@/domain/analysis";
import { analyzeCredit, emptyReport, type CreditReport, type Facility, type Judgment } from "@/domain/credit";
import { TERMS, termStanding, type Product, type SourceKind, type Term } from "@/domain/eligibility";

/** Every term of a product confirmed three weeks ago, except the ones left open. A lender whose terms nobody confirmed has none. */
const confirmed = (open: Term[] = [], kind: SourceKind = "lender_document"): Product["terms"] =>
  Object.fromEntries(TERMS.filter((term) => !open.includes(term)).map((term) => [term, termStanding({ kind, reference: "نشرة المنتج، نوفمبر 2026", confirmedOn: "2026-11-01" }, "2026-11-23")]));
const unconfirmed: Partial<Product> = { verified: false, terms: undefined };

/**
 * Worked examples of a client's credit and financial analysis, small enough to check by hand.
 *
 * The client earns 16,000 a month in a government job. SAMA lets consumer finance take a third of the
 * salary (5,333), everything that is not a mortgage 45 percent of the income (7,200), and every
 * commitment together 65 percent (10,400).
 */
const file = (parts: Partial<FileFacts> = {}): FileFacts => ({
  age: 35,
  nationality: "saudi",
  sector: "gov",
  serviceMonths: 120,
  basicSalary: 12000,
  totalSalary: 16000,
  otherIncome: null,
  coIncome: null,
  salaryBank: "a",
  housingSupport: false,
  propertyValue: null,
  request: null,
  incomeVerified: true,
  consent: true,
  ...parts,
});

const loan = (parts: Partial<Facility>): Facility => ({ lender: "بنك", creditorType: "bank", product: "قرض شخصي", status: "current", ...parts });
const order = (parts: Partial<Judgment>): Judgment => ({ kind: "enforcement", active: true, ...parts });
const report = (parts: Partial<CreditReport> = {}): CreditReport => ({ ...emptyReport(), ...parts });
const record = (r: CreditReport, parts: Partial<RecordFacts> = {}): RecordFacts => ({ report: r, analysis: analyzeCredit(r), confidence: "high", readingWarnings: 0, ageMonths: 0, ...parts });

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
  requiresSalaryTransfer: true,
  acceptsLateSimah: false,
  maxLtv: null,
  notes: null,
  settledDefaultWaitMonths: 0,
  verified: true,
  terms: confirmed(),
  ...parts,
});
const mortgageOf = (id: string, lender: string, parts: Partial<Product> = {}): Product =>
  product(id, lender, { financeType: "mortgage", maxAgeAtMaturity: 70, maxTenor: 300, maxAmount: 5_000_000, rate: 5, rateType: "reducing", maxLtv: 90, ...parts });

/** A mortgage, a personal loan and a card with no installment on the record. */
const running: Facility[] = [
  loan({ product: "تمويل عقاري", installment: 3100, balance: 331000 }),
  loan({ product: "قرض شخصي", lender: "بنك آخر", installment: 1900, balance: 52000 }),
  loan({ product: "بطاقة ائتمان", limit: 20000, balance: 6500 }),
];

const catalogue: Product[] = [product("1", "a"), product("2", "b"), mortgageOf("3", "a")];

describe("what the record shows the client is still paying", () => {
  it("lists each running product with what the record gives about it, and nothing more", () => {
    expect(commitmentsOf(report({ facilities: running }))).toEqual([
      { kind: "mortgage", lender: "بنك", product: "تمويل عقاري", monthly: 3100, balance: 331000, limit: null, late: false },
      { kind: "personal", lender: "بنك آخر", product: "قرض شخصي", monthly: 1900, balance: 52000, limit: null, late: false },
      { kind: "card", lender: "بنك", product: "بطاقة ائتمان", monthly: null, balance: 6500, limit: 20000, late: false },
    ]);
  });

  it("leaves out what is closed, defaulted or paid after a default, and every phone line", () => {
    const list = commitmentsOf(
      report({
        facilities: [
          loan({ status: "closed", installment: 900, balance: 0 }),
          loan({ status: "default", installment: 1200, balance: 40000, defaultAmount: 40000, defaultNow: 40000 }),
          loan({ status: "settled", defaultAmount: 9000, defaultNow: 0 }),
          loan({ creditorType: "telecom", product: "الهاتف الجوال", installment: 250, balance: 700 }),
          loan({ status: "late", installment: 1500, balance: 30000 }),
        ],
      }),
    );
    expect(list).toEqual([{ kind: "personal", lender: "بنك", product: "قرض شخصي", monthly: 1500, balance: 30000, limit: null, late: true }]);
  });

  it("keeps a card that has only a limit, and finance SIMAH names another way", () => {
    const list = commitmentsOf(
      report({
        facilities: [
          loan({ product: "بطاقة ائتمان", limit: 15000, balance: 0 }),
          loan({ product: "تمويل منتجات/اشتر الآن", creditorType: "finance_company", lender: "شركة تقسيط", installment: 400, balance: 1600 }),
          loan({ product: "قرض شخصي", balance: 0 }),
        ],
      }),
    );
    expect(list.map((c) => [c.kind, c.monthly, c.balance, c.limit])).toEqual([
      ["card", null, null, 15000],
      ["other", 400, 1600, null],
    ]);
  });
});

describe("the income and what the commitments take of it", () => {
  const a = analyzeClient({ file: file(), record: record(report({ facilities: running })), products: catalogue });

  it("counts the installments the record gives against the income on file", () => {
    expect(a.income).toEqual({ basis: "verified", salary: 16000, basicOnly: false, other: 0, total: 16000 });
    // 3,100 + 1,900 = 5,000 of 16,000 is 31.25 percent. The card's installment is not on the record.
    expect(a.burden).toEqual({ monthly: 5000, mortgage: 3100, nonMortgage: 1900, share: 31.3, uncounted: 1 });
  });

  it("measures the room for each kind of finance with every commitment standing", () => {
    const personal = a.kinds.find((k) => k.kind === "personal")!.room;
    // A third of 16,000 is 5,333. The loan takes 1,900 of it.
    expect([personal.available, personal.rule]).toEqual([3433, "SALARY_DEDUCTION"]);
    const mortgage = a.kinds.find((k) => k.kind === "mortgage")!.room;
    // 65 percent of 16,000 is 10,400. Everything paid today takes 5,000 of it.
    expect([mortgage.available, mortgage.rule]).toEqual([5400, "TOTAL_CAP"]);
  });

  it("counts half of a regular income beside the salary", () => {
    const b = analyzeClient({ file: file({ otherIncome: 4000 }), record: record(report({ facilities: running })), products: catalogue });
    expect(b.income).toMatchObject({ salary: 16000, other: 2000, total: 18000 });
    expect(b.burden.share).toBe(27.8);
  });

  it("says where the income stands: checked on a paper, as written, or not there", () => {
    const stated = analyzeClient({ file: file({ incomeVerified: false }), record: record(report()), products: catalogue });
    expect(stated.income.basis).toBe("stated");
    expect(stated.gaps).toContainEqual({ kind: "unconfirmed", code: "INCOME_PROOF" });

    const basic = analyzeClient({ file: file({ totalSalary: null }), record: record(report()), products: catalogue });
    expect(basic.income).toMatchObject({ salary: 12000, basicOnly: true });
    expect(basic.gaps).toContainEqual({ kind: "missing", code: "TOTAL_SALARY" });
  });

  it("gives no share, no room and no lender without an income, and asks for it first", () => {
    const none = analyzeClient({ file: file({ totalSalary: null, basicSalary: null }), record: record(report({ facilities: running })), products: catalogue });
    expect(none.verdict).toBe("pending");
    expect(none.income.basis).toBe("missing");
    expect(none.burden).toMatchObject({ monthly: 5000, share: null });
    expect(none.kinds).toEqual([]);
    expect(none.gaps[0]).toEqual({ kind: "missing", code: "INCOME" });
    expect(none.steps[0]).toEqual({ code: "COMPLETE_FILE", missing: ["INCOME"] });
    // Nothing is said about a share of an income nobody knows.
    expect([...none.strengths, ...none.risks].some((m) => m.source === "file" && (m.point.code === "DEBT_SHARE" || m.point.code === "NO_ROOM"))).toBe(false);
  });

  it("never puts a figure where the record gives none", () => {
    const b = analyzeClient({
      file: file(),
      record: record(report({ facilities: [loan({ lender: "شركة تقسيط", creditorType: "finance_company", balance: 27000 }), loan({ installment: 1000, balance: 20000 })] })),
      products: catalogue,
    });
    expect(b.burden).toMatchObject({ monthly: 1000, uncounted: 1 });
    expect(b.gaps).toContainEqual({ kind: "missing", code: "INSTALLMENT", lender: "شركة تقسيط", product: "قرض شخصي", balance: 27000 });
    // 1,000 of 16,000 is low, and it is a floor: it is not called a strength.
    expect(b.strengths.some((m) => m.source === "file" && m.point.code === "DEBT_SHARE")).toBe(false);
  });
});

describe("the lenders held against a record nothing blocks", () => {
  const a = analyzeClient({ file: file(), record: record(report({ facilities: running })), products: [...catalogue, product("4", "c", { minSalary: 20000 })] });
  const personal = a.kinds.find((k) => k.kind === "personal")!;

  it("puts the lender that takes the client as they are first, and says what the others ask", () => {
    expect(personal.cleared).toBeNull();
    expect(personal.today.fits.map((f) => [f.product.id, f.status])).toEqual([
      ["1", "pass"],
      ["2", "warn"],
      ["4", "fail"],
    ]);
    // The salary is paid into lender a. Lender b wants it moved.
    expect(personal.today.fits[1]!.conditions.map((c) => c.code)).toEqual(["SALARY_TRANSFER"]);
    expect(personal.today.fits[2]!.refusals.map((c) => c.code)).toEqual(["SALARY_MIN"]);
    expect([personal.today.open, personal.today.conditional]).toEqual([1, 1]);
  });

  it("lends what the room carries: 3,433 a month for five years at 3.2 percent flat", () => {
    const best = personal.today.fits[0]!;
    // 3,433 × 60 = 205,980, and 205,980 ÷ (1 + 3.2% × 5) = 177,569, in whole thousands.
    expect([best.most, best.amount, best.months, best.limitedBy.code]).toEqual([177000, 177000, 60, "INCOME"]);
    expect(best.installment).toBe(3422);
  });

  it("is eligible, and names the lender to apply to for each kind", () => {
    expect([a.verdict, a.afterClearing]).toEqual(["eligible", null]);
    expect(a.steps).toEqual([
      { code: "APPLY", kind: "personal", lender: "جهة a", product: "منتج", amount: 177000, installment: 3422, months: 60, eligibility: "eligible", afterClearing: false, estimated: false },
      expect.objectContaining({ code: "APPLY", kind: "mortgage", lender: "جهة a", afterClearing: false }),
    ]);
  });

  it("studies the kind the client asked for first, on the amount asked for", () => {
    const b = analyzeClient({ file: file({ request: { kind: "mortgage", amount: 500000, tenor: null } }), record: record(report({ facilities: running })), products: catalogue });
    expect(b.kinds.map((k) => k.kind)).toEqual(["mortgage", "personal"]);
    const fit = b.kinds[0]!.today.fits[0]!;
    expect(fit.amount).toBe(500000);
    expect(fit.most).toBeGreaterThan(500000);
  });

  it("is conditional when every lender that takes the client asks something", () => {
    const b = analyzeClient({ file: file({ salaryBank: null }), record: record(report()), products: catalogue });
    expect(b.verdict).toBe("conditional");
    expect(b.gaps).toContainEqual({ kind: "missing", code: "SALARY_BANK" });
  });

  it("does not count a term the lender's age limit cut short as something the client has to meet", () => {
    // A pensioner of 62 with a lender that ends every finance by 65: three years and no more.
    const b = analyzeClient({ file: file({ age: 62, sector: "retired" }), record: record(report()), products: [product("1", "a", { sectors: ["retired"] })] });
    const fit = b.kinds[0]!.today.fits[0]!;
    expect([fit.status, fit.months]).toEqual(["pass", 36]);
  });
});

describe("the lenders held against a record that blocks them all", () => {
  const unpaid = report({
    facilities: [...running, loan({ lender: "شركة تمويل", creditorType: "finance_company", status: "default", defaultAmount: 80000, defaultNow: 80000 })],
  });
  const lenders = [product("1", "a", { settledDefaultWaitMonths: 0 }), product("2", "b", { settledDefaultWaitMonths: null, requiresSalaryTransfer: false }), product("3", "c", { settledDefaultWaitMonths: 12, requiresSalaryTransfer: false })];
  const a = analyzeClient({ file: file(), record: record(unpaid), products: lenders });
  const personal = a.kinds[0]!;

  it("has no lender today, each for the debt that stands", () => {
    expect(a.verdict).toBe("not_eligible");
    expect(personal.today.record).toEqual({ known: true, open: true, settledMonthsAgo: null, delays: false });
    expect(personal.today.fits.every((f) => f.status === "fail" && f.refusals.some((c) => c.code === "RECORD_OPEN"))).toBe(true);
  });

  it("asks each lender what it does once the debt is paid, and takes no silence for a yes", () => {
    expect(personal.cleared!.record).toEqual({ known: true, open: false, settledMonthsAgo: 0, delays: false });
    const after = Object.fromEntries(personal.cleared!.fits.map((f) => [f.product.id, [f.status, [...f.conditions, ...f.refusals].map((c) => c.code)]]));
    expect(after).toEqual({
      // It takes a client who has just paid.
      "1": ["pass", []],
      // Nobody confirmed with it: a condition, never an acceptance.
      "2": ["warn", ["SETTLED_UNCONFIRMED"]],
      // It waits a year.
      "3": ["fail", ["SETTLED_WAIT"]],
    });
    expect(a.afterClearing).toBe("eligible");
  });

  it("puts paying the debt before any application, and marks the application as coming after", () => {
    expect(a.steps.map((s) => (s.code === "CREDIT" ? s.action.code : s.code))).toEqual(["PAY_DEFAULT", "REFRESH_REPORT", "APPLY"]);
    expect(a.steps.at(-1)).toMatchObject({ code: "APPLY", lender: "جهة a", afterClearing: true, eligibility: "eligible" });
  });

  it("needs verification after the debt is paid when no lender is known to take such a client, and asks before anything is paid", () => {
    const b = analyzeClient({ file: file(), record: record(unpaid), products: [lenders[1]!, lenders[2]!] });
    // The debt stands at every lender today: that is certain, whoever confirmed what.
    expect([b.verdict, b.afterClearing]).toEqual(["not_eligible", "needs_verification"]);
    expect(b.kinds[0]!.cleared!.fits.map((f) => [f.product.id, f.eligibility])).toEqual([
      ["2", "needs_verification"],
      // A year's wait, in writing: paying changes nothing there.
      ["3", "not_eligible"],
    ]);
    expect(b.steps.map((s) => (s.code === "CREDIT" ? s.action.code : s.code))).toEqual(["CONFIRM_TERMS", "PAY_DEFAULT", "REFRESH_REPORT", "APPLY"]);
    expect(b.steps[0]).toEqual({ code: "CONFIRM_TERMS", lender: "جهة b", kinds: ["personal"], terms: ["settled"], beforePaying: true });
    expect(b.steps.at(-1)).toMatchObject({ code: "APPLY", lender: "جهة b", afterClearing: true, eligibility: "needs_verification", estimated: false });
  });

  it("never calls a client eligible on terms nobody confirmed, and never calls them refused on such terms", () => {
    const clean = record(report({ facilities: running }));
    const open = [product("1", "a", unconfirmed), product("2", "b", { ...unconfirmed, sectors: ["private"] })];
    const b = analyzeClient({ file: file(), record: clean, products: open });
    expect(b.verdict).toBe("needs_verification");
    expect(b.kinds[0]!.today.fits.map((f) => [f.product.id, f.status, f.eligibility, f.blockedAsWritten])).toEqual([
      // As written it takes the client. Nobody knows that it does.
      ["1", "pass", "needs_verification", false],
      // As written it refuses the client. Nobody knows that either.
      ["2", "fail", "needs_verification", true],
    ]);
    expect([b.kinds[0]!.today.open, b.kinds[0]!.today.conditional, b.kinds[0]!.today.unsure]).toEqual([0, 0, 2]);
    expect(b.steps.map((s) => s.code)).toEqual(["CONFIRM_TERMS", "APPLY"]);
    expect(b.steps[0]).toMatchObject({ lender: "جهة a", beforePaying: false, terms: ["salary", "sector", "nationality", "age", "service", "transfer", "special"] });
    expect(b.steps[1]).toMatchObject({ lender: "جهة a", eligibility: "needs_verification", afterClearing: false });

    // The same lenders refuse for certain once the term that refuses is confirmed.
    const sure = analyzeClient({ file: file(), record: clean, products: [product("2", "b", { sectors: ["private"] })] });
    expect(sure.verdict).toBe("not_eligible");
    expect(sure.kinds[0]!.today.fits[0]!.blockers.map((f) => f.check.code)).toEqual(["SECTOR"]);
  });

  it("puts a lender with confirmed terms ahead of one that reads better and that nobody confirmed", () => {
    const clean = record(report({ facilities: running }));
    // The salary is paid into b, its rate is lower, and nobody confirmed a word of it.
    const b = analyzeClient({ file: file({ salaryBank: "b" }), record: clean, products: [product("1", "a"), product("2", "b", { ...unconfirmed, rate: 2 })] });
    expect(b.kinds[0]!.today.fits.map((f) => [f.product.id, f.eligibility])).toEqual([
      ["1", "conditional"],
      ["2", "needs_verification"],
    ]);
    expect(b.verdict).toBe("conditional");
    expect(b.kinds[0]!.today.fits[0]!.actions.map((f) => f.check.code)).toEqual(["SALARY_TRANSFER"]);
    expect(b.steps.at(-1)).toMatchObject({ code: "APPLY", lender: "جهة a", eligibility: "conditional" });

    // A lender confirmed all but one term is closer to an answer than one confirmed in nothing.
    const c = analyzeClient({ file: file(), record: clean, products: [product("1", "a", unconfirmed), product("2", "b", { terms: confirmed(["service"]), requiresSalaryTransfer: false })] });
    expect(c.kinds[0]!.today.fits.map((f) => [f.product.id, f.doubts.map((d) => d.term)])).toEqual([
      ["2", ["service"]],
      ["1", ["salary", "sector", "nationality", "age", "service", "transfer", "special"]],
    ]);
  });

  it("asks one lender once for both kinds of finance, naming every term left open in either", () => {
    const clean = record(report({ facilities: running }));
    const b = analyzeClient({
      file: file({ request: { kind: "mortgage", amount: 500000, tenor: 240 }, propertyValue: 700000 }),
      record: clean,
      products: [product("1", "a", { terms: confirmed(["service"]) }), mortgageOf("2", "a", { terms: confirmed(["salary", "age"]) })],
    });
    expect(b.verdict).toBe("needs_verification");
    expect(b.steps.filter((s) => s.code === "CONFIRM_TERMS")).toEqual([{ code: "CONFIRM_TERMS", lender: "جهة a", kinds: ["mortgage", "personal"], terms: ["salary", "age", "service"], beforePaying: false }]);
    expect(b.steps.map((s) => s.code)).toEqual(["CONFIRM_TERMS", "APPLY", "APPLY"]);
  });

  it("calls the figures an estimate when the lender is confirmed to take the client and its amount terms are not", () => {
    const clean = record(report({ facilities: running }));
    const b = analyzeClient({ file: file(), record: clean, products: [product("1", "a", { terms: confirmed(["rate", "settled"]) })] });
    const fit = b.kinds[0]!.today.fits[0]!;
    // What it does after a paid default is open too, and this client never had one: it is not in the way.
    expect([fit.eligibility, fit.estimated, fit.doubts]).toEqual(["eligible", true, []]);
    expect(b.steps.at(-1)).toMatchObject({ code: "APPLY", eligibility: "eligible", estimated: true });
    expect(b.gaps).toContainEqual({ kind: "unconfirmed", code: "TERMS", unverified: 1, of: 1 });

    const firm = analyzeClient({ file: file(), record: clean, products: [product("1", "a", { terms: confirmed(["settled"]) })] });
    expect(firm.kinds[0]!.today.fits[0]!.estimated).toBe(false);
  });

  it("says what a source rests on: an employee's word is weaker than a paper", () => {
    const clean = record(report({ facilities: running }));
    const b = analyzeClient({ file: file(), record: clean, products: [product("1", "a", { terms: confirmed([], "lender_staff") }), product("2", "b")] });
    expect(Object.fromEntries(b.kinds[0]!.today.fits.map((f) => [f.product.id, f.strength]))).toEqual({ "1": "verbal", "2": "written" });
  });

  it("reads a paid court order the way it reads a paid default", () => {
    const b = analyzeClient({ file: file(), record: record(report({ judgments: [order({ amount: 50000, remaining: 50000 })] })), products: lenders });
    expect(b.kinds[0]!.cleared!.record.settledMonthsAgo).toBe(0);
  });

  it("leaves no paid default behind a suspension that is lifted with nothing owed", () => {
    const b = analyzeClient({ file: file(), record: record(report({ serviceSuspension: true })), products: lenders });
    expect(b.verdict).toBe("not_eligible");
    expect(b.kinds[0]!.cleared!.record).toEqual({ known: true, open: false, settledMonthsAgo: null, delays: false });
    expect(b.kinds[0]!.cleared!.fits.find((f) => f.product.id === "3")!.status).toBe("pass");
  });

  it("carries recent late payments past the payment, to lenders that refuse them", () => {
    const late = report({ facilities: [loan({ status: "default", defaultAmount: 30000, defaultNow: 30000 }), loan({ status: "late", installment: 1000, balance: 9000, worstDelay: 60, lastDelayMonthsAgo: 1 })] });
    const b = analyzeClient({ file: file(), record: record(late), products: [product("1", "a"), product("2", "b", { acceptsLateSimah: true })] });
    const after = b.kinds[0]!.cleared!;
    expect(after.record.delays).toBe(true);
    expect(after.fits.map((f) => [f.product.id, f.status])).toEqual([
      ["2", "warn"],
      ["1", "fail"],
    ]);
  });
});

describe("what helps and what hurts, with where it was read", () => {
  it("takes the employer and the share from the file, and the rest from the record", () => {
    const a = analyzeClient({ file: file(), record: record(report({ score: 720, facilities: [loan({ installment: 1000, balance: 20000 })] })), products: catalogue });
    expect(a.strengths).toEqual([
      { source: "record", finding: { code: "SCORE", level: "good", params: { score: 720 } } },
      { source: "record", finding: { code: "CLEAN", level: "good", params: {} } },
      { source: "file", point: { code: "STRONG_EMPLOYER" } },
      { source: "file", point: { code: "DEBT_SHARE", percent: 6.3 } },
    ]);
    expect(a.risks).toEqual([]);
  });

  it("lists every blocker, then what the record warns of, then the file", () => {
    const heavy = report({
      facilities: [loan({ installment: 6000, balance: 200000 }), loan({ lender: "شركة تمويل", creditorType: "finance_company", status: "default", defaultAmount: 80000, defaultNow: 80000 })],
    });
    const a = analyzeClient({ file: file({ sector: "private" }), record: record(heavy), products: catalogue });
    expect(a.risks.map((m) => (m.source === "file" ? m.point.code : "blocker" in m ? m.blocker.code : m.finding.code))).toEqual([
      "ACTIVE_DEFAULT",
      "TOTAL_TO_CLEAR",
      "FINANCE_CO_DEFAULTS",
      "UNAPPROVED_EMPLOYER",
      "DEBT_SHARE",
      "NO_ROOM",
    ]);
    // The record speaks for itself: the engine's one-word reading of it is not repeated.
    expect(a.risks.some((m) => m.source === "file" && m.point.code === "DEFAULT_RECORD")).toBe(false);
    expect(a.strengths.some((m) => m.source === "file" && m.point.code === "CLEAN_RECORD")).toBe(false);
  });

  it("notes what a lender may still ask about, and leaves out what is neither help nor harm", () => {
    const noted = report({
      score: 600,
      facilities: [
        loan({ installment: 1000, balance: 20000, worstDelay: 30, lastDelayMonthsAgo: 30 }),
        loan({ product: "بطاقة ائتمان", limit: 20000, balance: 6500 }),
        loan({ lender: "بنك قديم", status: "settled", defaultAmount: 12000, settledMonthsAgo: 30 }),
        loan({ lender: "شركة اتصالات", creditorType: "telecom", product: "فاتورة", status: "default", defaultAmount: 400, defaultNow: 400 }),
      ],
    });
    const codes = analyzeCredit(noted).findings.map((f) => `${f.code}:${f.level}`);
    // The record reads a middling score and a third of the card used, and says neither is good or bad.
    expect(codes).toContain("SCORE:info");
    expect(codes).toContain("CARD_UTILIZATION:info");
    expect(codes).toContain("INSTALLMENTS:info");

    const a = analyzeClient({ file: file(), record: record(noted), products: catalogue });
    const listed = a.risks.flatMap((m) => (m.source === "record" && "finding" in m ? [m.finding.code] : []));
    expect(listed).toEqual(expect.arrayContaining(["TELECOM_DEFAULTS", "SETTLED_DEFAULT", "OLD_DELAY"]));
    expect(listed).not.toContain("SCORE");
    expect(listed).not.toContain("CARD_UTILIZATION");
    expect(listed).not.toContain("INSTALLMENTS");
    expect(a.strengths.some((m) => m.source === "record" && "finding" in m && m.finding.code === "SCORE")).toBe(false);
  });
});

describe("what the analysis could not stand on", () => {
  it("waits for the client's consent, whatever the lenders would say", () => {
    const clean = report({ facilities: [loan({ installment: 1000, balance: 20000 })] });
    const agreed = analyzeClient({ file: file(), record: record(clean), products: catalogue });
    const without = analyzeClient({ file: file({ consent: false }), record: record(clean), products: catalogue });
    expect(agreed.verdict).toBe("eligible");
    expect(without.verdict).toBe("pending");
    expect(without.steps[0]).toEqual({ code: "RECORD_CONSENT" });
    expect(without.gaps).toEqual([{ kind: "missing", code: "CONSENT" }]);
    // The figures are the same. What changes is whether anyone may rely on them.
    expect(without.burden).toEqual(agreed.burden);
    expect(without.steps.slice(1)).toEqual(agreed.steps);
  });

  it("counts a report's age in whole months, by the day", () => {
    expect(reportAgeMonths("2026/08/20", "2026/11/19")).toBe(2);
    expect(reportAgeMonths("2026/08/20", "2026/11/20")).toBe(3);
    expect(reportAgeMonths("2026/11/30", "2027/02/28")).toBe(2);
    expect(reportAgeMonths("2026/11/30", "2027/03/01")).toBe(3);
    // A report dated after today is not older than today.
    expect(reportAgeMonths("2026/12/01", "2026/11/20")).toBe(0);
  });

  it("names nothing when the file, the reading and the lenders' terms are all confirmed", () => {
    const a = analyzeClient({ file: file(), record: record(report({ facilities: [loan({ installment: 1000, balance: 20000 })] })), products: catalogue });
    expect(a.gaps).toEqual([]);
  });

  it("names each thing that is missing or that nobody confirmed", () => {
    const a = analyzeClient({
      file: file({ age: null, serviceMonths: null, salaryBank: null, incomeVerified: false, consent: false }),
      record: record(report({ facilities: running, serviceSuspension: true, suspensionAssumed: true, judgments: [order({ amount: 40000, remaining: 40000 })] }), {
        confidence: "medium",
        readingWarnings: 2,
        ageMonths: STALE_REPORT_MONTHS,
      }),
      products: [product("1", "a", unconfirmed), product("2", "b")],
    });
    expect(a.gaps).toEqual([
      { kind: "unconfirmed", code: "INCOME_PROOF" },
      { kind: "missing", code: "AGE" },
      { kind: "missing", code: "SERVICE" },
      { kind: "missing", code: "SALARY_BANK" },
      { kind: "unconfirmed", code: "CARD_SHARE", lender: "بنك", limit: 20000, balance: 6500 },
      { kind: "unconfirmed", code: "REPORT_AGE", months: 3 },
      { kind: "unconfirmed", code: "READING", confidence: "medium", warnings: 2 },
      { kind: "unconfirmed", code: "SUSPENSION" },
      { kind: "unconfirmed", code: "TERMS", unverified: 1, of: 2 },
      { kind: "missing", code: "CONSENT" },
    ]);
    // The client's consent comes before everything: nothing here is relied on without it.
    expect(a.steps.map((s) => (s.code === "CREDIT" ? s.action.code : s.code))).toEqual([
      "RECORD_CONSENT",
      "COMPLETE_FILE",
      "REVIEW_READING",
      "CONFIRM_SUSPENSION",
      "LIFT_SUSPENSION",
      "SETTLE_JUDGMENTS",
      "REFRESH_REPORT",
      "VERIFY_INCOME",
      "APPLY",
    ]);
    // The lender to go to has its terms confirmed: what it waits for is the file, and nobody has to ask it anything.
    expect(a.steps.at(-1)).toMatchObject({ code: "APPLY", lender: "جهة b", eligibility: "needs_verification", afterClearing: true });
    expect(a.steps[1]).toEqual({ code: "COMPLETE_FILE", missing: ["AGE", "SERVICE", "SALARY_BANK"] });
  });

  it("does not ask a retired client for their length of service", () => {
    const a = analyzeClient({ file: file({ sector: "retired", serviceMonths: null }), record: record(report()), products: catalogue });
    expect(a.gaps.some((g) => g.code === "SERVICE")).toBe(false);
  });

  it("waits for a person when the reading itself is in doubt", () => {
    const a = analyzeClient({ file: file(), record: record(report({ facilities: running }), { confidence: "low" }), products: catalogue });
    expect(a.verdict).toBe("pending");
    expect(a.gaps).toContainEqual({ kind: "unconfirmed", code: "READING", confidence: "low", warnings: 0 });
    expect(a.steps[0]).toEqual({ code: "REVIEW_READING" });
  });

  it("asks for a newer report when the one on file is old and nothing else already asks", () => {
    const a = analyzeClient({ file: file(), record: record(report({ facilities: running }), { ageMonths: 7 }), products: catalogue });
    expect(a.steps[0]).toEqual({ code: "REFRESH_REPORT", months: 7 });
    const fresh = analyzeClient({ file: file(), record: record(report({ facilities: running }), { ageMonths: 2 }), products: catalogue });
    expect(fresh.steps.some((s) => s.code === "REFRESH_REPORT")).toBe(false);
  });

  it("is pending when the catalogue holds no lender for the client", () => {
    const a = analyzeClient({ file: file(), record: record(report()), products: [] });
    expect([a.verdict, a.kinds, a.steps]).toEqual(["pending", [], []]);
  });
});

describe("no room left for a new installment", () => {
  it("names the smallest debt whose installment and balance the record gives", () => {
    const full = report({
      facilities: [
        loan({ product: "تمويل عقاري", installment: 4000, balance: 400000 }),
        loan({ lender: "بنك الأول", installment: 3500, balance: 90000 }),
        loan({ lender: "بنك الثاني", product: "تمويل سيارة", installment: 2000, balance: 30000 }),
        loan({ lender: "شركة تقسيط", balance: 4000 }),
      ],
    });
    const a = analyzeClient({ file: file(), record: record(full), products: catalogue });
    // A third of 16,000 is 5,333, and the two loans take 5,500.
    expect(a.kinds.find((k) => k.kind === "personal")!.room.available).toBe(0);
    expect(a.steps).toContainEqual({ code: "FREE_ROOM", lender: "بنك الثاني", kind: "auto", monthly: 2000 });
    expect(a.kinds.find((k) => k.kind === "personal")!.today.fits[0]!.refusals.map((c) => c.code)).toEqual(["NO_ROOM"]);
  });
});

describe("every record in the golden file", () => {
  const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, "../golden/credit.json"), "utf8")) as { cases: { name?: string; report: CreditReport }[] };

  it.each(golden.cases.map((c, index) => [c.name ?? `case ${index + 1}`, c.report] as const))("%s holds together", (_name, r) => {
    const a = analyzeClient({ file: file(), record: record(r), products: catalogue });
    const blocked = analyzeCredit(r).blockers.length > 0;
    // The total is the sum of what the record gives, and nothing else.
    expect(a.burden.monthly).toBe(Math.round(a.commitments.reduce((sum, c) => sum + (c.monthly ?? 0), 0)));
    expect(a.burden.uncounted).toBe(a.commitments.filter((c) => c.monthly == null).length);
    for (const kind of a.kinds) {
      expect(kind.cleared != null).toBe(blocked);
      // A record that blocks every lender leaves none open today.
      if (blocked) expect(kind.today.open + kind.today.conditional).toBe(0);
      for (const fit of [...kind.today.fits, ...(kind.cleared?.fits ?? [])]) {
        expect(fit.status).toBe(fit.refusals.length ? "fail" : fit.conditions.length ? "warn" : "pass");
      }
    }
    expect(a.afterClearing != null).toBe(blocked);
    if (blocked) expect(a.verdict === "not_eligible" || a.verdict === "pending").toBe(true);
    // An application is named after the payment only when something has to be paid first.
    for (const step of a.steps) if (step.code === "APPLY") expect(step.afterClearing).toBe(blocked);
  });

  // The same lenders three ways: every term confirmed, none, and some left open.
  const open = catalogue.map((p): Product => ({ ...p, ...unconfirmed }));
  const mixed = catalogue.map((p, index): Product => (index % 2 ? p : { ...p, verified: false, terms: confirmed(["transfer", "late", "settled", "rate"]) }));

  it.each(golden.cases.map((c, index) => [c.name ?? `case ${index + 1}`, c.report] as const))("%s is read strictly, whoever confirmed the lenders' terms", (_name, r) => {
    const blocked = analyzeCredit(r).blockers.length > 0;
    for (const products of [catalogue, open, mixed]) {
      const a = analyzeClient({ file: file({ salaryBank: "x" }), record: record(r), products });
      for (const kind of a.kinds) {
        for (const reading of [kind.today, ...(kind.cleared ? [kind.cleared] : [])]) {
          for (const fit of reading.fits) {
            // A result that can be acted on has nothing unknown behind it and nothing that refuses.
            if (fit.eligibility === "eligible" || fit.eligibility === "conditional") expect([fit.doubts, fit.blockers, fit.status === "fail"]).toEqual([[], [], false]);
            if (fit.eligibility === "conditional") expect(fit.actions.length).toBeGreaterThan(0);
            // A refusal is always for a reason that is certain, and an open question always names what is open.
            if (fit.eligibility === "not_eligible") expect(fit.blockers.length).toBeGreaterThan(0);
            if (fit.eligibility === "needs_verification") expect(fit.doubts.length).toBeGreaterThan(0);
            expect(fit.blockedAsWritten).toBe(fit.leans.some((lean) => lean.leans === "blocked"));
            // Nothing is ever relied on at a lender nobody confirmed. Only what binds every lender is certain there.
            if (products === open) {
              expect(["needs_verification", "not_eligible"]).toContain(fit.eligibility);
              expect(fit.blockers.every((blocker) => blocker.basis !== "lender")).toBe(true);
              expect(fit.strength).toBeNull();
            }
          }
          expect(reading.open).toBe(reading.fits.filter((fit) => fit.eligibility === "eligible" && fit.amount > 0).length);
          expect(reading.unsure).toBe(reading.fits.filter((fit) => fit.eligibility === "needs_verification").length);
          // Among the lenders, a reliable answer is never listed under an unreliable one.
          const order = reading.fits.map((fit) => (fit.eligibility === "eligible" ? 3 : fit.eligibility === "conditional" ? 2 : fit.eligibility === "needs_verification" ? 1 : 0));
          expect(order).toEqual([...order].sort((x, y) => y - x));
        }
        // A debt that stands refuses at every lender, and no lender has to confirm that.
        if (blocked) expect(kind.today.fits.every((fit) => fit.eligibility === "not_eligible")).toBe(true);
      }
      if (products === open) expect(["needs_verification", "not_eligible", "pending"]).toContain(a.verdict);
      if (products === open && a.afterClearing) expect(["needs_verification", "not_eligible"]).toContain(a.afterClearing);

      const codes = a.steps.map((step) => step.code);
      for (const [index, step] of a.steps.entries()) {
        // A lender is asked before the office pays anything on the strength of its terms.
        if (step.code === "CONFIRM_TERMS") {
          expect(step.terms.length).toBeGreaterThan(0);
          expect(step.beforePaying).toBe(blocked);
          if (step.beforePaying) expect(codes.slice(0, index)).not.toContain("CREDIT");
          for (const kind of step.kinds) expect(a.steps.slice(index + 1).some((later) => later.code === "APPLY" && later.lender === step.lender && later.kind === kind)).toBe(true);
          // One lender is asked once.
          expect(a.steps.filter((other) => other.code === "CONFIRM_TERMS" && other.lender === step.lender)).toHaveLength(1);
        }
        // Nobody is sent to a lender that refuses.
        if (step.code === "APPLY") expect(step.eligibility).not.toBe("not_eligible");
        if (step.code === "APPLY" && products === catalogue) expect(codes).not.toContain("CONFIRM_TERMS");
      }
    }
  });
});
