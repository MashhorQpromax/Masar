/**
 * The "settle and refinance" deal.
 *
 * The company pays the client's enforcement orders, defaults and mortgage payoff, takes the
 * property as security, and once the client's credit record is clean the client goes back to a
 * bank for a new mortgage and personal finance. The company recovers its capital from that
 * financing and takes its fee.
 *
 * Everything in this module is pure: no database, no clock, no text in any language.
 * Amounts are Saudi riyals. Percentages are plain percent numbers (10 means 10 percent).
 */

export type ItemKind = "execution" | "default" | "mortgage_payoff" | "personal_payoff" | "card" | "other";

/**
 * Who settles an obligation:
 * - `company`: paid from the company's capital.
 * - `bank`: bought out by the new personal finance.
 * - `out`: left outside the deal and stays as it is.
 */
export type PaidBy = "company" | "bank" | "out";

export interface DealItem {
  id: string;
  kind: ItemKind;
  label: string;
  /** Registered amount. */
  original: number;
  /** Amount that will actually be paid, after negotiation or per the liability letter. */
  pay: number;
  by: PaidBy;
  /** Confirmed by a liability or clearance letter. */
  confirmed?: boolean;
  /** Current monthly installment. Counts against the deduction cap when the obligation stays. */
  monthly?: number | null;
}

export type Structure = "settle_refi_personal" | "settle_personal" | "settle_refi";

/**
 * What the finance percent is counted on: all the new financing, one part of it, or what is left of it
 * once every obligation the deal settles and every cost is paid (`net`), before the office's fee.
 */
export type FinanceBase = "total" | "personal" | "mortgage" | "net";

export interface Fee {
  /** Percent on settled enforcement orders and defaults. */
  settlePct: number;
  /** Whether the settlement percent also applies to mortgage and personal payoffs. */
  settleIncludesPayoff: boolean;
  /** Percent on the new financing. */
  financePct: number;
  /** Which financing the finance percent applies to. */
  financeBase: FinanceBase;
  /** Extra flat amount. */
  fixed: number;
}

export type LenderKind = "bank" | "finance_co";

export interface DealInput {
  structure?: Structure;
  items: DealItem[];
  /** Expected valuation, which is the sale price to the bank. */
  propertyValue: number | null;
  /** Real estate transaction tax when the property moves to the company's side, percent. */
  transferTaxPct: number;
  /** Tax on the sale to the bank, percent. */
  saleTaxPct: number;
  /** Valuation, brokerage, fees and notarisation. */
  fixedCosts: number;
  fee: Fee;
  targetBank: string | null;
  /** Annual reducing rate, percent. */
  mortgageApr: number;
  /** Annual flat rate, percent. */
  personalFlat: number;
  personalMonths: number;
  mortgageMaxAge: number;
  mortgageMaxMonths: number;
  ltvPct: number;
  /** The bank's actual approval or offer, when there is one. */
  bankMortgage: number | null;
  bankPersonal: number | null;
  /** The most the chosen lender's product lends, when a lender was chosen. An estimate never goes above it. */
  mortgageCeiling?: number | null;
  personalCeiling?: number | null;
  personalLender?: string | null;
  personalLenderKind?: LenderKind | null;
  notes: string;
}

export interface Borrower {
  age: number | null;
  basicSalary: number | null;
  totalSalary: number | null;
  serviceMonths: number | null;
  sector: string;
}

/** Facts from the credit analysis that change the deal's risks and suggested fee. */
export interface CreditFlags {
  bankReopenMonths: number | null;
  suspension: boolean;
  financeCoDefault: boolean;
}

export type Verdict = "go" | "tight" | "short" | "needs_info";

export type Stage =
  | "study"
  | "agreement"
  | "settlement"
  | "clearance"
  | "simah_update"
  | "payoff"
  | "transfer"
  | "bank_submit"
  | "approval"
  | "disbursement"
  | "recovered"
  | "closed"
  | "lost";

export type RiskLevel = "block" | "warn" | "info";

export type RiskCode =
  | "PROPERTY_VALUE_MISSING"
  | "DEFICIT"
  | "THIN_MARGIN"
  | "KEPT_OBLIGATIONS"
  | "EXECUTION_OUTSIDE_DEAL"
  | "DEFAULT_OUTSIDE_DEAL"
  | "PERSONAL_FROM_FINANCE_CO"
  | "NO_COLLATERAL"
  | "COVER_LOW"
  | "COVER_SENSITIVE"
  | "FINANCE_CO_DEFAULT_HISTORY"
  | "BANK_WAIT"
  | "SUSPENSION_LIFT"
  | "NEAR_RETIREMENT"
  | "INCOME_BOUND"
  | "PAYOFF_UNCONFIRMED"
  | "NEGOTIATE_EXECUTIONS"
  | "TRANSFER_TAX"
  | "RECOVERY_GUARANTEES"
  | "DBR_OVER_CAP"
  | "FEE_OVER_MAX";

