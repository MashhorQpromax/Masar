import { describe, expect, it } from "vitest";
import { defaultDealInput, type Borrower, type DealInput, type DealItem } from "@/domain/deal";
import {
  addMonths,
  capacity,
  dayOf,
  eligibilityOf,
  eligibilityRank,
  matchProduct,
  openTerms,
  sourceGroups,
  sourceProblem,
  strictMatch,
  termsOf,
  termsTouched,
  termStanding,
  TERMS,
  validUntil,
  weakestStrength,
  type Product,
  type Profile,
  type SourceKind,
  type Term,
  type TermSource,
  type TermStanding,
} from "@/domain/eligibility";
import { fundingRoutes, type Applicant, type RecordAfter } from "@/domain/funding";

/** Worked examples of the strict reading: when an answer can be relied on, and what the four results are. */
const TODAY = "2026-11-23";
const source = (kind: SourceKind = "lender_document", confirmedOn = "2026-11-01"): TermSource => ({ kind, reference: "نشرة المنتج، نوفمبر 2026", confirmedOn });
const standing = (kind: SourceKind = "lender_document", confirmedOn = "2026-11-01"): TermStanding => termStanding(source(kind, confirmedOn), TODAY);
/** Every term confirmed, except the ones named. */
const confirmed = (except: Term[] = [], kind: SourceKind = "lender_document"): Product["terms"] =>
  Object.fromEntries(TERMS.filter((term) => !except.includes(term)).map((term) => [term, standing(kind)]));

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
  ...parts,
});

const read = (p: Profile, item: Product) => strictMatch(matchProduct(p, capacity(p), item));
const of = (result: ReturnType<typeof read>, code: string) => result.findings.find((f) => f.check.code === code)!;

describe("how long a confirmation lasts", () => {
  it("adds months and lands on the last day of a shorter month", () => {
    expect(addMonths("2026-11-23", 3)).toBe("2027-02-23");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(validUntil("2026-08-23")).toBe("2026-11-23");
  });

  it("reads a date as the day it is in Riyadh", () => {
    expect(dayOf(new Date("2026-11-23T20:59:00Z"))).toBe("2026-11-23");
    expect(dayOf(new Date("2026-11-23T21:00:00Z"))).toBe("2026-11-24");
  });

  it("holds a term confirmed up to its last day and expired from the day after", () => {
    expect(termStanding(null, TODAY)).toEqual({ state: "unconfirmed" });
    expect(termStanding(source("lender_document", "2026-08-23"), TODAY)).toMatchObject({ state: "confirmed", strength: "written", validUntil: "2026-11-23" });
    expect(termStanding(source("lender_document", "2026-08-22"), TODAY)).toMatchObject({ state: "expired", validUntil: "2026-11-22" });
    expect(termStanding(source("lender_staff"), TODAY)).toMatchObject({ state: "confirmed", strength: "verbal" });
  });

  it("refuses a source that names nothing, a site with no address, and a day that cannot be", () => {
    expect(sourceProblem(source(), TODAY)).toBeNull();
    expect(sourceProblem({ ...source(), reference: "نشرة" }, TODAY)).toBe("REFERENCE_SHORT");
    expect(sourceProblem({ ...source("lender_website"), reference: "موقع الجهة" }, TODAY)).toBe("LINK_NEEDED");
    expect(sourceProblem({ ...source("lender_website"), reference: "https://example.com/personal" }, TODAY)).toBeNull();
    expect(sourceProblem({ ...source(), confirmedOn: "2026-02-30" }, TODAY)).toBe("DAY_INVALID");
    expect(sourceProblem({ ...source(), confirmedOn: "2026-11-24" }, TODAY)).toBe("DAY_AHEAD");
    expect(sourceProblem({ ...source(), confirmedOn: "2026-08-22" }, TODAY)).toBe("DAY_OLD");
    expect(sourceProblem({ ...source(), confirmedOn: "2026-08-23" }, TODAY)).toBeNull();
  });

  it("knows which terms a product has and which a change touches", () => {
    expect(termsOf("personal")).not.toContain("ltv");
    expect(termsOf("mortgage")).toContain("ltv");
    expect(termsTouched(["minAge"])).toEqual(["age"]);
    expect(termsTouched(["maxAmount", "rateType", "name"])).toEqual(["amount", "rate"]);
    expect(openTerms("personal", confirmed(["salary", "rate"]))).toEqual(["salary", "rate"]);
    expect(openTerms("personal", undefined)).toEqual(termsOf("personal"));
  });

  it("reads the sources back one by one, each with the terms it speaks for", () => {
    const paper = standing("lender_document", "2026-11-01");
    const word = standing("lender_staff", "2026-11-10");
    const old = standing("lender_document", "2026-08-01");
    const groups = sourceGroups("mortgage", { salary: paper, age: paper, rate: word, ltv: paper, tenor: old, service: { state: "unconfirmed" } });
    expect(groups.map((group) => [group.source.kind, group.source.confirmedOn, group.state, group.validUntil, group.terms])).toEqual([
      ["lender_document", "2026-11-01", "confirmed", "2027-02-01", ["salary", "age", "ltv"]],
      ["lender_document", "2026-08-01", "expired", "2026-11-01", ["tenor"]],
      ["lender_staff", "2026-11-10", "confirmed", "2027-02-10", ["rate"]],
    ]);
    // A term the kind of product does not have is not read back, and nothing confirmed reads as nothing.
    expect(sourceGroups("personal", { ltv: paper })).toEqual([]);
    expect(sourceGroups("personal", undefined)).toEqual([]);
  });
});

