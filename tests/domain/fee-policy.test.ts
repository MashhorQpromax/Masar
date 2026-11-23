import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, FEE_REASON_MIN, feeChanges, feeRefusal, policyFee, policyProblem, type Fee, type FeePolicy } from "@/domain/deal";

/**
 * The office's fee policy and a deal's fee. A new deal starts from the policy; a saved deal keeps its
 * own fee. Setting a fee otherwise needs the right, a percent inside the range, and a written reason.
 */
const policy: FeePolicy = { settlePct: 12, financePct: 10, financeBase: "total", min: 10, max: 30 };
const start = policyFee(policy);
const reason = "تعثر لدى شركة تمويل والجهد أكبر";

describe("the fee policy", () => {
  it("starts from ten percent on each part, inside ten to thirty-five, until the manager sets it", () => {
    expect(DEFAULT_POLICY).toEqual({ settlePct: 10, financePct: 10, financeBase: "total", min: 10, max: 35 });
    expect(policyProblem(DEFAULT_POLICY)).toBeNull();
  });

  it("gives a new deal its percents and base, with nothing extra", () => {
    expect(start).toEqual({ settlePct: 12, settleIncludesPayoff: false, financePct: 10, financeBase: "total", fixed: 0 });
  });

  it("refuses a range that does not hold, and a start outside its own range", () => {
    expect(policyProblem({ ...policy, min: 31 })).toBe("RANGE");
    expect(policyProblem({ ...policy, min: -1 })).toBe("RANGE");
    expect(policyProblem({ ...policy, max: 101 })).toBe("RANGE");
    expect(policyProblem({ ...policy, settlePct: 9 })).toBe("START_OUTSIDE");
    expect(policyProblem({ ...policy, financePct: 31 })).toBe("START_OUTSIDE");
    expect(policyProblem({ ...policy, min: 12, max: 12, settlePct: 12, financePct: 12 })).toBeNull();
  });
});

describe("setting a deal's fee", () => {
  const raised: Fee = { ...start, financePct: 15 };

  it("says which parts changed, in the order they are told", () => {
    expect(feeChanges(start, start)).toEqual([]);
    expect(feeChanges(start, { ...start, fixed: 5000, settlePct: 20 })).toEqual(["settlePct", "fixed"]);
    expect(feeChanges(start, { ...start, financeBase: "personal", settleIncludesPayoff: true })).toEqual(["financeBase", "settleIncludesPayoff"]);
  });

  it("never refuses a fee kept as it was, even one outside today's range, even for someone without the right", () => {
    const old: Fee = { ...start, settlePct: 5 };
    expect(feeRefusal({ before: old, after: old, policy, reason: null, may: false })).toBeNull();
  });

  it("refuses a change from someone without the right, before anything else", () => {
    expect(feeRefusal({ before: start, after: raised, policy, reason, may: false })).toBe("NOT_ALLOWED");
  });

  it("refuses a percent outside the range, on either part", () => {
    expect(feeRefusal({ before: start, after: { ...start, financePct: 31 }, policy, reason, may: true })).toBe("OUT_OF_RANGE");
    expect(feeRefusal({ before: start, after: { ...start, settlePct: 9.5 }, policy, reason, may: true })).toBe("OUT_OF_RANGE");
    expect(feeRefusal({ before: start, after: { ...start, settlePct: 30 }, policy, reason, may: true })).toBeNull();
  });

  it("asks a written reason for every change, the base and the flat amount included", () => {
    expect(feeRefusal({ before: start, after: raised, policy, reason: null, may: true })).toBe("REASON_NEEDED");
    expect(feeRefusal({ before: start, after: raised, policy, reason: `  ${"ا".repeat(FEE_REASON_MIN - 1)}  `, may: true })).toBe("REASON_NEEDED");
    expect(feeRefusal({ before: start, after: { ...start, fixed: 3000 }, policy, reason: null, may: true })).toBe("REASON_NEEDED");
    expect(feeRefusal({ before: start, after: { ...start, financeBase: "mortgage" }, policy, reason: null, may: true })).toBe("REASON_NEEDED");
    expect(feeRefusal({ before: start, after: raised, policy, reason, may: true })).toBeNull();
  });
});
