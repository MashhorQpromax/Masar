import type { Borrower, ItemKind, PaidBy } from "./types";

/** How the employer is classified. It decides retirement and which lenders accept the client. */
export const SECTORS = ["gov", "semi_gov", "military", "private_approved", "private", "retired", "self"] as const;
export type Sector = (typeof SECTORS)[number];

/** What is known about a person that a deal depends on. */
export interface BorrowerFacts {
  birthYear: number | null;
  basicSalary: number | null;
  totalSalary: number | null;
  serviceMonths: number | null;
  sector: string;
}

/** The borrower as the engine sees them in a given year. */
export function borrowerIn(facts: BorrowerFacts, year: number): Borrower {
  return {
    age: facts.birthYear ? year - facts.birthYear : null,
    basicSalary: facts.basicSalary,
    totalSalary: facts.totalSalary,
    serviceMonths: facts.serviceMonths,
    sector: facts.sector,
  };
}

/** Who settles an obligation of each kind unless the user says otherwise. An existing personal loan or card is bought out by the new personal finance. */
export const DEFAULT_PAYER: Record<ItemKind, PaidBy> = {
  execution: "company",
  default: "company",
  mortgage_payoff: "company",
  personal_payoff: "bank",
  card: "bank",
  other: "company",
};