describe("one product read strictly", () => {
  it("is eligible when every condition is met on confirmed terms", () => {
    const result = read(profile(), product());
    expect(result.eligibility).toBe("eligible");
    expect(result.findings.every((f) => f.outcome === "met")).toBe(true);
    expect(weakestStrength(result.findings)).toBe("written");
  });

  it("needs verification when nobody confirmed the terms, though every answer is yes", () => {
    const result = read(profile(), product({ terms: undefined }));
    expect(result.eligibility).toBe("needs_verification");
    expect(result.blockedAsWritten).toBe(false);
    expect(of(result, "SALARY_MIN")).toMatchObject({ outcome: "unknown", doubt: "TERM_UNCONFIRMED", leans: "met", term: "salary", basis: "lender" });
    // What the regulator sets needs no lender to confirm it.
    expect(of(result, "ROOM")).toMatchObject({ outcome: "met", basis: "regulation", term: null });
  });

  it("needs verification when one term among confirmed ones has expired", () => {
    const result = read(profile(), product({ terms: { ...confirmed(), service: standing("lender_document", "2026-08-01") } }));
    expect(result.eligibility).toBe("needs_verification");
    expect(of(result, "SERVICE_MIN")).toMatchObject({ outcome: "unknown", doubt: "TERM_EXPIRED", leans: "met" });
  });

  it("never counts a missing fact as met", () => {
    const result = read(profile({ age: null }), product());
    expect(result.eligibility).toBe("needs_verification");
    expect(of(result, "AGE_MISSING")).toMatchObject({ outcome: "unknown", doubt: "FACT_MISSING", basis: "client" });
  });

  it("is not eligible on a confirmed condition, and only leans that way on an unconfirmed one", () => {
    const low = profile({ totalSalary: 3500, basicSalary: 3000 });
    const sure = read(low, product());
    expect(sure.eligibility).toBe("not_eligible");
    expect(of(sure, "SALARY_MIN")).toMatchObject({ outcome: "blocked", doubt: null, strength: "written" });

    const unsure = read(low, product({ terms: confirmed(["salary"]) }));
    expect(unsure.eligibility).toBe("needs_verification");
    expect(unsure.blockedAsWritten).toBe(true);
    expect(of(unsure, "SALARY_MIN")).toMatchObject({ outcome: "unknown", leans: "blocked" });
  });

  it("is conditional when the client has something clear to do", () => {
    const result = read(profile({ salaryBank: "b" }), product());
    expect(result.eligibility).toBe("conditional");
    expect(of(result, "SALARY_TRANSFER")).toMatchObject({ outcome: "action", term: "transfer" });
  });

  it("is not eligible when the regulator's limit leaves no room, whatever the lender's terms say", () => {
    const full = profile({ obligations: [{ kind: "personal", monthly: 9000 }] });
    const result = read(full, product({ terms: undefined }));
    expect(of(result, "NO_ROOM")).toMatchObject({ outcome: "blocked", basis: "regulation" });
    expect(result.eligibility).toBe("not_eligible");
  });

  it("is not eligible with an unpaid default at any lender", () => {
    const result = read(profile({ simah: "default" }), product());
    expect(of(result, "RECORD_DEFAULT")).toMatchObject({ outcome: "blocked", basis: "market" });
    expect(result.eligibility).toBe("not_eligible");
  });

  it("takes late payments as met where the lender's confirmed term accepts them", () => {
    const late = profile({ simah: "late" });
    expect(read(late, product({ acceptsLateSimah: true })).eligibility).toBe("eligible");
    expect(read(late, product({ acceptsLateSimah: false })).eligibility).toBe("not_eligible");
    expect(read(late, product({ acceptsLateSimah: true, terms: confirmed(["late"]) })).eligibility).toBe("needs_verification");
  });

  it("carries the weaker source forward", () => {
    const result = read(profile(), product({ terms: { ...confirmed(), salary: standing("lender_staff") } }));
    expect(result.eligibility).toBe("eligible");
    expect(of(result, "SALARY_MIN").strength).toBe("verbal");
    expect(weakestStrength(result.findings)).toBe("verbal");
  });

  it("lets a confirmed blocker decide alone", () => {
    expect(eligibilityOf([{ outcome: "met" }, { outcome: "unknown" }, { outcome: "blocked" }])).toBe("not_eligible");
    expect(eligibilityOf([{ outcome: "met" }, { outcome: "action" }, { outcome: "unknown" }])).toBe("needs_verification");
    expect(eligibilityOf([{ outcome: "met" }, { outcome: "action" }])).toBe("conditional");
    expect(eligibilityOf([])).toBe("eligible");
  });

  it("lists reliable answers first", () => {
    const ranks = [eligibilityRank("eligible", false), eligibilityRank("conditional", false), eligibilityRank("needs_verification", false), eligibilityRank("needs_verification", true), eligibilityRank("not_eligible", false)];
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    expect(new Set(ranks).size).toBe(5);
  });
});

