/**
 * A person's SIMAH credit record, and what it means for the lenders.
 *
 * The record is read from the SIMAH report (and corrected by the analyst). The analysis grades it,
 * says whether banks and finance companies would take the client today, lists what stands in the
 * way and what to do about it.
 *
 * Everything in this module is pure: no database, no clock, no text in any language.
 * Amounts are Saudi riyals. Ages of events are whole months counted back from the report date.
 */

export type CreditorType = "bank" | "finance_company" | "telecom" | "other";

/**
 * - `current`: open and paid on time.
 * - `late`: open with an overdue amount.
 * - `default`: listed as defaulted and still unpaid.
 * - `settled`: was defaulted and has since been paid in full.
 * - `closed`: ended normally.
 */
export type FacilityStatus = "current" | "late" | "default" | "settled" | "closed";

/** One product on the record: a loan, a card, a lease, a phone line. Stored exactly as the report gave it. */
export interface Facility {
  lender: string;
  creditorType: CreditorType;
  /** The product as SIMAH names it. Cards are recognised by this name. */
  product: string;
  status: FacilityStatus;
  limit?: number | null;
  balance?: number | null;
  installment?: number | null;
  overdue?: number | null;
  openedAt?: string | null;
  endAt?: string | null;
  lastUpdate?: string | null;
  lastPayDate?: string | null;
  /** Worst delay in days over the last 24 months (0, 30, 60, 90, 120, 180). */
  worstDelay?: number | null;
  lastDelayMonthsAgo?: number | null;
  /** The amount that was listed as defaulted. */
  defaultAmount?: number | null;
  /** What is left of the defaulted amount now. */
  defaultNow?: number | null;
  defaultListedAt?: string | null;
  defaultState?: string | null;
  defaultMonthsAgo?: number | null;
  /** How long ago the default was paid in full, when it was. */
  settledMonthsAgo?: number | null;
}

export type JudgmentKind = "judgment" | "enforcement" | "bounced_cheque";

/** A court judgment, an enforcement order or a bounced cheque. */
export interface Judgment {
  kind: JudgmentKind;
  /** Still open: not paid, not closed. */
  active: boolean;
  amount?: number | null;
  remaining?: number | null;
  creditor?: string | null;
  date?: string | null;
  state?: string | null;
  decisionNo?: string | null;
  monthsAgo?: number | null;
}

export interface Inquiry {
  date: string;
  lender: string;
  product: string;
  amount: number | null;
}

/** Totals the report prints about itself, kept to cross-check the reading. */
export interface ReportSummary {
  activeCount?: number;
  totalLimits?: number;
  totalOutstanding?: number;
  defaultedCount?: number;
  defaultedRemaining?: number;
  firstProductDate?: string;
}

export interface CreditReport {
  reportDate?: string | null;
  reportMonthsAgo?: number | null;
  score?: number | null;
  facilities: Facility[];
  judgments: Judgment[];
  /**
   * Suspension of government services under article 46 of the Enforcement Law.
   * SIMAH does not show it. It is known from Najiz or Absher, or assumed from an unpaid enforcement order.
   */
  serviceSuspension: boolean;
  /** The suspension was inferred from the report and nobody has confirmed it yet. */
  suspensionAssumed?: boolean;
  travelBan?: boolean;
  inquiries6m?: number | null;
  inquiries12m?: number | null;
  inquiries?: Inquiry[];
  summary?: ReportSummary;
  notes?: string | null;
}

/** A to E, best to worst. E means something on the record blocks every lender. */
export type Grade = "A" | "B" | "C" | "D" | "E";

/** The record in one word, for the eligibility rules: clean, has delays, or has a default. */
export type Standing = "clean" | "late" | "default";

export type Access = "open" | "conditional" | "closed";

export type AccessReason =
  | "BLOCKER"
  | "RECENT_SETTLEMENT_FINANCE_CO"
  | "RECENT_SETTLEMENT_BANK"
  | "VERY_RECENT_SETTLEMENT"
  | "RECENT_DELAYS"
  | "SETTLED_HISTORY"
  | "MANY_INQUIRIES"
  | "WITH_SETTLEMENT_LETTER"
  | "ACCEPTABLE";

/** Whether one kind of lender would take the client today. */
export interface Door {
  access: Access;
  reason: AccessReason;
  /** Months until a closed door is expected to open again, when waiting is all it takes. */
  reopenInMonths: number | null;
}

