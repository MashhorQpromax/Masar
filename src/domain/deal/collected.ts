import type { Stage } from "./types";

/**
 * The fee the office actually collected. A deal's fee is counted from its numbers; what reached the
 * office may be another amount, and only a person knows it. It is recorded on a closed deal: until
 * then the fee is still on its way. Recording it changes no figure of the deal and no approval.
 *
 * The owner left this to the office's recommendation on 2026-11-27: one field, filled by a person.
 */

/** The most taken for a collected fee, in riyals. A slip of extra digits is refused, not kept. */
export const COLLECTED_MAX = 100_000_000;

/**
 * Why an amount is not recorded:
 * - `NOT_CLOSED`: the deal is not closed, so its fee is not collected yet.
 * - `AMOUNT`: not an amount of money between nothing and the most taken.
 */
export type CollectedRefusal = "NOT_CLOSED" | "AMOUNT";

/** `amount`: riyals. Null takes a recorded amount back. Zero is an amount: the office collected nothing. */
export function collectedRefusal(args: { stage: Stage; amount: number | null }): CollectedRefusal | null {
  if (args.stage !== "closed") return "NOT_CLOSED";
  const { amount } = args;
  if (amount == null) return null;
  return Number.isFinite(amount) && amount >= 0 && amount <= COLLECTED_MAX ? null : "AMOUNT";
}

/** An amount to the halala, as it is kept. */
export const toHalala = (amount: number): number => Math.round(amount * 100) / 100;

/**
 * How far what was collected stands from what was counted: above zero when the office collected more.
 * Null when either is not known.
 */
export function collectedGap(counted: number | null, collected: number | null): number | null {
  return counted == null || collected == null ? null : toHalala(collected - counted);
}