export interface Risk {
  code: RiskCode;
  level: RiskLevel;
  /** Numbers and names the interface needs to phrase the risk. */
  params: Record<string, number | string | boolean | string[] | null>;
}

export type FeeReason =
  | "SUSPENSION"
  | "FINANCE_CO_DEFAULT"
  | "EXECUTIONS"
  | "NO_COLLATERAL"
  | "LOW_COVER"
  | "NEAR_RETIREMENT"
  | "PAID_NEAR_VALUE";

export type LedgerSection = "personal" | "mortgage" | "dues" | "result";
export type LedgerTone = "plus" | "minus" | "total";

/** One line of the step by step calculation the user can check by hand. */
export interface LedgerLine {
  section: LedgerSection;
  key: string;
  value: number;
  tone?: LedgerTone;
  params?: Record<string, number | string | boolean | null>;
}

export interface Financing {
  age: number | null;
  monthsToRetire: number | null;
  pension: number | null;
  /** Total deduction cap that applies to this salary, as a share. */
  totalCap: number;
  personalInstallment: number;
  personalMonths: number;
  /** Personal principal estimated from the installment, before any bank offer. */
  personalEstimate: number;
  personal: number;
  /** Mortgage installment before retirement. */
  mortgagePre: number;
  /** Mortgage installment after retirement. */
  mortgagePost: number;
  mortgageMonths: number;
  mortgageByIncome: number;
  mortgageByLtv: number | null;
  mortgage: number;
  /** The lender's ceiling, when it is what holds the estimate. */
  mortgageCeiling: number | null;
  personalCeiling: number | null;
  source: "estimate" | "bank";
  /** Deduction ratio after the new financing, percent with one decimal. */
  dbrAfter: number | null;
}

export interface DealSummary {
  obligations: { label: string; amount: number; original: number; byBank: boolean }[];
  totalObligations: number;
  /** Discounts negotiated on enforcement orders and defaults. */
  discountTotal: number;
  kept: { label: string; monthly: number | null; amount: number; kind: ItemKind }[];
  /** Enforcement orders left outside the deal. The service suspension stays while any is open. */
  keptExecutions: number;
  financing: { kind: "mortgage" | "personal"; amount: number; lender: string | null; lenderKind: LenderKind | null }[];
  totalFinancing: number;
  costs: { kind: "admin_fee" | "transfer_tax" | "sale_tax" | "fixed_costs"; amount: number }[];
  /** Financing minus obligations minus costs, before the company's fee. */
  afterSettle: number;
  /** After the company's fee. This is what the client keeps. */
  net: number;
}

export interface DealStudy {
  structure: Structure;
  verdict: Verdict;
  /** Monthly installments of obligations that stay outside the deal. */
  keptMonthly: number;
  paidByCompany: number;
  paidByBank: number;
  transferTax: number;
  saleTax: number;
  fixedCosts: number;
  /** The most capital the company puts in. */
  capital: number;
  financing: Financing;
  /** Sale price to the bank. */
  price: number;
  downPayment: number;
  /** What the company receives from the sale to the bank. */
  companyFromSale: number;
  /** Personal finance left after the internal buyout and the lender's admin fee. */
  personalCash: number;
  surplusBeforeFee: number;
  fee: number;
  feeSettle: number;
  feeFinance: number;
  feeFixed: number;
  settleBase: number;
  financeBase: number;
  suggestedPct: number;
  suggestedReasons: FeeReason[];
  /** What the client owes the company after the sale. Negative means a surplus returned to the client. */
  dueFromClient: number;
  /** Cash the client keeps. Negative is a deficit: the deal does not close. */
  clientNet: number;
  /** Fee over capital, percent. */
  roi: number | null;
  days: number;
  annualized: number | null;
  /** Collateral cover: property value over capital. */
  cover: number | null;
  /** Discount on enforcement orders and defaults that would cover the deficit, percent. */
  breakEvenDiscount: number | null;
  risks: Risk[];
  ledger: LedgerLine[];
  summary: DealSummary;
  steps: { stage: Stage; days: number }[];
}
