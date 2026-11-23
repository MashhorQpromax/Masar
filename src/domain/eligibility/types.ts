/**
 * Who would finance a client, for how much, and what stands in the way.
 *
 * A profile is what is known about the client and what they ask for. A product is one lender's terms
 * for one kind of finance. The study measures the room SAMA's rules leave in the client's income,
 * checks every product against the client and ranks what is left.
 *
 * Everything in this module is pure: no database, no clock, no text in any language.
 * Amounts are Saudi riyals, tenors are months, rates are percent a year.
 */
import type { RateType } from "../finance/amortization";
import type { Sector } from "../shared/sector";
import type { Answer, ContractType, Inquiries, SpecialCheck, SpecialCondition } from "./special";
import type { Term, TermStanding } from "./terms";

export { SECTORS, type Sector } from "../shared/sector";

export const FINANCE_TYPES = ["personal", "mortgage", "auto", "sme", "card", "project"] as const;
export type FinanceType = (typeof FINANCE_TYPES)[number];

/** The kinds of finance a lender's product may be for. A card and a project are not products a client is sent to. */
export const PRODUCT_KINDS = ["personal", "mortgage", "auto", "sme"] as const satisfies readonly FinanceType[];
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export type Nationality = "saudi" | "non_saudi";

/** The credit record in one word. `unknown` means no SIMAH report was read yet. */
export type RecordStanding = "clean" | "late" | "default" | "unknown";

export type LenderType = "bank" | "finance_company";

/** A monthly payment the client already carries. */
export interface Obligation {
  kind: "personal" | "mortgage" | "auto" | "card" | "other";
  lender?: string | null;
  monthly: number;
  remaining?: number | null;
}

export interface Profile {
  age: number | null;
  nationality: Nationality;
  sector: Sector;
  serviceMonths: number | null;
  basicSalary: number | null;
  totalSalary: number | null;
  /** Monthly average of a regular income documented by two years of statements. Half of it counts. */
  otherIncome?: number | null;
  /** The code of the bank the salary is paid into. */
  salaryBank?: string | null;
  simah: RecordStanding;
  /** Receives housing support from the ministry or the real estate development fund. */
  housingSupport?: boolean;
  financeType: FinanceType;
  requestedAmount?: number | null;
  requestedTenor?: number | null;
  obligations: Obligation[];
  /** For a mortgage: a citizen's first home is financed up to 90 percent of its value. */
  firstHome?: boolean | null;
  propertyValue?: number | null;
  /** Income of a co-borrower (a spouse). Counted for a mortgage only. */
  coIncome?: number | null;
  /** How the client is employed. Null or absent: nobody wrote it down. */
  contractType?: ContractType | null;
  /** The credit inquiries the record shows. Null or absent: no record was read. */
  inquiries?: Inquiries | null;
  /** What a person answered for this client about lenders' special conditions, by the condition's id. */
  answers?: Readonly<Record<string, Answer>>;
}

/** One lender's terms for one kind of finance. */
export interface Product {
  id: string;
  lenderId: string;
  lenderName: string;
  lenderType: LenderType;
  /** Matches the client's salary bank. */
  bankCode?: string | null;
  financeType: FinanceType;
  name: string;
  minSalary: number;
  minAge: number;
  maxAgeAtMaturity: number;
  minServiceMonths: number;
  sectors: Sector[];
  nationalities: Nationality[];
  maxTenor: number;
  maxAmount: number;
  rate: number;
  rateType: RateType;
  requiresSalaryTransfer: boolean;
  acceptsLateSimah: boolean;
  /** The lender's own loan-to-value limit, percent. Null means the regulatory limit alone applies. */
  maxLtv?: number | null;
  notes?: string | null;
  /**
   * Months the lender waits after a default was paid before it takes the client. 0 means at once,
   * with the clearance letter. Null or absent means nobody has confirmed it with the lender.
   */
  settledDefaultWaitMonths?: number | null;
  /** Every term of the product can be relied on today. Otherwise its numbers are indicative. */
  verified?: boolean;
  /** How far each term can be relied on today. A term left out is unconfirmed. */
  terms?: Partial<Record<Term, TermStanding>>;
  /** What this lender asks beyond the terms every product has. The list as a whole is the term `special`. */
  special?: SpecialCondition[];
}

/** The rule that limits the monthly installment. */
export type CapRule = "SALARY_DEDUCTION" | "NON_REAL_ESTATE" | "TOTAL_CAP";

export type CapacityWarning = "BASIC_SALARY_USED" | "HIGH_INCOME_CAP_ASSUMED";

/** The room SAMA's deduction rules leave in the client's income. */
export interface Capacity {
  /** Everything that counts as income. */
  income: number;
  salary: number;
  /** The half of the other income that counts. */
  otherIncome: number;
  /** The co-borrower's income, when it counts. */
  coIncome: number;
  existingTotal: number;
  existingNonRealEstate: number;
  existingMortgage: number;
  /** Share of the salary that consumer finance may take. */
  salaryDeductionCap: number;
  /** Share of the income every obligation together may take. Null above the high bracket: the lender's policy decides. */
  totalCap: number | null;
  /** The share the binding rule allows. */
  capUsed: number;
  /** The largest installment of this kind of finance, existing ones included. */
  maxInstallment: number;
  /** The installment still free for new finance. */
  available: number;
  /** Existing obligations as a percent of income. */
  currentDbr: number;
  rule: CapRule;
  /** The rule was applied to a pension. */
  retired: boolean;
  /** The room was measured for a mortgage, where the total cap covers everything. */
  mortgage: boolean;
  warnings: CapacityWarning[];
}

