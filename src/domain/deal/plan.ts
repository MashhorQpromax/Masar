/**
 * Approving a deal's fee plan: the manager says the office's fee and what the client is left with
 * stand as worked out. The plan is kept as it was approved, a copy that never changes. When anything
 * the numbers rest on changes (an amount, a lender's offer, the fee, a fact about the client that moves
 * the estimate), the approval falls and the plan is approved again, as a new copy.
 *
 * A deal that does not close (a deficit, or a valuation still missing) is not approved: a deal with a
 * deficit is a rejected file, and nothing is offered on it.
 *
 * Pure: the print is made by the server; this module only compares.
 */
import { feeChanges, type FeePart } from "./fee";
import type { DealInput, DealStudy, Fee, Verdict } from "./types";

/** The plan as approved: the fee, what it comes to and on what, and where the money goes. */
export interface FeePlan {
  fee: Fee;
  verdict: Verdict;
  /** What the office's fee comes to, part by part, and the amounts each percent is counted on. */
  amounts: { settle: number; finance: number; fixed: number; total: number };
  bases: { settle: number; finance: number };
  /** The new financing, the money the office puts in, what is left before the fee, and what the client keeps. */
  financing: number;
  capital: number;
  afterSettle: number;
  clientNet: number;
  /**
   * The print of the lenders' terms the deal's route rests on: each product's values, sources and
   * special conditions. Null when the deal holds no route of the catalogue. A copy made before it was
   * kept has none.
   */
  lenders?: string | null;
}

export function feePlan(input: DealInput, study: DealStudy): FeePlan {
  return {
    fee: { ...input.fee },
    verdict: study.verdict,
    amounts: { settle: study.feeSettle, finance: study.feeFinance, fixed: study.feeFixed, total: study.fee },
    bases: { settle: study.settleBase, finance: study.financeBase },
    financing: study.summary.totalFinancing,
    capital: study.capital,
    afterSettle: study.summary.afterSettle,
    clientNet: study.clientNet,
  };
}

/**
 * Why a plan is not approved. Null when it may be.
 * - `NOT_CLOSING`: the deal has a deficit, or lacks what it needs to be judged.
 * - `STANDS`: an approval of exactly this plan stands.
 */
export type PlanRefusal = "NOT_CLOSING" | "BLOCKED" | "STANDS";

/**
 * `blocked`: a condition a lender confirmed, or the lender's own refusal, stands against the route the
 * deal is on. No approval passes over it.
 */
export function planRefusal(plan: Pick<FeePlan, "verdict">, args: { now: string; standing: string | null; blocked?: boolean }): PlanRefusal | null {
  if (plan.verdict !== "go" && plan.verdict !== "tight") return "NOT_CLOSING";
  if (args.blocked) return "BLOCKED";
  if (args.standing === args.now) return "STANDS";
  return null;
}

/** The figures of a plan a person reads first, in the order they are told when one changed. */
export const PLAN_FIGURES = ["fee", "clientNet", "financing", "capital"] as const;
export type PlanFigure = (typeof PLAN_FIGURES)[number];

const figure = (plan: FeePlan, name: PlanFigure): number => (name === "fee" ? plan.amounts.total : plan[name]);

/**
 * What moved between the plan as approved and as it stands: each figure with what it was and is, and
 * the parts of the fee itself that were set otherwise. Both empty while only something behind the
 * figures changed (the approval still falls: the print is of everything).
 */
export function planMoves(then: FeePlan, now: FeePlan): { figures: { name: PlanFigure; then: number; now: number }[]; fee: FeePart[]; lenders: boolean } {
  return {
    figures: PLAN_FIGURES.flatMap((name) => (figure(then, name) !== figure(now, name) ? [{ name, then: figure(then, name), now: figure(now, name) }] : [])),
    fee: feeChanges(then.fee, now.fee),
    // A copy made before the lenders were printed says nothing about them.
    lenders: then.lenders !== undefined && (then.lenders ?? null) !== (now.lenders ?? null),
  };
}
