import { describe, expect, it } from "vitest";
import { analyzeClient, type FileFacts, type RecordFacts } from "@/domain/analysis";
import { analyzeCredit, emptyReport, type CreditReport, type Facility } from "@/domain/credit";
import { defaultDealInput, type Borrower, type DealInput } from "@/domain/deal";
import {
  askedOf,
  capacity,
  conditionProblem,
  contractOf,
  listCheck,
  matchProduct,
  specialChecks,
  strictMatch,
  termStanding,
  TERMS,
  type Product,
  type Profile,
  type SpecialCondition,
  type SpecialFacts,
  type Term,
} from "@/domain/eligibility";
import { fundingRoutes, type Applicant, type RecordAfter } from "@/domain/funding";

/**
 * Worked examples of a lender's special conditions: what the engine measures itself, what a person
 * answers for each client, and what each does to the four results.
 */
const TODAY = "2026-11-23";
const confirmed = (except: Term[] = []): Product["terms"] =>
  Object.fromEntries(TERMS.filter((term) => !except.includes(term)).map((term) => [term, termStanding({ kind: "lender_document", reference: "نشرة المنتج", confirmedOn: "2026-11-01" }, TODAY)]));

const product = (parts: Partial<Product> = {}): Product => ({
  id: "1",
  lenderId: "a",
  lenderName: "جهة أ",
  lenderType: "bank",
  bankCode: "a",
  financeType: "personal",
  name: "منتج",
  minSalary: 4000,
  minAge: 21,
  maxAgeAtMaturity: 65,
  minServiceMonths: 3,
  sectors: ["gov", "military", "semi_gov", "retired", "self"],
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
  terms: confirmed(),
  ...parts,
});

const profile = (parts: Partial<Profile> = {}): Profile => ({
  age: 35,
  nationality: "saudi",
  sector: "gov",
  serviceMonths: 120,
  basicSalary: 12000,
  totalSalary: 16000,
  salaryBank: "a",
  simah: "clean",
  financeType: "personal",
  requestedAmount: 100000,
  requestedTenor: 60,
  obligations: [],
  contractType: "permanent",
  inquiries: { m6: 1, m12: 2 },
  ...parts,
});

const facts = (parts: Partial<SpecialFacts> = {}): SpecialFacts => ({ amount: 100000, most: 300000, contract: "permanent", noContract: false, inquiries: { m6: 1, m12: 4 }, answers: {}, ...parts });
const read = (p: Profile, item: Product) => strictMatch(matchProduct(p, capacity(p), item));
const codes = (list: SpecialCondition[], known: Partial<SpecialFacts> = {}) => specialChecks(list, facts(known)).map((check) => [check.code, check.status]);

const least: SpecialCondition = { id: "1", kind: "min_amount", amount: 150000 };
const six: SpecialCondition = { id: "2", kind: "inquiries", count: 3, months: 6 };
const year: SpecialCondition = { id: "3", kind: "inquiries", count: 3, months: 12 };
const post: SpecialCondition = { id: "4", kind: "contract", contracts: ["permanent", "fixed_term"] };
const guarantor: SpecialCondition = { id: "5", kind: "guarantor", text: "موظف حكومي", unmet: "action" };
const employer: SpecialCondition = { id: "6", kind: "employer", text: null, unmet: "block" };

describe("what the engine measures of a lender's special conditions", () => {
  it("holds a least amount against what the lender would lend, and against the most it could", () => {
    expect(codes([least], { amount: 150000 })).toEqual([["AMOUNT_MIN", "pass"]]);
    // The client asked for less than the least and could be lent more: asking for more meets it.
    expect(codes([least], { amount: 100000, most: 300000 })).toEqual([["AMOUNT_MIN", "warn"]]);
    // The most the lender could lend is under its own least: nothing to ask for.
    expect(codes([least], { amount: 100000, most: 120000 })).toEqual([["AMOUNT_MIN", "fail"]]);
  });

  it("counts inquiries in the window the lender names", () => {
    expect(codes([six, year], { inquiries: { m6: 3, m12: 4 } })).toEqual([
      ["INQUIRIES", "pass"],
      ["INQUIRIES", "fail"],
    ]);
    expect(specialChecks([year], facts())[0]).toEqual({ key: "special", status: "fail", code: "INQUIRIES", ref: "3", params: { count: 4, max: 3, months: 12 } });
  });

  it("never reads a count the record does not give as none", () => {
    // No record at all, and a record that gives one window only: the limit is unanswered, and said once.
    expect(codes([six, year], { inquiries: null })).toEqual([["INQUIRIES_UNKNOWN", "warn"]]);
    expect(codes([six, year], { inquiries: { m6: 0, m12: null } })).toEqual([
      ["INQUIRIES", "pass"],
      ["INQUIRIES_UNKNOWN", "warn"],
    ]);
  });

  it("holds the kind of contract against the ones the lender takes", () => {
    expect(codes([post], { contract: "fixed_term" })).toEqual([["CONTRACT", "pass"]]);
    expect(codes([post], { contract: "probation" })).toEqual([["CONTRACT", "fail"]]);
    // Nobody wrote the contract down: unanswered, never met.
    expect(codes([post], { contract: null })).toEqual([["CONTRACT_MISSING", "warn"]]);
    // A pensioner and someone who works for themselves have no contract for the lender to ask about.
    expect(codes([post], { contract: null, noContract: true })).toEqual([]);
  });

  it("reads a stored kind of contract only when it is one the office picks from", () => {
    expect([contractOf("permanent"), contractOf("fixed_term"), contractOf("probation")]).toEqual(["permanent", "fixed_term", "probation"]);
    expect([contractOf(null), contractOf(""), contractOf("temporary")]).toEqual([null, null, null]);
  });
});

