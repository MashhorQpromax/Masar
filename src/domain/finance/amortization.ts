import { SAMA } from "./sama";

export type RateType = "flat" | "reducing";

/** Principal that a monthly installment can carry over `months` at an annual `rate` percent. */
export function principalFrom(installment: number, months: number, rate: number, type: RateType): number {
  if (installment <= 0 || months <= 0) return 0;
  if (type === "flat") {
    const years = months / 12;
    return (installment * months) / (1 + (rate / 100) * years);
  }
  const r = rate / 100 / 12;
  if (r === 0) return installment * months;
  return (installment * (1 - Math.pow(1 + r, -months))) / r;
}

/** Monthly installment for a principal over `months` at an annual `rate` percent. */
export function installmentFor(principal: number, months: number, rate: number, type: RateType): number {
  if (principal <= 0 || months <= 0) return 0;
  if (type === "flat") return (principal * (1 + (rate / 100) * (months / 12))) / months;
  const r = rate / 100 / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

/** Effective annual rate (monthly IRR times 12) of a fixed installment, percent with two decimals. */
export function aprOf(principal: number, installment: number, months: number): number {
  if (principal <= 0 || installment <= 0 || months <= 0 || installment * months <= principal) return 0;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const pv = (installment * (1 - Math.pow(1 + mid, -months))) / mid;
    if (pv > principal) lo = mid;
    else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 12 * 10000) / 100;
}

/** Lender administrative fee: 1 percent capped at 5,000 (SAMA cap). */
export function adminFee(principal: number): number {
  return Math.min(5000, Math.round(principal * 0.01));
}

/** Outstanding balance after `paid` installments on a reducing-balance loan. */
export function balanceAfter(principal: number, apr: number, months: number, paid: number): number {
  const r = apr / 100 / 12;
  if (r === 0) return principal * (1 - paid / months);
  const installment = (principal * r) / (1 - Math.pow(1 + r, -months));
  return principal * Math.pow(1 + r, paid) - (installment * (Math.pow(1 + r, paid) - 1)) / r;
}

/** Early settlement under SAMA rules: balance plus at most three months of term cost. */
export function earlySettlement(principal: number, apr: number, months: number, afterMonths: number) {
  const balance = Math.max(0, balanceAfter(principal, apr, months, afterMonths));
  const fee = balance * (apr / 100 / 12) * 3;
  return { balance: Math.round(balance), fee: Math.round(fee), total: Math.round(balance + fee) };
}

/** Estimated retirement pension from basic salary and service years at retirement. */
export function pensionEstimate(basic: number, serviceYearsAtRetirement: number): number {
  return Math.round(basic * Math.min(1, Math.max(0, serviceYearsAtRetirement) * SAMA.pensionAccrual));
}

/**
 * Estimated payoff of an existing loan before the lender's liability letter arrives:
 * present value of the remaining installments plus three months of term cost, never above the remaining balance.
 */
export function payoffEstimate(monthly: number, remaining: number, apr: number): number {
  if (!monthly || !remaining) return remaining || 0;
  const n = Math.max(1, Math.round(remaining / monthly));
  const r = apr / 100 / 12;
  const pv = (monthly * (1 - Math.pow(1 + r, -n))) / r;
  return Math.round(Math.min(remaining, pv + pv * r * 3));
}