export interface CreditStats {
  /** Products that are neither closed nor settled. */
  activeFacilities: number;
  totalLimits: number;
  totalBalance: number;
  monthlyInstallments: number;
  /** Card balances over card limits, percent. Null without a card that has a limit. */
  cardUtilization: number | null;
  /** Defaults ever listed: unpaid ones and settled ones. */
  defaults: number;
  activeDefaults: number;
  defaultsAmount: number;
  activeDefaultsAmount: number;
  bankDefaults: number;
  financeCoDefaults: number;
  telecomDefaults: number;
  /** Judgments and enforcement orders. Bounced cheques are counted apart. */
  judgments: number;
  activeJudgments: number;
  judgmentsAmount: number;
  activeJudgmentsAmount: number;
  bouncedCheques: number;
  worstDelay: number;
  /** Products with a delay of 30 days or more inside the recent window. */
  recentDelays: number;
  inquiries6m: number;
  inquiries12m: number;
  /** What must be paid or settled before any lender will look at the client, with no debt counted twice. */
  totalToClear: number;
}

/** Something on the record that no lender accepts while it stands. */
export type Blocker =
  | { code: "SUSPENSION"; params: { assumed: boolean } }
  | { code: "TRAVEL_BAN"; params: Record<string, never> }
  | {
      code: "JUDGMENT";
      params: {
        kind: "judgment" | "enforcement";
        creditor: string | null;
        /** The report names no creditor: this one is the lender of the default the order was matched to. */
        creditorGuessed: boolean;
        amount: number | null;
        date: string | null;
        state: string | null;
      };
    }
  | { code: "BOUNCED_CHEQUE"; params: { amount: number | null } }
  | {
      code: "ACTIVE_DEFAULT";
      params: {
        lender: string;
        creditorType: CreditorType;
        remaining: number | null;
        listedAt: string | null;
        state: string | null;
        /** An enforcement order was raised for this same debt. */
        enforced: boolean;
      };
    };

export type FindingLevel = "block" | "warn" | "info" | "good";

/** One thing worth knowing about the record. */
export type Finding =
  | { code: "TOTAL_TO_CLEAR"; level: "block"; params: { amount: number } }
  | { code: "FINANCE_CO_DEFAULTS"; level: "warn"; params: { count: number; waitMonths: number } }
  | { code: "BANK_DEFAULTS"; level: "warn"; params: { count: number; waitMonths: number } }
  | { code: "TELECOM_DEFAULTS"; level: "info"; params: { count: number } }
  | { code: "SETTLED_DEFAULT"; level: "info"; params: { lender: string; creditorType: CreditorType; monthsAgo: number | null; amount: number | null } }
  | { code: "RECENT_DELAYS"; level: "warn"; params: { count: number; worstDelay: number; windowMonths: number } }
  | { code: "OLD_DELAY"; level: "info"; params: { worstDelay: number; windowMonths: number } }
  | { code: "MANY_INQUIRIES"; level: "warn"; params: { count: number } }
  | { code: "CARD_UTILIZATION"; level: "warn" | "info"; params: { percent: number; balance: number; limit: number } }
  | { code: "SCORE"; level: "good" | "info" | "warn"; params: { score: number } }
  | { code: "INSTALLMENTS"; level: "info"; params: { monthly: number; facilities: number } }
  | { code: "CLEAN"; level: "good"; params: Record<string, never> };

/** One step of the plan that repairs the record, in the order it should be done. */
export type CreditAction =
  | { code: "LIFT_SUSPENSION"; params: Record<string, never> }
  | { code: "SETTLE_JUDGMENTS"; params: { count: number; amount: number } }
  | { code: "PAY_DEFAULT"; params: { lender: string; amount: number } }
  | { code: "REFRESH_REPORT"; params: Record<string, never> }
  | { code: "PAY_ON_TIME"; params: Record<string, never> }
  | { code: "PAUSE_APPLICATIONS"; params: Record<string, never> }
  | { code: "LOWER_CARDS"; params: Record<string, never> }
  | { code: "RESTUDY_BANKS"; params: { months: number } }
  | { code: "NONE"; params: Record<string, never> };

export interface CreditAnalysis {
  grade: Grade;
  /** 0 is a spotless record, 100 a closed one. */
  severity: number;
  standing: Standing;
  banks: Door;
  financeCompanies: Door;
  stats: CreditStats;
  blockers: Blocker[];
  findings: Finding[];
  actions: CreditAction[];
}