describe("what a person answers for each client", () => {
  it("leaves a question open until somebody answers it", () => {
    expect(codes([guarantor, employer])).toEqual([
      ["ASKED_OPEN", "warn"],
      ["ASKED_OPEN", "warn"],
    ]);
    expect(askedOf([least, guarantor, post, employer]).map((c) => c.id)).toEqual(["5", "6"]);
    expect(askedOf(undefined)).toEqual([]);
  });

  it("reads an answer by what the lender does with a client who does not meet the condition", () => {
    expect(codes([guarantor, employer], { answers: { "5": "met", "6": "met" } })).toEqual([
      ["ASKED", "pass"],
      ["ASKED", "pass"],
    ]);
    // No guarantor yet is something to bring. An employer off the list is a refusal.
    expect(codes([guarantor, employer], { answers: { "5": "unmet", "6": "unmet" } })).toEqual([
      ["ASKED", "warn"],
      ["ASKED", "fail"],
    ]);
  });

  it("keeps two conditions of one kind apart by naming each", () => {
    const second: SpecialCondition = { id: "7", kind: "guarantor", text: "من الدرجة الأولى", unmet: "action" };
    const checks = specialChecks([guarantor, second], facts({ answers: { "7": "met" } }));
    expect(checks.map((check) => ["ref" in check ? check.ref : null, check.code])).toEqual([
      ["5", "ASKED_OPEN"],
      ["7", "ASKED"],
    ]);
  });
});

describe("the four results with special conditions", () => {
  it("adds nothing to a product that has none, and still asks whether the list is complete", () => {
    const plain = matchProduct(profile(), capacity(profile()), product());
    expect(plain.checks.some((check) => check.key === "special")).toBe(false);
    expect(listCheck(undefined)).toEqual({ key: "special", status: "pass", code: "SPECIAL_LIST", params: { count: 0 } });
    expect(read(profile(), product()).eligibility).toBe("eligible");
    // An empty list nobody confirmed is not a lender that asks for nothing.
    const open = read(profile(), product({ terms: confirmed(["special"]) }));
    expect(open.eligibility).toBe("needs_verification");
    expect(open.doubts.map((doubt) => [doubt.check.code, doubt.doubt, doubt.term])).toEqual([["SPECIAL_LIST", "TERM_UNCONFIRMED", "special"]]);
  });

  it("is eligible when every confirmed condition is met", () => {
    const all = product({ special: [{ ...least, amount: 50000 }, six, post, guarantor] });
    expect(read(profile({ answers: { "5": "met" } }), all).eligibility).toBe("eligible");
  });

  it("refuses for certain on a confirmed condition the client fails, whatever the figures say", () => {
    const strict = product({ special: [post] });
    const result = read(profile({ contractType: "probation" }), strict);
    expect(result.eligibility).toBe("not_eligible");
    expect(result.blockers.map((blocker) => blocker.check.code)).toEqual(["CONTRACT"]);
    // The same failure on a list nobody confirmed is only what the record leans to.
    const loose = read(profile({ contractType: "probation" }), product({ special: [post], terms: confirmed(["special"]) }));
    expect([loose.eligibility, loose.blockedAsWritten]).toEqual(["needs_verification", true]);
    expect(loose.blockers).toEqual([]);
  });

  it("needs checking while a fact is missing or a question is unanswered, though the list is confirmed", () => {
    const asks = product({ special: [six, post, guarantor] });
    const result = read(profile({ contractType: null, inquiries: null }), asks);
    expect(result.eligibility).toBe("needs_verification");
    expect(result.doubts.map((doubt) => [doubt.check.code, doubt.doubt])).toEqual([
      ["INQUIRIES_UNKNOWN", "FACT_MISSING"],
      ["CONTRACT_MISSING", "FACT_MISSING"],
      ["ASKED_OPEN", "FACT_MISSING"],
    ]);
  });

  it("is conditional when what is missing is something the client can bring", () => {
    const result = read(profile({ answers: { "5": "unmet" } }), product({ special: [guarantor] }));
    expect(result.eligibility).toBe("conditional");
    expect(result.actions.map((action) => action.check.code)).toEqual(["ASKED"]);
    // Asking for less than the lender's least, where more could be lent, is the same: ask for more.
    const small = read(profile({ requestedAmount: 20000 }), product({ special: [{ ...least, amount: 50000 }] }));
    expect([small.eligibility, small.actions.map((action) => action.check.code)]).toEqual(["conditional", ["AMOUNT_MIN"]]);
  });
});

