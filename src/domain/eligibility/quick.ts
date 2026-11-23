/**
 * A first answer from a handful of facts.
 *
 * A person on the phone with a client knows a salary, an age and what is paid every month. That is
 * enough for an estimate, and nothing of it is kept. What is not asked takes the value an ordinary
 * file has: a citizen, a first home, a salary bank nobody named.
 */
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
 * What a quick estimate says about the client. A file waits when facts are missing; an estimate never
 * does, because the salary bank and the amount asked for are not part of it.
 */
export type QuickVerdict = "eligible" | "conditional" | "not_eligible";

export function quickVerdict(s: Pick<Study, "eligible" | "conditional">): QuickVerdict {
  if (s.eligible) return "eligible";
  return s.conditional ? "conditional" : "not_eligible";
}

/** The product that lends the most among those that take the client, the better ranked first on a tie. */
export function largestOffer(s: Pick<Study, "matches">): Match | null {
  let best: Match | null = null;
  for (const m of s.matches) if (m.verdict !== "fail" && m.maxPrincipal > (best?.maxPrincipal ?? 0)) best = m;
  return best;
}

/**
 * The products that take the client, in the order an estimate reads them: the one the answer names
 * first, then the rest as the engine ranked them.
 */
export function openOffers(s: Pick<Study, "matches">): Match[] {
  const open = s.matches.filter((m) => m.verdict !== "fail");
  const top = largestOffer(s);
  return top ? [top, ...open.filter((m) => m !== top)] : open;
}
