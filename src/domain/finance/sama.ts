/**
 * Regulatory constants used by every calculation.
 *
 * Source: SAMA Responsible Lending Principles for Individuals (chapter 4, articles 13 to 19,
 * circular 40694/1 of 1439H), the 2018 SAMA circular on mortgage loan-to-value ratios,
 * and the SAMA early settlement rules.
 */
export const SAMA = {
  /** Consumer finance deduction cap for an employee, as a share of gross salary. */
  salaryDeductionEmployee: 0.3333,
  /** Consumer finance deduction cap for a retiree. */
  salaryDeductionRetired: 0.25,
  nonRealEstateCap: 0.45,
  /** Total deduction cap for income up to `lowBracket`. */
  totalCapLow: 0.55,
  /** Total deduction cap for a housing-support beneficiary. */
  totalCapLowHousing: 0.65,
  /** Total deduction cap for income above `lowBracket`. */
  totalCapMid: 0.65,
  /** Longest consumer finance tenor, in months. */
  consumerMaxTenor: 60,
  lowBracket: 15000,
  highBracket: 25000,
  /** Loan-to-value for a citizen's first home, percent. */
  ltvFirstHomeCitizen: 90,
  ltvSecondHome: 70,
  ltvOther: 85,
  retirementAge: 60,
  /** Pension accrual per service year, as a share of basic salary (estimate). */
  pensionAccrual: 0.025,
} as const;
