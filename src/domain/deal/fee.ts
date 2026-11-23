import { SAMA } from "../finance/sama";
import type { DealInput, Fee, FinanceBase } from "./types";

/** The company's fee range, percent. */
export const FEE_MIN = 10;
export const FEE_MAX = 35;

const DEFAULT_FEE: Fee = { settlePct: 10, settleIncludesPayoff: false, financePct: 10, financeBase: "total", fixed: 0 };

const numberOr = (value: unknown, fallback: number): number =>
  value == null || value === "" || !Number.isFinite(Number(value)) ? fallback : Number(value);

/** Accepts any stored fee shape, including older ones, and returns the current shape. */
export function normalizeFee(fee: unknown): Fee {
  if (!fee || typeof fee !== "object") return { ...DEFAULT_FEE };
  const o = fee as Record<string, unknown>;
  return {
    settlePct: numberOr(o.settlePct, DEFAULT_FEE.settlePct),
    settleIncludesPayoff: !!o.settleIncludesPayoff,
    financePct: numberOr(o.financePct, DEFAULT_FEE.financePct),
    financeBase: o.financeBase === "personal" || o.financeBase === "mortgage" || o.financeBase === "net" ? o.financeBase : "total",
    fixed: numberOr(o.fixed, 0),
  };
}

export function defaultDealInput(): DealInput {
  return {
    structure: "settle_refi_personal",
    items: [],
    propertyValue: null,
    transferTaxPct: 5,
    saleTaxPct: 0,
    fixedCosts: 10000,
    fee: normalizeFee(null),
    targetBank: null,
    mortgageApr: 5.5,
    personalFlat: 3,
    personalMonths: 60,
    mortgageMaxAge: 70,
    mortgageMaxMonths: 300,
    ltvPct: SAMA.ltvFirstHomeCitizen,
    bankMortgage: null,
    bankPersonal: null,
    notes: "",
  };
}

/** When the office's fee falls due: as the new financing is paid out, at the lender's approval, or at the agreement. */
export const FEE_DUES = ["disbursement", "approval", "agreement"] as const;
export type FeeDue = (typeof FEE_DUES)[number];

/** How the fee is collected: taken out of the new financing as it is paid out, or paid by the client by transfer. */
export const FEE_COLLECTIONS = ["deducted", "transfer"] as const;
export type FeeCollection = (typeof FEE_COLLECTIONS)[number];

/** The terms a fee is owed on. An approved plan keeps the ones it was approved under. */
export interface FeeTerms {
  due: FeeDue;
  collection: FeeCollection;
}

/** The office's model as its owner described it: the fee comes out of the new financing when it is paid out. */
export const DEFAULT_TERMS: FeeTerms = { due: "disbursement", collection: "deducted" };

/** A fee is taken out of the financing only when it falls due as the financing is paid out: before that there is nothing to take it from. */
export const termsHold = (terms: FeeTerms): boolean => terms.collection !== "deducted" || terms.due === "disbursement";

/** Terms as they were stored, or null when what was stored does not read as terms. */
export function readTerms(value: unknown): FeeTerms | null {
  if (!value || typeof value !== "object") return null;
  const { due, collection } = value as Record<string, unknown>;
  const terms = { due, collection } as FeeTerms;
  return (FEE_DUES as readonly unknown[]).includes(due) && (FEE_COLLECTIONS as readonly unknown[]).includes(collection) && termsHold(terms) ? terms : null;
}

/**
 * The office's fee policy, set by the manager: the percents a new deal starts from, the range no
 * deal's percent may leave, and the terms a fee is owed on. A deal keeps its own fee once saved, so a
 * new policy changes no deal, and an approved plan keeps the terms it was approved under.
 */
export interface FeePolicy extends FeeTerms {
  settlePct: number;
  financePct: number;
  financeBase: FinanceBase;
  /** The lowest and the highest percent a deal may carry, each of its two percents alike. */
  min: number;
  max: number;
}

export const DEFAULT_POLICY: FeePolicy = { settlePct: FEE_MIN, financePct: FEE_MIN, financeBase: "total", min: FEE_MIN, max: FEE_MAX, ...DEFAULT_TERMS };

/** The terms a plan approved under this policy is owed on. */
export const policyTerms = (policy: FeeTerms): FeeTerms => ({ due: policy.due, collection: policy.collection });

/** The fee a new deal starts from under a policy. */
export const policyFee = (policy: FeePolicy): Fee => ({ settlePct: policy.settlePct, settleIncludesPayoff: false, financePct: policy.financePct, financeBase: policy.financeBase, fixed: 0 });

/**
 * Why a policy cannot be kept. Null when it can.
 * - `RANGE`: the lowest is above the highest, or either is outside 0 to 100.
 * - `START_OUTSIDE`: a starting percent is outside the policy's own range.
 * - `TERMS`: the fee is to be taken out of the financing before the financing is paid out.
 */
export type PolicyProblem = "RANGE" | "START_OUTSIDE" | "TERMS";

export function policyProblem(policy: FeePolicy): PolicyProblem | null {
  const { min, max } = policy;
  if (!(min >= 0 && max <= 100 && min <= max)) return "RANGE";
  if ([policy.settlePct, policy.financePct].some((pct) => pct < min || pct > max)) return "START_OUTSIDE";
  if (!termsHold(policy)) return "TERMS";
  return null;
}

/** The parts of a fee, in the order they are told. */
export const FEE_PARTS = ["settlePct", "financePct", "financeBase", "settleIncludesPayoff", "fixed"] as const satisfies readonly (keyof Fee)[];
export type FeePart = (typeof FEE_PARTS)[number];

/** What differs between two fees. Empty: the same fee. */
export const feeChanges = (before: Fee, after: Fee): FeePart[] => FEE_PARTS.filter((part) => before[part] !== after[part]);

/** The shortest reason for setting a fee other than the one a deal had, or started from. */
export const FEE_REASON_MIN = 10;
export const FEE_REASON_MAX = 300;

/**
 * Why a deal's fee may not be set as asked. Null when it may, including when it is not changed: a fee
 * kept as it was is never refused, even one an older policy allowed.
 * - `NOT_ALLOWED`: the person may change a deal but not its fee.
 * - `OUT_OF_RANGE`: a percent is outside the policy's range.
 * - `REASON_NEEDED`: no written reason, or too short a one.
 */
export type FeeRefusal = "NOT_ALLOWED" | "OUT_OF_RANGE" | "REASON_NEEDED";

export function feeRefusal(args: { before: Fee; after: Fee; policy: FeePolicy; reason: string | null; may: boolean }): FeeRefusal | null {
  const { before, after, policy } = args;
  if (feeChanges(before, after).length === 0) return null;
  if (!args.may) return "NOT_ALLOWED";
  if ([after.settlePct, after.financePct].some((pct) => pct < policy.min || pct > policy.max)) return "OUT_OF_RANGE";
  if ((args.reason?.trim().length ?? 0) < FEE_REASON_MIN) return "REASON_NEEDED";
  return null;
}
