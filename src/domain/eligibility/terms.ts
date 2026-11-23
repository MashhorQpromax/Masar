/**
 * Where each of a product's terms comes from, and whether it can be relied on today.
 *
 * A term is a claim about a lender. The office keeps its value, and beside it the source that
 * confirmed it and the day it was confirmed. A term nobody confirmed, or one confirmed too long ago,
 * is never treated as known: the engines still calculate with its value, and every result built on
 * it says that it needs checking.
 *
 * Everything in this module is pure: no database, no clock. A day is an ISO date, `2026-11-23`.
 */
import type { FinanceType } from "./types";

/** The terms of a product, as the office confirms them: one source may speak for several stored fields. */
export const TERMS = ["salary", "sector", "nationality", "age", "service", "transfer", "late", "settled", "special", "amount", "tenor", "ltv", "rate"] as const;
export type Term = (typeof TERMS)[number];

/** The stored fields of a product that each term speaks for. A change to one of them is a change to the term. */
export const TERM_FIELDS = {
  salary: ["minSalary"],
  sector: ["sectors"],
  nationality: ["nationalities"],
  age: ["minAge", "maxAgeAtMaturity"],
  service: ["minServiceMonths"],
  transfer: ["requiresSalaryTransfer"],
  late: ["acceptsLateSimah"],
  settled: ["settledDefaultWaitMonths"],
  // The list of the lender's special conditions. It is kept beside the product, and every change to it is a change to the term.
  special: [],
  amount: ["maxAmount"],
  tenor: ["maxTenor"],
  ltv: ["maxLtv"],
  rate: ["rate", "rateType"],
} as const satisfies Record<Term, readonly string[]>;

/** The terms that decide whether the lender takes the client. The others decide how much, and at what cost. */
export const CONDITION_TERMS = ["salary", "sector", "nationality", "age", "service", "transfer", "late", "settled", "special"] as const satisfies readonly Term[];

/** The terms that decide how much a product lends and at what cost. */
export const AMOUNT_TERMS = ["amount", "tenor", "ltv", "rate"] as const satisfies readonly Term[];

/** The terms a product of this kind has. Only a mortgage has a share of the property's value. */
export function termsOf(financeType: FinanceType): Term[] {
  return TERMS.filter((term) => term !== "ltv" || financeType === "mortgage");
}

/** The terms a change to these stored fields touches. */
export function termsTouched(fields: readonly string[]): Term[] {
  return TERMS.filter((term) => (TERM_FIELDS[term] as readonly string[]).some((field) => fields.includes(field)));
}

/**
 * What can confirm a lender's term: a paper the lender issued, a page of its own site, or what one
 * of its employees said. What the office saw a lender decide in earlier files is experience, kept
 * elsewhere: it ranks lenders and confirms nothing.
 */
export const SOURCE_KINDS = ["lender_document", "lender_website", "lender_staff"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** A written source can be shown to anyone. What an employee said rests on their word. */
export type SourceStrength = "written" | "verbal";

export function strengthOf(kind: SourceKind): SourceStrength {
  return kind === "lender_staff" ? "verbal" : "written";
}

export interface TermSource {
  kind: SourceKind;
  /** The paper's title and date, the page's address, or the employee's name and position. */
  reference: string;
  /** The day the office checked the source. */
  confirmedOn: string;
}

/** Months a confirmation stays good. After that the lender has to be asked again. */
export const TERM_VALIDITY_MONTHS = 3;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar day written as an ISO date. */
export function isDay(value: string): boolean {
  const parts = DAY.exec(value);
  if (!parts) return false;
  const date = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
  return date.toISOString().slice(0, 10) === value;
}

/** A date as the day it is in Riyadh, where the office works. */
export function dayOf(date: Date): string {
  return new Date(date.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}

/** The same day some months later. The 31st of a month lands on the last day of a shorter one. */
export function addMonths(day: string, months: number): string {
  const [year, month, dayOfMonth] = day.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(dayOfMonth, last))).toISOString().slice(0, 10);
}

/** The last day a confirmation made on this day can be relied on. */
export function validUntil(confirmedOn: string, months: number = TERM_VALIDITY_MONTHS): string {
  return addMonths(confirmedOn, months);
}

/** Whether a term can be relied on today. */
export type TermStanding =
  | { state: "confirmed"; source: TermSource; strength: SourceStrength; validUntil: string }
  | { state: "expired"; source: TermSource; validUntil: string }
  | { state: "unconfirmed" };

export const UNCONFIRMED: TermStanding = { state: "unconfirmed" };

export function termStanding(source: TermSource | null | undefined, today: string): TermStanding {
  if (!source) return UNCONFIRMED;
  const until = validUntil(source.confirmedOn);
  if (today > until) return { state: "expired", source, validUntil: until };
  return { state: "confirmed", source, strength: strengthOf(source.kind), validUntil: until };
}

export type SourceProblem = "REFERENCE_SHORT" | "LINK_NEEDED" | "DAY_INVALID" | "DAY_AHEAD" | "DAY_OLD";

/** The shortest reference that can name a paper or a person. */
export const REFERENCE_MIN = 5;
export const REFERENCE_MAX = 300;

/** Why a source cannot confirm anything. Null when it can. */
export function sourceProblem(source: TermSource, today: string): SourceProblem | null {
  const reference = source.reference.trim();
  if (reference.length < REFERENCE_MIN || reference.length > REFERENCE_MAX) return "REFERENCE_SHORT";
  if (source.kind === "lender_website" && !/^https?:\/\/[^\s/]+\.[^\s/]+/i.test(reference)) return "LINK_NEEDED";
  if (!isDay(source.confirmedOn)) return "DAY_INVALID";
  if (source.confirmedOn > today) return "DAY_AHEAD";
  // A confirmation older than its own validity would be born expired.
  if (today > validUntil(source.confirmedOn)) return "DAY_OLD";
  return null;
}

/** One source with every term of a product it speaks for, as a person reads them back. */
export interface SourceGroup {
  source: TermSource;
  state: "confirmed" | "expired";
  validUntil: string;
  terms: Term[];
}

/** The sources behind a product's terms, in the order terms are always listed. Unconfirmed terms have none. */
export function sourceGroups(financeType: FinanceType, standings: Partial<Record<Term, TermStanding>> | undefined): SourceGroup[] {
  const groups: SourceGroup[] = [];
  for (const term of termsOf(financeType)) {
    const standing = standings?.[term];
    if (!standing || standing.state === "unconfirmed") continue;
    const { source } = standing;
    const same = groups.find((group) => group.source.kind === source.kind && group.source.reference === source.reference && group.source.confirmedOn === source.confirmedOn);
    if (same) same.terms.push(term);
    else groups.push({ source, state: standing.state, validUntil: standing.validUntil, terms: [term] });
  }
  return groups;
}

/** The terms of a product that cannot be relied on today, in the order terms are always listed. */
export function openTerms(financeType: FinanceType, standings: Partial<Record<Term, TermStanding>> | undefined): Term[] {
  return termsOf(financeType).filter((term) => standings?.[term]?.state !== "confirmed");
}

/**
 * What a product would lend is an estimate while a term that sets it cannot be relied on today.
 * Whether the lender takes the client is another question, answered by its conditions.
 */
export function amountsOpen(financeType: FinanceType, standings: Partial<Record<Term, TermStanding>> | undefined): boolean {
  return openTerms(financeType, standings).some((term) => (AMOUNT_TERMS as readonly Term[]).includes(term));
}
