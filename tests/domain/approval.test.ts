import { describe, expect, it } from "vitest";
import {
  analyzeClient,
  approvalBasis,
  approvalRefusal,
  approvalSummary,
  canonical,
  changedParts,
  completeness,
  REASON_MIN,
  type ClientAnalysis,
  type FileFacts,
  type Fingerprint,
} from "@/domain/analysis";
import { analyzeCredit, emptyReport, type CreditReport } from "@/domain/credit";
import { TERMS, termStanding, type Product, type Term } from "@/domain/eligibility";

/**
 * Approving a client's analysis. A recommendation is complete when nothing about the client is
 * missing, unconfirmed or in dispute and the lender it sends them to stands on confirmed terms. The
 * catalogue's other lenders do not make it incomplete, and do not unsettle an approval.
 */
const confirmed = (open: Term[] = []): Product["terms"] =>
  Object.fromEntries(TERMS.filter((term) => !open.includes(term)).map((term) => [term, termStanding({ kind: "lender_document", reference: "نشرة المنتج، نوفمبر 2026", confirmedOn: "2026-11-01" }, "2026-11-23")]));

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

const clean = (r: Partial<CreditReport> = {}) => {
  const report = { ...emptyReport(), ...r };
  return { report, analysis: analyzeCredit(report), confidence: "high" as const, readingWarnings: 0, ageMonths: 0 };
};

const analyse = (products: Product[], parts: Partial<FileFacts> = {}): ClientAnalysis => analyzeClient({ file: file(parts), record: clean(), products });

/** Two lenders that confirmed everything, and one whose terms nobody confirmed. */
const sure = product("1", "a");
const other = product("2", "b", { rate: 3.6 });
const unsure = product("3", "c", { verified: false, terms: undefined, rate: 2.9 });

const print: Fingerprint = { file: "f1", record: "r1", lenders: "l1", result: "x1" };

describe("what makes a recommendation complete", () => {
  it("is complete when the client's file is whole and the lender it sends them to confirmed its terms", () => {
    const a = analyse([sure, other]);
    expect(a.verdict).toBe("eligible");
    expect(completeness(a)).toEqual({ complete: true, verify: false, missing: 0, unconfirmed: 0, conflict: 0, terms: false, gaps: [] });
  });

  it("stays complete beside a lender of the catalogue nobody confirmed, which it does not send the client to", () => {
    const a = analyse([sure, other, { ...unsure, rate: 4.5 }]);
    // The analysis still lists the unconfirmed product among its gaps.
    expect(a.gaps.map((gap) => gap.code)).toEqual(["TERMS"]);
    expect(a.steps.filter((step) => step.code === "APPLY").map((step) => step.code === "APPLY" && step.lender)).toEqual(["جهة a"]);
    expect(completeness(a).complete).toBe(true);
  });

  it("is incomplete when the lender it sends the client to rests on a term nobody confirmed", () => {
    // The unconfirmed lender has the best rate, so the analysis would send the client there once asked.
    const a = analyse([unsure]);
    expect(a.verdict).toBe("needs_verification");
    expect(completeness(a)).toMatchObject({ complete: false, verify: true, terms: true });
  });

  it("is incomplete when something about the client is missing, and counts each kind", () => {
    const a = analyse([sure], { serviceMonths: null, incomeVerified: false });
    const open = completeness(a);
    expect(open.complete).toBe(false);
    expect(open.missing).toBeGreaterThan(0);
    expect(open.gaps).toContain("SERVICE");
    expect(open.gaps).not.toContain("TERMS");
  });

  it("is incomplete without the client's consent, and is not approved at all", () => {
    const a = analyse([sure], { consent: false });
    expect(a.verdict).toBe("pending");
    expect(completeness(a)).toMatchObject({ complete: false, verify: true, missing: 1 });
    expect(approvalRefusal(a, { reason: "سبب طويل بما يكفي ليُقبل هنا", now: print, standing: null })).toBe("PENDING");
  });
});

describe("approving", () => {
  const complete = analyse([sure, other]);
  const open = analyse([unsure]);

  it("approves a complete recommendation without a reason", () => {
    expect(approvalRefusal(complete, { reason: null, now: print, standing: null })).toBeNull();
  });

  it("approves an incomplete one only with a reason long enough to say why", () => {
    expect(approvalRefusal(open, { reason: null, now: print, standing: null })).toBe("REASON_NEEDED");
    expect(approvalRefusal(open, { reason: "  قصير  ", now: print, standing: null })).toBe("REASON_NEEDED");
    expect(approvalRefusal(open, { reason: "ا".repeat(REASON_MIN - 1), now: print, standing: null })).toBe("REASON_NEEDED");
    expect(approvalRefusal(open, { reason: "الجهة أكدت الشرط هاتفياً وخطابها في الطريق", now: print, standing: null })).toBeNull();
  });

  it("does not approve twice what an approval already stands on, and approves again once a part changed", () => {
    expect(approvalRefusal(complete, { reason: null, now: print, standing: print })).toBe("STANDS");
    expect(approvalRefusal(complete, { reason: null, now: { ...print, file: "f2" }, standing: print })).toBeNull();
  });
});

describe("what an approval rests on", () => {
  it("says which parts changed, in the order they are told", () => {
    expect(changedParts(print, print)).toEqual([]);
    expect(changedParts(print, { file: "f2", record: "r1", lenders: "l2", result: "x2" })).toEqual(["file", "lenders", "result"]);
  });

  it("keeps the lenders the recommendation sends the client to, and nothing of the others", () => {
    const a = analyse([sure, other, { ...unsure, rate: 4.5 }]);
    expect(approvalBasis(a, [sure, other, unsure]).lenders.map((p) => p.id)).toEqual(["1"]);
    // Confirming the unconfirmed lender's terms leaves both prints of the approval as they were.
    const after = analyse([sure, other, { ...unsure, rate: 4.5, verified: true, terms: confirmed() }]);
    expect(canonical(approvalBasis(after, [sure, other, unsure]).result)).toBe(canonical(approvalBasis(a, [sure, other, unsure]).result));
  });

  it("changes when the lender it sends the client to changes its terms", () => {
    const a = analyse([sure, other]);
    const cheaper = analyse([{ ...sure, rate: 2.5 }, other]);
    expect(canonical(approvalBasis(cheaper, [{ ...sure, rate: 2.5 }, other]).lenders)).not.toBe(canonical(approvalBasis(a, [sure, other]).lenders));
  });

  it("keeps what the recommendation said: the result, what was open, and where it sent the client", () => {
    const summary = approvalSummary(analyse([sure, other]));
    expect(summary).toMatchObject({ verdict: "eligible", afterClearing: null, completeness: { complete: true } });
    expect(summary.apply).toEqual([expect.objectContaining({ kind: "personal", lender: "جهة a", product: "منتج", eligibility: "eligible", afterClearing: false })]);
    expect(summary.apply[0]!.amount).toBeGreaterThan(0);
  });
});

describe("the stable text a print is made from", () => {
  it("is the same whatever order the keys were written in, and leaves out what is undefined", () => {
    expect(canonical({ b: 1, a: [1, { d: undefined, c: "x" }] })).toBe(canonical({ a: [1, { c: "x" }], b: 1 }));
    expect(canonical({ a: 1 })).toBe('{"a":1}');
    expect(canonical([undefined, null])).toBe("[null,null]");
    expect(canonical({ a: 1 })).not.toBe(canonical({ a: 2 }));
    expect(canonical(null)).toBe("null");
  });
});
