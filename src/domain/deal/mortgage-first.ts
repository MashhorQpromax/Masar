/**
 * The mortgage first: what a deal that is short would raise if the new mortgage took its share of the
 * monthly room before the personal finance.
 *
 * The deal itself is counted the way the office has always counted it, the personal finance first, and
 * nothing here changes that figure, its verdict or what is stored. This is worked out beside it, for
 * the one case where the order decides a deal: the client's net is short, the property's value leaves
 * the mortgage room, and no bank has answered yet. It is an estimate until a bank writes it: the page
 * says so, and the deal closes only on the offer the office then records.
 *
 * Pure: no database, no clock, no text in any language.
 */
import { STRUCTURES } from "./structure";
import { dealStudy } from "./study";
import type { Borrower, CreditFlags, DealInput } from "./types";

export interface MortgageFirst {
  /** The deal closes counted this way. */
  closes: boolean;
  /** The two parts counted this way. */
  mortgage: number;
  personal: number;
  /** The two parts as the deal counts them now. */
  mortgageNow: number;
  personalNow: number;
  /** What the client keeps counted this way. Negative: the deficit that still stands. */
  clientNet: number;
  /** The mortgage's monthly installment before retirement, counted this way. */
  installment: number;
  /** That installment as a share of the salary, percent. Null with no salary. */
  installmentPct: number | null;
}

/**
 * What the mortgage first gives a deal whose net is short. Null when the order changes nothing worth
 * saying: the structure has one part only, the property has no value yet, a bank's own offer already
 * stands for either part, the deal is not short on its net, or the client's net does not rise.
 */
export function mortgageFirst(x: DealInput, b: Borrower, credit?: CreditFlags | null): MortgageFirst | null {
  const now = dealStudy(x, b, credit);
  const st = STRUCTURES[now.structure];
  if (!st.mortgage || !st.personal || !x.propertyValue) return null;
  if (x.bankMortgage != null || x.bankPersonal != null) return null;
  if (now.verdict !== "short" || now.clientNet >= 0) return null;

  const first = dealStudy(x, b, credit, "mortgage");
  if (first.clientNet <= now.clientNet) return null;
  const closes = first.verdict === "go" || first.verdict === "tight";
  // A net that covers while something else still blocks the deal is not a way out.
  if (!closes && first.clientNet >= 0) return null;

  const salary = b.totalSalary ?? b.basicSalary ?? 0;
  return {
    closes,
    mortgage: first.financing.mortgage,
    personal: first.financing.personal,
    mortgageNow: now.financing.mortgage,
    personalNow: now.financing.personal,
    clientNet: first.clientNet,
    installment: first.financing.mortgagePre,
    installmentPct: salary > 0 ? Math.round((first.financing.mortgagePre / salary) * 100) : null,
  };
}
