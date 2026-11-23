/**
 * The strict reading of a product's conditions.
 *
 * The matching engines answer each condition with pass, warn or fail from the values the catalogue
 * holds. This module asks one more question of every answer: can it be relied on? An answer built on
 * a lender's term that nobody confirmed is not an answer yet, whichever way it points, and a fact
 * about the client that is missing never counts as met.
 *
 * Four results come out of it, for one product or for a route:
 * - eligible: every condition that could be checked is met, on confirmed terms. The lender still decides.
 * - conditional: the client has something clear to do first.
 * - not eligible: a confirmed condition stands in the way. No calculation overrides it.
 * - needs verification: a fact is missing or a term is unconfirmed, so no reliable answer exists.
 *
 * Everything in this module is pure: no database, no clock, no text in any language.
 */
import { listCheck } from "./special";
import type { SourceStrength, Term, TermStanding } from "./terms";
import { amountsOpen, UNCONFIRMED } from "./terms";
import type { Check, CheckStatus, Match } from "./types";

export type Outcome = "met" | "action" | "blocked" | "unknown";

/**
 * Who sets a condition: the regulator, for every lender alike; the market, where every lender does
 * the same without a rule saying so; this lender; or nobody, when it is a fact about the client.
 */
export type Basis = "regulation" | "market" | "lender" | "client";

/** Why a condition has no reliable answer. */
export type Doubt = "FACT_MISSING" | "TERM_UNCONFIRMED" | "TERM_EXPIRED" | "TERM_NOT_KNOWN";

export interface Rule {
  basis: Basis;
  /** The lender's term the answer rests on. */
  term?: Term;
  /** The check itself says a fact about the client is missing. */
  missing?: true;
  /** The check itself says the lender's value is not known. */
  notKnown?: true;
  /** What a `warn` means once the term can be relied on. Left out, it is something the client has to do. */
  warn?: "met";
}

/** `ref` tells two conditions of one code apart: two special conditions of one lender are two things to say. */
type BareCheck = { status: CheckStatus; code: string; ref?: string };

/** One condition, with how far its answer can be relied on. */
export interface Finding<C extends BareCheck = BareCheck> {
  check: C;
  outcome: Outcome;
  basis: Basis;
  term: Term | null;
  standing: TermStanding | null;
  doubt: Doubt | null;
  /** The answer the catalogue's value gives, when that value is not confirmed. */
  leans: Exclude<Outcome, "unknown"> | null;
  /** How strong the source behind a reliable answer is. Null when no lender's term is involved. */
  strength: SourceStrength | null;
}

export type Eligibility = "eligible" | "conditional" | "not_eligible" | "needs_verification";

/** How each condition of the eligibility engine is read. */
export const CHECK_RULES = {
  SALARY_MISSING: { basis: "client", missing: true },
  SALARY_MIN: { basis: "lender", term: "salary" },
  SECTOR: { basis: "lender", term: "sector" },
  NATIONALITY: { basis: "lender", term: "nationality" },
  AGE_MISSING: { basis: "client", missing: true },
  AGE_BELOW_MIN: { basis: "lender", term: "age" },
  AGE_OVER_MAX: { basis: "lender", term: "age" },
  // The term already ends at the age limit: nothing is left for the client to do.
  TENOR_SHORTENED: { basis: "lender", term: "age", warn: "met" },
  AGE_AT_END: { basis: "lender", term: "age" },
  SERVICE_NOT_NEEDED: { basis: "client" },
  SERVICE_MISSING: { basis: "client", missing: true },
  SERVICE_MIN: { basis: "lender", term: "service" },
  RECORD_CLEAN: { basis: "client" },
  RECORD_UNKNOWN: { basis: "client", missing: true },
  // A lender that takes late payments takes this client: the lateness is a risk, not a task.
  RECORD_LATE: { basis: "lender", term: "late", warn: "met" },
  RECORD_DEFAULT: { basis: "market" },
  SALARY_TRANSFER: { basis: "lender", term: "transfer" },
  // What the pension carries after retirement changes the amount, not whether the lender takes the client.
  RETIRES_IN_TERM: { basis: "regulation", warn: "met" },
  DOWN_PAYMENT: { basis: "regulation" },
  NO_ROOM: { basis: "regulation" },
  // Less than was asked for is still finance the client can take.
  ROOM: { basis: "regulation", warn: "met" },
  // The lender's special conditions rest on one term: the list of them, as the lender confirmed it.
  SPECIAL_LIST: { basis: "lender", term: "special" },
  AMOUNT_MIN: { basis: "lender", term: "special" },
  INQUIRIES: { basis: "lender", term: "special" },
  INQUIRIES_UNKNOWN: { basis: "client", missing: true },
  CONTRACT: { basis: "lender", term: "special" },
  CONTRACT_MISSING: { basis: "client", missing: true },
  ASKED: { basis: "lender", term: "special" },
  // Nobody asked the client yet. It is this lender's question, and the answer is a fact about the client.
  ASKED_OPEN: { basis: "lender", term: "special", missing: true },
} as const satisfies Record<Check["code"], Rule>;