describe("special conditions on the ways to fund a deal", () => {
  const deal: DealInput = {
    ...defaultDealInput(),
    structure: "settle_personal",
    items: [{ id: "a", kind: "execution", label: "قرار تنفيذ", original: 60000, pay: 60000, by: "company" }],
  };
  const borrower: Borrower = { age: 35, basicSalary: 12000, totalSalary: 16000, serviceMonths: 120, sector: "gov" };
  const clean: RecordAfter = { known: true, open: false, settledMonthsAgo: null, delays: false, inquiries: { m6: 1, m12: 2 } };
  const who = (parts: Partial<Applicant> = {}): Applicant => ({ nationality: "saudi", salaryBank: "a", record: clean, contractType: "permanent", answers: {}, ...parts });
  const route = (item: Product, applicant = who()) => fundingRoutes({ input: deal, borrower, who: applicant, products: [item] })[0]!;

  it("reads each one against the applicant and the record after the settlement", () => {
    const item = product({ special: [six, post, guarantor] });
    expect(route(item, who({ answers: { "5": "met" } })).eligibility).toBe("eligible");
    const open = route(item);
    expect(open.eligibility).toBe("needs_verification");
    expect(open.doubts.map((doubt) => [doubt.lender, doubt.finding.check.code])).toEqual([["جهة أ", "ASKED_OPEN"]]);
    // A settlement does not take inquiries off the record.
    const busy = route(item, who({ record: { ...clean, inquiries: { m6: 6, m12: 9 } }, answers: { "5": "met" } }));
    expect(busy.eligibility).toBe("not_eligible");
    expect(busy.blockers.map((blocker) => blocker.finding.check.code)).toEqual(["INQUIRIES"]);
  });

  it("asks whether the list is complete, on a product with no condition written", () => {
    expect(route(product()).eligibility).toBe("eligible");
    const open = route(product({ terms: confirmed(["special"]) }));
    expect(open.eligibility).toBe("needs_verification");
    expect(open.doubts.map((doubt) => doubt.finding.term)).toEqual(["special"]);
  });
});

