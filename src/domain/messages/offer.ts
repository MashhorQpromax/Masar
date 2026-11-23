import { clientNet, feeChanges, linesTotal, normalizeFee, type Certainty, type DealInput, type DealStudy, type DealSummary, type FeePlan, type FinanceBase } from "../deal";

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
  fee: { items: OfferFeeItem[]; total: number; certainty: Certainty };
  /** Cash the client keeps at the end. */
  keeps: number;
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
    fee: { items, total: amounts.total, certainty: line("fee")?.certainty ?? "confirmed" },
    keeps: study.clientNet,
    certainty: net.certainty,
  };
}

/** What the lines of an offer add up to: the financing less everything paid out of it. */
export function offerTotal(offer: ClientOffer): number {
  return offer.totalFinancing - (offer.obligations?.amount ?? 0) - offer.costs.reduce((total, cost) => total + cost.amount, 0) - offer.fee.total;
}
