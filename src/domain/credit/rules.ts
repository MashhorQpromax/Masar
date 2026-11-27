import type { CreditorType } from "./types";

/**
 * How the market reads a credit record. These are the company's working estimates, not published
 * rules: a default at a finance company weighs more than one at a bank, and a court order or a
 * service suspension closes every door. The credit team tunes them from experience.
 */
export const CREDIT_RULES = {
  /** How heavily a default counts, by who it is owed to. */
  weight: { bank: 1, finance_company: 1.5, telecom: 0.5, other: 0.8 } satisfies Record<CreditorType, number>,

  /** Months banks usually wait after a default at a bank was settled. */
  bankWaitAfterBankDefault: 12,
  /** Months banks usually wait after a default at a finance company was settled. */
  bankWaitAfterFinanceCoDefault: 24,
  /** Months finance companies usually wait after any default was settled. */
  financeCoWaitAfterDefault: 6,

  /** A delay inside this many months counts as recent. */
  recentDelayMonths: 12,
  /** A delay of this many days or more is a real delay. */
  delayDays: 30,
  /** This many inquiries in six months reads as shopping around for credit. */
  manyInquiries6m: 4,
  /** A default below this amount (a phone bill) weighs far less. */
  smallDefault: 1000,
  smallDefaultFactor: 0.4,

  /** An enforcement order and a default are taken as the same debt when their amounts differ by no more than this many riyals, or this share. */
  sameDebtTolerance: 1500,
  sameDebtShare: 0.02,

  /** Points added to the severity. */
  points: {
    activeDefault: 30,
    settledDefault: 14,
    recentDelay: 8,
    activeJudgment: 45,
    pastJudgment: 10,
    activeBouncedCheque: 30,
    suspension: 100,
    manyInquiries: 6,
    highCardUse: 5,
  },
  /** A settled default fades as it ages: full weight at first, then less from each of these ages on. */
  settledFade: [
    { fromMonths: 36, factor: 0.2 },
    { fromMonths: 24, factor: 0.4 },
    { fromMonths: 12, factor: 0.6 },
  ],
  /** Extra points for the worst delay on the record, by its length in days. */
  worstDelayPoints: [
    { fromDays: 90, points: 10 },
    { fromDays: 60, points: 6 },
    { fromDays: 30, points: 3 },
  ],

  /** Card use above this percent of the limits weakens the record. */
  highCardUse: 80,
  /** Card use above this percent is worth bringing down before applying. */
  cardUseToLower: 70,

  /** A score at or above `good` helps, below `fair` hurts. */
  score: { good: 650, fair: 550 },

  /** Severity from which each grade starts. Below the lowest the grade is A. A blocker makes it E whatever the severity. */
  grades: [
    { from: 60, grade: "D" },
    { from: 35, grade: "C" },
    { from: 12, grade: "B" },
  ],

  /** A settled default younger than this many months still marks the record as late. */
  settledMarksLateMonths: 24,
} as const;

/**
 * The largest report file taken, in bytes. A SIMAH report is a few hundred kilobytes, and the platform
 * refuses a request above about 4.5 MB, so anything larger would fail without an answer.
 */
export const REPORT_MAX_BYTES = 4 * 1024 * 1024;
