/**
 * A first answer from a handful of facts.
 *
 * A person on the phone with a client knows a salary, an age and what is paid every month. That is
 * enough for an estimate, and nothing of it is kept. What is not asked takes the value an ordinary
 * file has: a citizen, a first home, a salary bank nobody named.
 */
import { eligibilityRank, strictMatch, type Eligibility } from "./strict";
import type { FinanceType, Match, Obligation, Profile, RecordStanding, Sector, Study } from "./types";

/** The kinds of finance a quick estimate is made for. */
export const QUICK_FINANCE_TYPES = ["personal", "mortgage", "auto"] as const satisfies readonly FinanceType[];
export type QuickFinanceType = (typeof QUICK_FINANCE_TYPES)[number];

/** What is typed into the calculator. An empty number is `null`, which is not zero. */
export interface QuickFacts {
  financeType: QuickFinanceType;
  totalSalary: number | null;
  /** Left empty, the basic salary is taken as a share of the total. */
  basicSalary: number | null;
  /** What the client pays every month on consumer finance. */
  installments: number | null;
  /** What the client pays every month on a mortgage they already have. */
  mortgageInstallment: number | null;
  age: number | null;
  serviceMonths: number | null;
  sector: Sector;
  simah: RecordStanding;
  /** A resident, not a citizen. */
  resident: boolean;
  housingSupport: boolean;
  requestedAmount: number | null;
  /** Left empty, each lender's longest term is used. */
  requestedTenor: number | null;
  propertyValue: number | null;
  coIncome: number | null;
  /** The client already owns a home. */
  secondHome: boolean;
}

/** The share of the total salary taken as basic when the basic salary is not given. */
export const BASIC_SHARE_ASSUMED = 0.7;

/** Where the calculator starts: an ordinary government employee with nothing owed. */
export const QUICK_DEFAULTS: QuickFacts = {
  financeType: "personal",
  totalSalary: 12000,
  basicSalary: null,
  installments: null,
  mortgageInstallment: null,
  age: 35,
  serviceMonths: 36,
  sector: "gov",
  simah: "clean",
  resident: false,
  housingSupport: false,
  requestedAmount: null,
  requestedTenor: null,
  propertyValue: null,
  coIncome: null,
  secondHome: false,
};

/** The basic salary an estimate is made on. */
export function quickBasicSalary(f: Pick<QuickFacts, "totalSalary" | "basicSalary">): number | null {
  if (f.basicSalary) return f.basicSalary;
  return f.totalSalary ? f.totalSalary * BASIC_SHARE_ASSUMED : null;
}

/** The profile the engine studies, from what was typed. */
export function quickProfile(f: QuickFacts): Profile {
  const obligations: Obligation[] = [];
  if (f.installments) obligations.push({ kind: "personal", monthly: f.installments });
  if (f.mortgageInstallment) obligations.push({ kind: "mortgage", monthly: f.mortgageInstallment });
  return {
    age: f.age,
    nationality: f.resident ? "non_saudi" : "saudi",
    sector: f.sector,
    serviceMonths: f.serviceMonths,
    basicSalary: quickBasicSalary(f),
    totalSalary: f.totalSalary || null,
    salaryBank: null,
    simah: f.simah,
    housingSupport: f.housingSupport,
    financeType: f.financeType,
    requestedAmount: f.requestedAmount || null,
    requestedTenor: f.requestedTenor || null,
    obligations,
    firstHome: !f.secondHome,
    propertyValue: f.propertyValue || null,
    coIncome: f.coIncome || null,
  };
}

/**
 * What a quick estimate says about the client: the best result any product gives when read strictly.
 * An estimate is still an answer about lenders, so it is no surer than their terms are: a product
 * nobody confirmed never makes the client eligible, and never makes them refused.
 */
export type QuickVerdict = Eligibility;

const RESULTS = ["eligible", "conditional", "needs_verification"] as const;

export function quickVerdict(s: Pick<Study, "matches">): QuickVerdict {
  const given = new Set(s.matches.map((m) => strictMatch(m).eligibility));
  return RESULTS.find((result) => given.has(result)) ?? "not_eligible";
}

/** How far a product's answer can be relied on, as a number to order by. */
function reliance(m: Match): number {
  const read = strictMatch(m);
  return eligibilityRank(read.eligibility, read.blockedAsWritten);
}

/** The products that, as their terms are written, take the client: the ones that can be relied on first, then as the engine ranked them. */
function open(s: Pick<Study, "matches">): Match[] {
  return s.matches
    .filter((m) => m.verdict !== "fail")
    .map((m, index) => ({ m, index, rank: reliance(m) }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map(({ m }) => m);
}

/**
 * The product the estimate names: among those whose answer can be relied on most, the one that lends
 * the most, the better ranked first on a tie. The figure said beside the result is this product's,
 * so a result that is confirmed is never said with the amount of a lender that is not.
 */
export function largestOffer(s: Pick<Study, "matches">): Match | null {
  const offers = open(s);
  const top = offers[0] ? reliance(offers[0]) : 0;
  let best: Match | null = null;
  for (const m of offers) if (reliance(m) === top && m.maxPrincipal > (best?.maxPrincipal ?? 0)) best = m;
  return best;
}

/**
 * The products that take the client, in the order an estimate reads them: the one the answer names
 * first, then the rest, the ones that can be relied on ahead of the others.
 */
export function openOffers(s: Pick<Study, "matches">): Match[] {
  const offers = open(s);
  const top = largestOffer(s);
  return top ? [top, ...offers.filter((m) => m !== top)] : offers;
}