export type CheckStatus = "pass" | "warn" | "fail";

/** One condition of a product, held against the client. */
export type Check = TermCheck | SpecialCheck;

/** A condition that rests on one of the terms every product has, on SAMA's rules or on a fact about the client. */
export type TermCheck = { status: CheckStatus } & (
  | { key: "salary"; code: "SALARY_MISSING"; params: Record<string, never> }
  | { key: "salary"; code: "SALARY_MIN"; params: { salary: number; min: number } }
  | { key: "sector"; code: "SECTOR"; params: { sector: Sector } }
  | { key: "nationality"; code: "NATIONALITY"; params: { nationality: Nationality } }
  | { key: "age"; code: "AGE_MISSING"; params: Record<string, never> }
  | { key: "age"; code: "AGE_BELOW_MIN"; params: { age: number; min: number } }
  | { key: "age"; code: "AGE_OVER_MAX"; params: { max: number } }
  | { key: "age"; code: "TENOR_SHORTENED"; params: { tenor: number; max: number } }
  | { key: "age"; code: "AGE_AT_END"; params: { ageAtEnd: number; max: number } }
  | { key: "service"; code: "SERVICE_NOT_NEEDED"; params: Record<string, never> }
  | { key: "service"; code: "SERVICE_MISSING"; params: Record<string, never> }
  | { key: "service"; code: "SERVICE_MIN"; params: { months: number; min: number } }
  | { key: "simah"; code: "RECORD_CLEAN"; params: Record<string, never> }
  | { key: "simah"; code: "RECORD_UNKNOWN"; params: Record<string, never> }
  | { key: "simah"; code: "RECORD_LATE"; params: Record<string, never> }
  | { key: "simah"; code: "RECORD_DEFAULT"; params: Record<string, never> }
  | { key: "transfer"; code: "SALARY_TRANSFER"; params: Record<string, never> }
  | { key: "retire"; code: "RETIRES_IN_TERM"; params: { retirementAge: number; months: number; pension: number; installmentAfter: number } }
  | { key: "ltv"; code: "DOWN_PAYMENT"; params: { percent: number; propertyValue: number | null; down: number | null } }
  | { key: "dbr"; code: "NO_ROOM"; params: Record<string, never> }
  | { key: "dbr"; code: "ROOM"; params: { available: number; rule: CapRule; share: number; retired: boolean; mortgage: boolean } }
);

/** What kept the amount from being larger. */
export type Limit = { code: "INCOME" } | { code: "RETIREMENT" } | { code: "LTV"; percent: number } | { code: "PRODUCT_MAX" };

/** One product held against one client. */
export interface Match {
  product: Product;
  checks: Check[];
  verdict: CheckStatus;
  /** 0 to 100: fit, cost and how much of the request is covered. */
  score: number;
  tenor: number;
  /** The most this product would lend the client, in whole thousands. */
  maxPrincipal: number;
  /** The requested amount when the product covers it, otherwise the most it would lend. */
  offerPrincipal: number;
  installment: number;
  totalCost: number;
  /** Effective annual rate, percent. */
  apr: number;
  totalProfit: number;
  /** The lender's administrative fee. */
  fee: number;
  /** Early settlement after one year. */
  settle12: { balance: number; fee: number; total: number } | null;
  limitedBy: Limit;
  ltv: { percent: number; down: number | null; propertyMax: number | null } | null;
  /** Set when the client retires before the last installment: the installment steps down to what the pension carries. */
  retirement: { atMonth: number; pension: number; before: number; after: number } | null;
}

export type StudyVerdict = "eligible" | "conditional" | "not_eligible" | "pending";

/** Something about the client that helps or hurts with every lender. */
export type Point =
  | { code: "STRONG_EMPLOYER" }
  | { code: "APPROVED_EMPLOYER" }
  | { code: "UNAPPROVED_EMPLOYER" }
  | { code: "CLEAN_RECORD" }
  | { code: "LATE_RECORD" }
  | { code: "DEFAULT_RECORD" }
  | { code: "DEBT_SHARE"; percent: number }
  | { code: "NO_ROOM" }
  | { code: "SHORT_SERVICE" };

export type MissingFact = "AGE" | "TOTAL_SALARY" | "SERVICE" | "CREDIT_REPORT" | "SALARY_BANK" | "REQUESTED_AMOUNT";

/** What to do next, most useful first. */
export type Advice =
  | { code: "BEST_OPTION"; lender: string; product: string; amount: number; installment: number; tenor: number }
  | { code: "CLEAR_DEFAULTS" }
  | { code: "PAY_SMALLEST"; lender: string | null; kind: Obligation["kind"] }
  | { code: "SALARY_BANK_FIRST" }
  | { code: "APPLY_ORDER"; lenders: string[] }
  | { code: "AMOUNT_ABOVE_POSSIBLE"; requested: number; possible: number }
  | { code: "COMPLETE_DATA"; missing: MissingFact[] };

export interface Study {
  capacity: Capacity;
  /** Every product of the requested kind, best first. */
  matches: Match[];
  verdict: StudyVerdict;
  /** Products that take the client as they are. */
  eligible: number;
  /** Products that take the client with a condition. */
  conditional: number;
  strengths: Point[];
  risks: Point[];
  advice: Advice[];
  missing: MissingFact[];
}

export type DocumentCategory = "identity" | "income" | "obligations" | "collateral" | "business";

/** A paper a lender asks for. `code` names it; the wording depends on who the client is. */
export interface DocumentNeed {
  code: string;
  category: DocumentCategory;
  required: boolean;
}