describe("special conditions in a client's analysis", () => {
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
    contractType: "permanent",
    answers: {},
    ...parts,
  });
  const loan = (parts: Partial<Facility>): Facility => ({ lender: "بنك", creditorType: "bank", product: "قرض شخصي", status: "current", ...parts });
  const report = (parts: Partial<CreditReport> = {}): CreditReport => ({ ...emptyReport(), facilities: [loan({ installment: 1000, balance: 20000 })], inquiries6m: 1, inquiries12m: 2, ...parts });
  const record = (r: CreditReport): RecordFacts => ({ report: r, analysis: analyzeCredit(r), confidence: "high", readingWarnings: 0, ageMonths: 0 });

  it("tells the office to ask the client what the lender asks, before the application", () => {
    const asks = product({ special: [guarantor, employer] });
    const a = analyzeClient({ file: file(), record: record(report()), products: [asks] });
    expect(a.verdict).toBe("needs_verification");
    expect(a.steps.map((step) => step.code)).toEqual(["ASK_CLIENT", "APPLY"]);
    expect(a.steps[0]).toEqual({
      code: "ASK_CLIENT",
      lender: "جهة أ",
      questions: [
        { kind: "guarantor", text: "موظف حكومي" },
        { kind: "employer", text: null },
      ],
      beforePaying: false,
    });
    // Once answered, nothing is left to ask.
    const done = analyzeClient({ file: file({ answers: { "5": "met", "6": "met" } }), record: record(report()), products: [asks] });
    expect([done.verdict, done.steps.map((step) => step.code)]).toEqual(["eligible", ["APPLY"]]);
  });

  it("asks before anything is paid when the lender only opens after the record is cleared", () => {
    const owing = report({ facilities: [loan({ status: "default", defaultAmount: 40000, defaultNow: 40000 })] });
    const a = analyzeClient({ file: file(), record: record(owing), products: [product({ special: [guarantor] })] });
    const steps = a.steps.map((step) => step.code);
    expect(steps).toContain("ASK_CLIENT");
    expect(steps.indexOf("ASK_CLIENT")).toBeLessThan(steps.indexOf("CREDIT"));
    expect(a.steps.find((step) => step.code === "ASK_CLIENT")).toMatchObject({ beforePaying: true });
  });

  it("asks for the kind of contract only where a lender makes a condition of it", () => {
    const none = analyzeClient({ file: file({ contractType: null }), record: record(report()), products: [product()] });
    expect(none.gaps.map((gap) => gap.code)).not.toContain("CONTRACT");
    const needed = analyzeClient({ file: file({ contractType: null }), record: record(report()), products: [product({ special: [post] })] });
    expect(needed.gaps).toContainEqual({ kind: "missing", code: "CONTRACT" });
    expect(needed.steps.find((step) => step.code === "COMPLETE_FILE")).toEqual({ code: "COMPLETE_FILE", missing: ["CONTRACT"] });
    expect(needed.verdict).toBe("needs_verification");
  });

  it("reads the record's own count of inquiries", () => {
    const limit = product({ special: [six] });
    const busy = analyzeClient({ file: file(), record: record(report({ inquiries6m: 5 })), products: [limit] });
    expect(busy.verdict).toBe("not_eligible");
    const quiet = analyzeClient({ file: file(), record: record(report({ inquiries6m: 3 })), products: [limit] });
    expect(quiet.verdict).toBe("eligible");
    // A report that does not give the count leaves the limit unanswered.
    const blank = analyzeClient({ file: file(), record: record(report({ inquiries6m: null })), products: [limit] });
    expect(blank.verdict).toBe("needs_verification");
  });
});

describe("what a list of special conditions can hold", () => {
  const most = { maxAmount: 500000 };

  it("says each thing once", () => {
    expect(conditionProblem([], { kind: "min_amount", amount: 20000 }, most)).toBeNull();
    expect(conditionProblem([least], { kind: "min_amount", amount: 20000 }, most)).toBe("TWICE");
    // One limit of inquiries for each window.
    expect(conditionProblem([six], { kind: "inquiries", count: 5, months: 12 }, most)).toBeNull();
    expect(conditionProblem([six], { kind: "inquiries", count: 5, months: 6 }, most)).toBe("TWICE");
    expect(conditionProblem([post], { kind: "contract", contracts: ["permanent"] }, most)).toBe("TWICE");
    // The same question in the same words is one question. Other words make another.
    expect(conditionProblem([guarantor], { kind: "guarantor", text: " موظف  حكومي ", unmet: "block" }, most)).toBe("TWICE");
    expect(conditionProblem([guarantor], { kind: "guarantor", text: "من الدرجة الأولى", unmet: "block" }, most)).toBeNull();
    expect(conditionProblem([guarantor], { kind: "collateral", text: "موظف حكومي", unmet: "block" }, most)).toBeNull();
  });

  it("refuses a condition that asks nothing or leaves nothing to lend", () => {
    expect(conditionProblem([], { kind: "min_amount", amount: 500001 }, most)).toBe("ABOVE_MOST");
    expect(conditionProblem([], { kind: "min_amount", amount: 500000 }, most)).toBeNull();
    expect(conditionProblem([], { kind: "contract", contracts: ["permanent", "fixed_term", "probation"] }, most)).toBe("EVERY_CONTRACT");
    expect(conditionProblem([], { kind: "contract", contracts: [] }, most)).toBe("EVERY_CONTRACT");
    expect(conditionProblem([], { kind: "other", text: "  ", unmet: "block" }, most)).toBe("NOTHING_SAID");
    expect(conditionProblem([], { kind: "other", text: "فحص طبي", unmet: "action" }, most)).toBeNull();
    // A known kind needs no words: its name says what is asked.
    expect(conditionProblem([], { kind: "employer", text: null, unmet: "block" }, most)).toBeNull();
  });
});