/** Reads one answer strictly. `terms` are the standings of the product that gave it. */
export function findingOf<C extends BareCheck>(check: C, rule: Rule, terms: Partial<Record<Term, TermStanding>> | undefined): Finding<C> {
  const term = rule.term ?? null;
  const standing = term ? (terms?.[term] ?? UNCONFIRMED) : null;
  const base = { check, basis: rule.basis, term, standing };
  if (rule.missing) return { ...base, outcome: "unknown", doubt: "FACT_MISSING", leans: null, strength: null };
  if (rule.notKnown) return { ...base, outcome: "unknown", doubt: "TERM_NOT_KNOWN", leans: null, strength: null };
  const plain: Exclude<Outcome, "unknown"> = check.status === "pass" ? "met" : check.status === "fail" ? "blocked" : (rule.warn ?? "action");
  if (!standing) return { ...base, outcome: plain, doubt: null, leans: null, strength: null };
  if (standing.state === "confirmed") return { ...base, outcome: plain, doubt: null, leans: null, strength: standing.strength };
  return { ...base, outcome: "unknown", doubt: standing.state === "expired" ? "TERM_EXPIRED" : "TERM_UNCONFIRMED", leans: plain, strength: null };
}

/** The one result a set of conditions gives. A confirmed blocker decides alone. */
export function eligibilityOf(findings: readonly Pick<Finding, "outcome">[]): Eligibility {
  if (findings.some((f) => f.outcome === "blocked")) return "not_eligible";
  if (findings.some((f) => f.outcome === "unknown")) return "needs_verification";
  if (findings.some((f) => f.outcome === "action")) return "conditional";
  return "eligible";
}

/** An unconfirmed term, as written, would refuse the client. */
export function leansBlocked(findings: readonly Pick<Finding, "outcome" | "leans">[]): boolean {
  return findings.some((f) => f.outcome === "unknown" && f.leans === "blocked");
}

/** The weakest source the reliable answers rest on. Null when none of them rests on a lender's term. */
export function weakestStrength(findings: readonly Pick<Finding, "strength">[]): SourceStrength | null {
  if (findings.some((f) => f.strength === "verbal")) return "verbal";
  return findings.some((f) => f.strength === "written") ? "written" : null;
}

/**
 * The order results are listed in, best first: reliable answers before unreliable ones, and among the
 * unreliable, the ones whose unconfirmed terms would take the client before the ones that would not.
 */
export function eligibilityRank(eligibility: Eligibility, blockedAsWritten: boolean): number {
  if (eligibility === "eligible") return 4;
  if (eligibility === "conditional") return 3;
  if (eligibility === "needs_verification") return blockedAsWritten ? 1 : 2;
  return 0;
}

/** What a set of findings has to say, each thing once. */
export interface Telling<T> {
  /** What has no reliable answer yet: each lender's term and each missing fact once. */
  doubts: T[];
  /** Confirmed conditions that refuse the client. No calculation overrides them. */
  blockers: T[];
  /** Answers on a term nobody confirmed that, as written, refuse the client or ask something of them. */
  leans: T[];
  /** What the client has to do first, on terms that can be relied on. */
  actions: T[];
  /** Reliable answers that are met and still worth saying, such as late payments a lender is confirmed to take. */
  remarks: T[];
}

/**
 * Sorts findings into what is worth saying. One lender's condition is said once, whichever of its
 * products raised it, and one that holds for every lender is said once for all. `owner` names the
 * lender an item belongs to.
 */
export function tell<T>(items: readonly T[], read: (item: T) => Finding, owner: (item: T) => string): Telling<T> {
  const once = (keep: (finding: Finding) => boolean, id: (finding: Finding, who: string) => string): T[] => {
    const told = new Set<string>();
    return items.filter((item) => {
      const finding = read(item);
      if (!keep(finding)) return false;
      const key = id(finding, owner(item));
      if (told.has(key)) return false;
      told.add(key);
      return true;
    });
  };
  const named = (finding: Finding) => (finding.check.ref ? `${finding.check.code}:${finding.check.ref}` : finding.check.code);
  const byCode = (finding: Finding, who: string) => (finding.basis === "lender" ? `${who}:${named(finding)}` : named(finding));
  // A term cut short by the age limit is already in the months and the amount: nothing to say of it.
  const said = (finding: Finding) => finding.check.status !== "pass" && finding.check.code !== "TENOR_SHORTENED";
  return {
    doubts: once(
      (finding) => finding.outcome === "unknown",
      (finding, who) => (finding.doubt === "FACT_MISSING" ? byCode(finding, who) : `${who}:${finding.term}`),
    ),
    blockers: once((finding) => finding.outcome === "blocked", byCode),
    leans: once((finding) => finding.outcome === "unknown" && finding.leans != null && said(finding), byCode),
    actions: once((finding) => finding.outcome === "action", byCode),
    remarks: once((finding) => finding.outcome === "met" && finding.check.status === "warn" && said(finding), byCode),
  };
}

/** One product held against one client, read strictly. */
export interface StrictMatch extends Telling<Finding<Check>> {
  eligibility: Eligibility;
  findings: Finding<Check>[];
  blockedAsWritten: boolean;
  /** The weakest source the reliable answers rest on. */
  strength: SourceStrength | null;
  /** A term that sets the amount, the months or the rate is not confirmed: the figures are an estimate. */
  estimated: boolean;
}

export function strictMatch(match: Pick<Match, "checks" | "product">): StrictMatch {
  const { product } = match;
  // The engine answers the conditions that are written down. Whether the list of them is complete is asked here.
  const checks: Check[] = [...match.checks, listCheck(product.special)];
  const findings = checks.map((check) => findingOf(check, CHECK_RULES[check.code], product.terms));
  return {
    ...tell(
      findings,
      (finding) => finding,
      () => product.lenderName,
    ),
    eligibility: eligibilityOf(findings),
    findings,
    blockedAsWritten: leansBlocked(findings),
    strength: weakestStrength(findings),
    estimated: amountsOpen(product.financeType, product.terms),
  };
}
