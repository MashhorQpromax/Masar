/**
 * A client's credit and financial analysis.
 *
 * It reads three things together: what the client's file says about them, what their SIMAH record
 * shows, and the terms of the lenders in the catalogue. From them it works out what the client pays
 * every month and what share of the income that is, what helps and what hurts, which lenders fit,
 * what is missing or unconfirmed, and what to do next.
 *
 * Every figure comes from the file, from the record or from an engine that already exists: the
 * record's grading, SAMA's deduction rules, the lenders' conditions. What is not there is listed as
 * missing and is never guessed. The result supports a person's decision. It is not a lender's approval.
 *
 * Everything in this module is pure: no database, no clock, no text in any language.
 * Amounts are Saudi riyals, tenors are months, rates are percent a year.
 */
import type { Blocker, CreditAction, CreditAnalysis, CreditReport, Finding, ParsedReport } from "../credit";
import type { Answer, AskedKind, Capacity, Check, CheckStatus, ContractType, Eligibility, Finding as StrictFinding, Limit, Nationality, Obligation, Point, Product, ProductKind, Sector, SourceStrength, Telling, Term } from "../eligibility";
import type { RecordAfter, RouteCheck } from "../funding";

/** What the client's file says about them, as far as the analysis reads it. */
export interface FileFacts {
  age: number | null;
  nationality: Nationality;
  sector: Sector;
  serviceMonths: number | null;
  basicSalary: number | null;
  totalSalary: number | null;
  /** Monthly average of a regular income beside the salary. Half of it counts. */
  otherIncome: number | null;
  /** Income of a co-borrower. Counted for a mortgage only. */
  coIncome: number | null;
  /** The code of the bank the salary is paid into. */
  salaryBank: string | null;
  housingSupport: boolean;
  propertyValue: number | null;
  /** What the client asked for, when the file says. */
  request: { kind: ProductKind; amount: number | null; tenor: number | null } | null;
  /** A person checked a paper that states the income: a salary certificate, a payslip, a GOSI or pension statement. */
  incomeVerified: boolean;
  /** The client's consent to processing their data is on file. */
  consent: boolean;
  /** How the client is employed. Null or absent: nobody wrote it down. */
  contractType?: ContractType | null;
  /** What a person answered for this client about lenders' special conditions, by the condition's id. */
  answers?: Readonly<Record<string, Answer>>;
}

/** The client's stored SIMAH record, with how it was read. */
export interface RecordFacts {
  report: CreditReport;
  analysis: CreditAnalysis;
  /** How sure the reading was. Null for a record nobody read from a file. */
  confidence: ParsedReport["confidence"] | null;
  /** How many things in the reading a person should double check. */
  readingWarnings: number;
  /** Whole months since the report was issued. Null when it carries no date. */
  ageMonths: number | null;
}

/** Finance the record shows as still being paid. */
export interface Commitment {
  kind: Obligation["kind"];
  lender: string;
  /** The product as SIMAH names it. */
  product: string;
  /** The installment the record gives. Null when it gives none: it is never guessed. */
  monthly: number | null;
  balance: number | null;
  /** A card's limit, when the record gives it. */
  limit: number | null;
  /** The record shows an overdue amount on it. */
  late: boolean;
}

/**
 * - `verified`: a person checked a paper that states it.
 * - `stated`: as written in the file, with no checked paper behind it.
 * - `missing`: the file holds no salary.
 */
export type IncomeBasis = "verified" | "stated" | "missing";

/** The income every share is measured on. */
export interface Income {
  basis: IncomeBasis;
  /** The salary counted: the total one, or the basic one when the total is not on file. */
  salary: number;
  /** The total salary is not on file, so the basic one was counted. */
  basicOnly: boolean;
  /** The half of the other income that counts. */
  other: number;
  total: number;
}

/** What the client pays every month, held against the income. */
export interface Burden {
  /** The installments the record gives, added up. */
  monthly: number;
  mortgage: number;
  nonMortgage: number;
  /** The installments as a percent of the income. Null without an income. */
  share: number | null;
  /** Commitments the record gives no installment for. With any, the share is a floor and every room a ceiling. */
  uncounted: number;
}

/** A condition of a product held against the client: the person and the room from the eligibility engine, the record from the funding rules. */
export type FitCheck = Exclude<Check, { key: "simah" }> | Extract<RouteCheck, { key: "simah" }>;

/** A condition of a product, with how far its answer can be relied on. */
export type FitFinding = StrictFinding<FitCheck>;

/**
 * One lender's product held against the client.
 *
 * It is read twice. `status`, `conditions` and `refusals` are what the stored terms say, whoever
 * confirmed them or nobody. `eligibility` and the lists beside it are the strict reading: an answer
 * on a term nobody confirmed is no answer yet, whichever way it points.
 */
export interface Fit extends Telling<FitFinding> {
  product: Product;
  /** As written: `fail` when the lender would refuse, `warn` when it takes the client on a condition. */
  status: CheckStatus;
  conditions: FitCheck[];
  refusals: FitCheck[];
  /** The result of the strict reading. */
  eligibility: Eligibility;
  /** A term nobody confirmed would, as written, refuse the client. */
  blockedAsWritten: boolean;
  /** The weakest source the reliable answers rest on. Null when none rests on a lender's term. */
  strength: SourceStrength | null;
  /** A term that sets the amount, the months or the rate is not confirmed: the figures are an estimate. */
  estimated: boolean;
  /** The most it would lend on the room the client has left, in whole thousands. */
  most: number;
  /** The amount asked for when the product covers it, otherwise the most it would lend. */
  amount: number;
  installment: number;
  months: number;
  /** Effective annual rate, percent. */
  apr: number;
  limitedBy: Limit;
}

