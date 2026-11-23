/**
 * A fact about the client that two sources state differently.
 *
 * The file says what the client earns and when they were born. A paper a person checked says it
 * too. Where the two differ, or two checked papers differ, nobody knows which is right, and every
 * answer built on that fact is unreliable until a person settles it. A disputed fact is read the way
 * a missing one is: no lender is answered on it, whichever way the figures point.
 *
 * Which paper states what, and when two values agree, is the documents module's. This file holds only
 * what the strict reading needs: the names of the facts and the condition a dispute raises.
 *
 * Everything in this module is pure: no database, no clock, no text in any language.
 */

/** The facts of the file that a checked paper states too. */
export const PAPER_FACTS = ["totalSalary", "basicSalary", "birthYear"] as const;
export type PaperFact = (typeof PAPER_FACTS)[number];

export const isPaperFact = (value: unknown): value is PaperFact => (PAPER_FACTS as readonly unknown[]).includes(value);

/** One disputed fact, as a condition no lender can be answered on. `ref` names the fact, so two disputes stay two. */
export type ConflictCheck = { key: "file"; status: "warn"; code: "FACT_CONFLICT"; ref: PaperFact; params: { fact: PaperFact } };

/** One condition for each fact in dispute, in the order the facts are named. */
export function conflictChecks(disputed: readonly PaperFact[] | null | undefined): ConflictCheck[] {
  return PAPER_FACTS.filter((fact) => disputed?.includes(fact)).map((fact) => ({ key: "file", status: "warn", code: "FACT_CONFLICT", ref: fact, params: { fact } }));
}