describe("a route read strictly", () => {
  const borrower: Borrower = { age: 35, basicSalary: 12000, totalSalary: 16000, serviceMonths: 120, sector: "gov" };
  const items: DealItem[] = [
    { id: "a", kind: "default", label: "تعثر", original: 50000, pay: 40000, by: "company" },
    { id: "c", kind: "mortgage_payoff", label: "مخالصة العقاري", original: 400000, pay: 380000, by: "company", confirmed: true },
  ];
  const deal: DealInput = { ...defaultDealInput(), items, propertyValue: 800000, transferTaxPct: 0, fixedCosts: 10000 };
  const clean: RecordAfter = { known: true, open: false, settledMonthsAgo: null, delays: false };
  const who = (parts: Partial<Applicant> = {}): Applicant => ({ nationality: "saudi", salaryBank: "a", record: clean, ...parts });
  const mortgage = (id: string, lender: string, parts: Partial<Product> = {}): Product =>
    product({ id, lenderId: lender, lenderName: `جهة ${lender}`, bankCode: lender, financeType: "mortgage", maxAgeAtMaturity: 70, maxTenor: 300, maxAmount: 5_000_000, rate: 5, rateType: "reducing", maxLtv: 90, ...parts });
  const personal = (id: string, lender: string, parts: Partial<Product> = {}): Product => product({ id, lenderId: lender, lenderName: `جهة ${lender}`, bankCode: lender, ...parts });
  const routes = (products: Product[], applicant = who()) => fundingRoutes({ input: deal, borrower, who: applicant, products });

  it("is eligible on confirmed terms with a clean record", () => {
    const [route] = routes([mortgage("1", "a"), personal("2", "a")]);
    expect(route!.eligibility).toBe("eligible");
    expect(route!.doubts).toEqual([]);
    expect(route!.blockers).toEqual([]);
    expect(route!.strength).toBe("written");
  });

  it("needs verification on unconfirmed terms, and names each lender's term once", () => {
    const [route] = routes([mortgage("1", "a", { terms: confirmed(["salary"]) }), personal("2", "a", { terms: confirmed(["salary", "service"]) })]);
    expect(route!.eligibility).toBe("needs_verification");
    expect(route!.status).toBe("pass");
    expect(route!.doubts.map((d) => [d.lender, d.finding.term, d.finding.doubt])).toEqual([
      ["جهة a", "salary", "TERM_UNCONFIRMED"],
      ["جهة a", "service", "TERM_UNCONFIRMED"],
    ]);
  });

  it("needs verification while nobody knows how long the lender waits after a paid default", () => {
    const paid = who({ record: { ...clean, settledMonthsAgo: 0 } });
    const [route] = routes([mortgage("1", "a", { settledDefaultWaitMonths: null }), personal("2", "a")], paid);
    expect(route!.eligibility).toBe("needs_verification");
    expect(route!.doubts.map((d) => d.finding.doubt)).toEqual(["TERM_NOT_KNOWN"]);
  });

  it("is not eligible while a confirmed wait after a paid default has not passed", () => {
    const paid = who({ record: { ...clean, settledMonthsAgo: 0 } });
    const [route] = routes([mortgage("1", "a", { settledDefaultWaitMonths: 12 }), personal("2", "a")], paid);
    expect(route!.eligibility).toBe("not_eligible");
    expect(route!.blockers.map((b) => b.finding.check.code)).toEqual(["SETTLED_WAIT"]);
  });

  it("refuses two salary transfers for certain only when both lenders' terms are confirmed", () => {
    const sure = routes([mortgage("1", "a"), personal("2", "b")])[0]!;
    expect(sure.oneLender).toBe(false);
    expect(sure.eligibility).toBe("not_eligible");
    expect(sure.blockers.map((b) => b.finding.check.code)).toContain("TWO_SALARY_TRANSFERS");

    const unsure = routes([mortgage("1", "a"), personal("2", "b", { terms: confirmed(["transfer"]) })])[0]!;
    expect(unsure.eligibility).toBe("needs_verification");
    expect(unsure.blockedAsWritten).toBe(true);
  });

  it("says once what the client has to do first, and only on a term that can be relied on", () => {
    const elsewhere = who({ salaryBank: "x" });
    const [sure] = routes([mortgage("1", "a"), personal("2", "a")], elsewhere);
    expect(sure!.eligibility).toBe("conditional");
    expect(sure!.actions.map((a) => [a.lender, a.finding.check.code])).toEqual([["جهة a", "SALARY_TRANSFER"]]);
    expect(sure!.doubts).toEqual([]);

    // Nobody confirmed that this lender wants the salary: it is something to ask, not something to tell the client.
    const [unsure] = routes([mortgage("1", "a", { terms: confirmed(["transfer"]) }), personal("2", "a", { terms: confirmed(["transfer"]) })], elsewhere);
    expect(unsure!.eligibility).toBe("needs_verification");
    expect(unsure!.actions).toEqual([]);
    expect(unsure!.doubts.map((d) => [d.finding.term, d.finding.doubt])).toEqual([["transfer", "TERM_UNCONFIRMED"]]);
  });

  it("remarks on what a lender is confirmed to take, and not on a term cut short by age", () => {
    const takes = { acceptsLateSimah: true };
    const [late] = routes([mortgage("1", "a", takes), personal("2", "a", takes)], who({ record: { ...clean, delays: true } }));
    expect(late!.eligibility).toBe("eligible");
    expect(late!.remarks.map((r) => [r.lender, r.finding.check.code, r.finding.outcome])).toEqual([["جهة a", "RECORD_LATE", "met"]]);
    expect(late!.actions).toEqual([]);

    const old = fundingRoutes({ input: deal, borrower: { ...borrower, age: 62 }, who: who(), products: [mortgage("1", "a"), personal("2", "a")] })[0]!;
    expect(old.personal!.months).toBe(36);
    expect(old.eligibility).toBe("eligible");
    expect(old.remarks).toEqual([]);
  });

  it("lists a route that can be relied on above one that cannot, though the other leaves the client more", () => {
    const list = routes([mortgage("1", "a", { maxAmount: 650_000 }), mortgage("3", "c", { terms: undefined }), personal("2", "a"), personal("4", "c", { terms: undefined })]);
    const [first, second] = list;
    expect(first!.closes && second!.closes).toBe(true);
    expect(second!.study.clientNet).toBeGreaterThan(first!.study.clientNet);
    expect([first!.eligibility, second!.eligibility]).toEqual(["eligible", "needs_verification"]);
  });
});
