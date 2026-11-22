import { SAMA } from "../finance/sama";
import type { DealInput, Fee } from "./types";

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
    financeBase: o.financeBase === "personal" || o.financeBase === "mortgage" ? o.financeBase : "total",
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
