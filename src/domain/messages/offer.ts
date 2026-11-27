import { clientNet, feeChanges, linesTotal, normalizeFee, readTerms, type Certainty, type DealInput, type DealStudy, type DealSummary, type FeePlan, type FeeTerms, type FinanceBase } from "../deal";

/** One cost paid out of the financing, as the study names it. */
export type OfferCost = DealSummary["costs"][number];

/**
 * One item of the office's fee: a percent with what it is counted on and what it comes to, or a flat
 * amount. An item that comes to nothing is not an item.
 */
export type OfferFeeItem =
  | { kind: "settle"; pct: number; base: number; includesPayoff: boolean; amount: number }
  | { kind: "finance"; pct: number; base: number; on: FinanceBase; amount: number }
  | { kind: "fixed"; amount: number };

/**
 * The client's final offer: where the new financing goes, to the riyal, with the office's fee in
 * detail. The owner decided on 2026-11-23 that a client sees the fee's percent, what it is counted on
 * and every item of it. The office's capital, its return and its cover are not here on purpose: an
 * offer built from this type cannot tell a client what the office puts in or what it earns on it.
 *
 * The lines read as a sum the client can check: the financing, less what is paid for them, less the
 * costs, less the fee, is what they keep.
 */
export interface ClientOffer {
  financing: { part: "mortgage" | "personal"; amount: number; certainty: Certainty }[];
  totalFinancing: number;
  /** What the deal pays for the client out of it: obligations settled and financing paid off. Null when it pays none. */
  obligations: { amount: number; certainty: Certainty } | null;
  costs: OfferCost[];
  /** `terms`: when the fee falls due and how it is collected, as approved. Null on a plan approved before they were kept. */
  fee: { items: OfferFeeItem[]; total: number; certainty: Certainty; terms: FeeTerms | null };
  /** Cash the client keeps at the end. */
  keeps: number;
  /**
   * The client's monthly deduction after the new financing, percent of their salary: the owner's
   * roadmap shows it to the client beside the net and the costs. It is counted from the rates the
   * study assumes, so it is an estimate even on a written offer. Null when the salary is not known.
   */
  deduction: number | null;
  /** Confirmed only when every line above stands on a written word. */
  certainty: Certainty;
}

/**
 * The offer of a deal whose fee plan stands approved. The fee is read from the approved copy, never
 * from a fee nobody approved, and everything else from the study that copy was made of.
 *
 * Null when the copy and the study do not say the same fee and the same net, or the lines do not add
 * up to what the client keeps: an offer that cannot be checked by hand is not made.
 */
export function clientOffer(deal: { input: DealInput; study: DealStudy }, approved: FeePlan): ClientOffer | null {
  const { input, study } = deal;
  if (study.verdict !== "go" && study.verdict !== "tight") return null;
  if (approved.amounts.total !== study.fee || approved.clientNet !== study.clientNet) return null;
  if (feeChanges(normalizeFee(approved.fee), normalizeFee(input.fee)).length > 0) return null;

  const net = clientNet(input, study);
  if (linesTotal(net.lines) !== study.clientNet || study.clientNet < 0) return null;
  const line = (part: (typeof net.lines)[number]["part"]) => net.lines.find((entry) => entry.part === part);

  const financing = (["mortgage", "personal"] as const).flatMap((part) => {
    const found = line(part);
    return found && found.amount > 0 ? [{ part, amount: found.amount, certainty: found.certainty }] : [];
  });
  const obligations = line("obligations");
  const costs = study.summary.costs.filter((cost) => cost.amount > 0);
  if (costs.reduce((total, cost) => total + cost.amount, 0) !== (line("costs")?.amount ?? 0)) return null;

  const { amounts, bases } = approved;
  const fee = normalizeFee(approved.fee);
  const items: OfferFeeItem[] = [];
  if (amounts.settle > 0) items.push({ kind: "settle", pct: fee.settlePct, base: bases.settle, includesPayoff: fee.settleIncludesPayoff, amount: amounts.settle });
  if (amounts.finance > 0) items.push({ kind: "finance", pct: fee.financePct, base: bases.finance, on: fee.financeBase, amount: amounts.finance });
  if (amounts.fixed > 0) items.push({ kind: "fixed", amount: amounts.fixed });
  if (items.reduce((total, item) => total + item.amount, 0) !== amounts.total) return null;

  return {
    financing,
    totalFinancing: financing.reduce((total, part) => total + part.amount, 0),
    obligations: obligations && obligations.amount > 0 ? { amount: obligations.amount, certainty: obligations.certainty } : null,
    costs,
    fee: { items, total: amounts.total, certainty: line("fee")?.certainty ?? "confirmed", terms: readTerms(approved.terms) },
    keeps: study.clientNet,
    deduction: net.deduction.after,
    certainty: net.certainty,
  };
}

/** What the lines of an offer add up to: the financing less everything paid out of it. */
export function offerTotal(offer: ClientOffer): number {
  return offer.totalFinancing - (offer.obligations?.amount ?? 0) - offer.costs.reduce((total, cost) => total + cost.amount, 0) - offer.fee.total;
}

/**
 * What holds back the final offer of a deal that closes on its numbers:
 * - `APPROVAL_APART`: a lender's written approval stands for another amount than the deal is counted
 *   on. A final offer says figures to the riyal, so it does not go out over a paper that says
 *   otherwise. The owner left this to the office's recommendation on 2026-11-27.
 * - `PLAN`: the deal's fee plan does not stand approved as the deal is now.
 *
 * The amounts come first: counting the deal on the approved amount drops the plan's approval anyway,
 * so a person is sent to the number before the signature.
 */
export type OfferHold = "APPROVAL_APART" | "PLAN";

/** `apart`: how many written approvals the deal is not counted on. `made`: an offer could be made of the approved plan. */
export function offerHold(args: { apart: number; made: boolean }): OfferHold | null {
  if (args.apart > 0) return "APPROVAL_APART";
  return args.made ? null : "PLAN";
}