/** Every product of one kind held against one reading of the record, best first. */
export interface Reading {
  record: RecordAfter;
  fits: Fit[];
  /** Products that take the client as they are, on confirmed terms. */
  open: number;
  /** Products that take the client once they have done something clear, on confirmed terms. */
  conditional: number;
  /** Products with no reliable answer yet: a term is unconfirmed or a fact is missing. */
  unsure: number;
}

/** One kind of finance: the room for it and the lenders that offer it. */
export interface KindFit {
  kind: ProductKind;
  /** The room SAMA's rules leave for a new installment of this kind, with every commitment standing. */
  room: Capacity;
  today: Reading;
  /** With something on the record that blocks every lender: the same lenders once it is paid. Null when nothing blocks. */
  cleared: Reading | null;
}

/** Something that helps or hurts, with where it was read. */
export type Mark = { source: "file"; point: Point } | { source: "record"; finding: Finding } | { source: "record"; blocker: Blocker };

/**
 * Something the analysis could not stand on.
 * - `missing`: it is not there, and nothing was put in its place.
 * - `unconfirmed`: it is there, and nobody has confirmed it.
 */
export type Gap = { kind: "missing" | "unconfirmed" } & (
  | { code: "INCOME" }
  | { code: "TOTAL_SALARY" }
  | { code: "INCOME_PROOF" }
  | { code: "AGE" }
  | { code: "SERVICE" }
  | { code: "SALARY_BANK" }
  /** A lender studied asks for a kind of contract, and the file does not say which the client has. */
  | { code: "CONTRACT" }
  | { code: "INSTALLMENT"; lender: string; product: string; balance: number | null }
  | { code: "CARD_SHARE"; lender: string; limit: number | null; balance: number | null }
  | { code: "REPORT_AGE"; months: number }
  | { code: "READING"; confidence: "medium" | "low"; warnings: number }
  | { code: "SUSPENSION" }
  /** Products with a term that cannot be relied on today, out of the products studied. */
  | { code: "TERMS"; unverified: number; of: number }
  | { code: "CONSENT" }
);

export type GapCode = Gap["code"];

/** What to do next, in order. */
export type Step =
  | { code: "RECORD_CONSENT" }
  | { code: "COMPLETE_FILE"; missing: ("INCOME" | "AGE" | "SERVICE" | "SALARY_BANK" | "CONTRACT")[] }
  | { code: "REVIEW_READING" }
  | { code: "CONFIRM_SUSPENSION" }
  | { code: "CREDIT"; action: Exclude<CreditAction, { code: "NONE" }> }
  | { code: "REFRESH_REPORT"; months: number }
  | { code: "FREE_ROOM"; lender: string; kind: Obligation["kind"]; monthly: number }
  | { code: "VERIFY_INCOME" }
  /**
   * The lender to go to rests on terms nobody confirmed: ask it, and keep the source, before anything
   * is promised. One step for a lender, whichever kinds of finance it is the one to go to for.
   * `beforePaying`: the office would pay the client's debts first, so it asks before it pays.
   */
  | { code: "CONFIRM_TERMS"; lender: string; kinds: ProductKind[]; terms: Term[]; beforePaying: boolean }
  /**
   * The lender to go to has special conditions nobody asked the client about. Until a person answers
   * them they are not met. One step for a lender, with each question once.
   */
  | { code: "ASK_CLIENT"; lender: string; questions: { kind: AskedKind; text: string | null }[]; beforePaying: boolean }
  | {
      code: "APPLY";
      kind: ProductKind;
      lender: string;
      product: string;
      amount: number;
      installment: number;
      months: number;
      /** The lender's result when read strictly. Never `not_eligible`: nobody is sent to a lender that refuses. */
      eligibility: Eligibility;
      afterClearing: boolean;
      /** The result can be relied on and a term that sets the figures cannot. */
      estimated: boolean;
    };

/**
 * The four results, as the best lender gives them when read strictly, and one more for an analysis
 * that cannot be read at all.
 * - `eligible`: a lender takes the client as they are, on confirmed terms. The lender still decides.
 * - `conditional`: a lender takes the client once they have done something clear.
 * - `not_eligible`: a confirmed condition stands in the way at every lender. No calculation overrides it.
 * - `needs_verification`: a lender's term is unconfirmed or a fact is missing, so no reliable answer exists.
 * - `pending`: the analysis has too little to stand on, or the client's consent to it is not on file.
 *   A person has to complete or check it first. It is said in the same words as `needs_verification`.
 */
export type AnalysisVerdict = Eligibility | "pending";

export interface ClientAnalysis {
  verdict: AnalysisVerdict;
  /** With something that blocks every lender today: what the verdict becomes once it is paid. Null when nothing blocks. */
  afterClearing: Exclude<AnalysisVerdict, "pending"> | null;
  income: Income;
  commitments: Commitment[];
  burden: Burden;
  /** One entry per kind of finance studied. Empty without an income. */
  kinds: KindFit[];
  strengths: Mark[];
  risks: Mark[];
  gaps: Gap[];
  steps: Step[];
}
