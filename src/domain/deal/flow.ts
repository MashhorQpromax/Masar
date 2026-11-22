import type { DealStudy } from "./types";

export type FlowPart = "capital" | "buyout" | "fee" | "costs" | "client";

export interface FundsFlow {
  /** The new financing that reaches the deal: the mortgage, up to the sale price, plus personal finance. */
  total: number;
  /** Where the financing goes. The amounts add up to `total` when the deal closes. */
  parts: { key: FlowPart; amount: number }[];
  /** What the financing falls short by. Zero when the deal closes. */
  deficit: number;
}

/**
 * Where the new financing goes: back to the company as capital, to buy out the client's existing
 * finance, to the company's fee, to the lender's and the sale's costs, and what is left for the client.
 *
 * Capital, fee and the client's share are the study's own figures. Costs are the remainder, which is
 * the lender's admin fee plus the sale tax, so the parts always add up exactly.
 *
 * A bank pays the seller the sale price at most. When an offer is entered above the valuation, the
 * study does not count the excess for anyone, so it is left out here as well.
 */
export function fundsFlow(study: DealStudy): FundsFlow {
  const overPrice = study.price > 0 ? Math.max(0, study.financing.mortgage - study.price) : 0;
  const total = study.summary.totalFinancing - overPrice;
  const client = Math.max(0, study.clientNet);
  const deficit = Math.max(0, -study.clientNet);
  const costs = total + deficit - study.capital - study.paidByBank - study.fee - client;
  const parts: FundsFlow["parts"] = [
    { key: "capital", amount: study.capital },
    { key: "buyout", amount: study.paidByBank },
    { key: "fee", amount: study.fee },
    { key: "costs", amount: costs },
    { key: "client", amount: client },
  ];
  return { total, parts: parts.filter((p) => p.amount > 0), deficit };
}
