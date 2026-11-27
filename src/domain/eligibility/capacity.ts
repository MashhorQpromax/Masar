import { SAMA } from "../finance/sama";
import { round0, round1 } from "../shared/num";
import type { Capacity, CapacityWarning, CapRule, Profile } from "./types";

/** Share of a documented regular income that counts beside the salary (SAMA, article 14 b). */
export const OTHER_INCOME_SHARE = 0.5;
/** The total cap applied to a mortgage when income is at or above the high bracket and the lender's policy is not known. */
export const HIGH_INCOME_MORTGAGE_CAP = 0.65;

/** What counts as income: the salary, half of a documented regular income, and for a mortgage the co-borrower's income. */
export function incomeOf(p: Profile): { salary: number; other: number; co: number; total: number } {
  const salary = p.totalSalary ?? p.basicSalary ?? 0;
  const other = Math.max(0, p.otherIncome ?? 0) * OTHER_INCOME_SHARE;
  const co = p.financeType === "mortgage" ? Math.max(0, p.coIncome ?? 0) : 0;
  return { salary, other, co, total: salary + other + co };
}

/**
 * The monthly installment the client can still take on.
 *
 * Each rule gives the room it leaves and the tightest one binds. Consumer finance is held by the
 * deduction from the salary (a third for an employee, a quarter of a pension), by 45 percent for
 * everything that is not a mortgage, and by the total cap. A mortgage is held by the total cap alone.
 */
export function capacity(p: Profile): Capacity {
  const warnings: CapacityWarning[] = [];
  const { salary, other, co, total } = incomeOf(p);
  if (!p.totalSalary && p.basicSalary) warnings.push("BASIC_SALARY_USED");
  const obligations = p.obligations ?? [];
  const existingMortgage = obligations.filter((o) => o.kind === "mortgage").reduce((s, o) => s + (o.monthly || 0), 0);
  const existingTotal = obligations.reduce((s, o) => s + (o.monthly || 0), 0);
  const existingNonRealEstate = existingTotal - existingMortgage;
  const retired = p.sector === "retired";
  const mortgage = p.financeType === "mortgage";
  const salaryDeductionCap = retired ? SAMA.salaryDeductionRetired : SAMA.salaryDeductionEmployee;

  let totalCap: number | null;
  if (total <= SAMA.lowBracket) totalCap = p.housingSupport ? SAMA.totalCapLowHousing : SAMA.totalCapLow;
  else if (total < SAMA.highBracket) totalCap = SAMA.totalCapMid;
  else totalCap = null;

  const rules: { room: number; rule: CapRule; share: number }[] = [];
  if (mortgage) {
    const share = totalCap ?? HIGH_INCOME_MORTGAGE_CAP;
    if (totalCap === null) warnings.push("HIGH_INCOME_CAP_ASSUMED");
    rules.push({ room: total * share - existingTotal, rule: "TOTAL_CAP", share });
  } else {
    // The deduction tied to the salary covers every consumer installment and card.
    rules.push({ room: salary * salaryDeductionCap - existingNonRealEstate, rule: "SALARY_DEDUCTION", share: salaryDeductionCap });
    if (total < SAMA.highBracket) rules.push({ room: total * SAMA.nonRealEstateCap - existingNonRealEstate, rule: "NON_REAL_ESTATE", share: SAMA.nonRealEstateCap });
    if (totalCap !== null) rules.push({ room: total * totalCap - existingTotal, rule: "TOTAL_CAP", share: totalCap });
  }
  const binding = rules.reduce((tightest, next) => (next.room < tightest.room ? next : tightest));
  const available = Math.max(0, binding.room);
  const counted = mortgage ? existingTotal : existingNonRealEstate;

  return {
    income: round0(total),
    salary,
    otherIncome: other,
    coIncome: co,
    existingTotal: round0(existingTotal),
    existingNonRealEstate: round0(existingNonRealEstate),
    existingMortgage: round0(existingMortgage),
    salaryDeductionCap,
    totalCap,
    capUsed: binding.share,
    maxInstallment: round0(available + counted),
    available: round0(available),
    currentDbr: total > 0 ? round1((existingTotal / total) * 100) : 0,
    rule: binding.rule,
    retired,
    mortgage,
    warnings,
  };
}
