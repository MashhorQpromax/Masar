/**
 * What the client keeps, line by line, and which of its figures stand on a written word.
 *
 * A figure is confirmed when a paper from whoever sets it says so: the lender's written offer for a
 * financing (its recorded decision, or the offer typed in), and the creditor's own letter for an
 * obligation (a liability or clearance letter). Every other figure is counted by the engine from
 * general terms: a financing from the salary and the rules, the lender's admin fee, the taxes on the
 * expected valuation, the costs typed as expected. Those are estimates.
 *
 * A sum is confirmed only when every figure in it is. A sum of confirmed and estimated figures is an
 * estimate, and it never goes without the lines that say which is which.
 *
 * Everything in this module is pure: no database, no clock, no text in any language.
 */
import { splitItems, structureOf, STRUCTURES } from "./structure";
import { inSettlementBase } from "./study";
import { normalizeFee } from "./fee";
import type { DealInput, DealStudy } from "./types";

export type Certainty = "confirmed" | "estimated";

/** The lines of the client's net, in the order they are read: what comes in, then what goes out of it. */
export const NET_PARTS = ["mortgage", "personal", "obligations", "costs", "fee"] as const;
export type NetPart = (typeof NET_PARTS)[number];

/** What comes in. Every other line goes out of it. */
export const NET_INCOME: ReadonlySet<NetPart> = new Set<NetPart>(["mortgage", "personal"]);

export interface NetLine {
  part: NetPart;
  /** Always positive: whether it comes in or goes out is the part's. */
  amount: number;
  certainty: Certainty;
  /** Of the amount, what stands on a written word. */
  confirmed: number;
  /** For the obligations: how many the deal settles, and how many a creditor's letter confirms. */
  count?: { all: number; confirmed: number };
  /** For a financing counted from general terms: whether a lender's ceiling is what holds it. */
  held?: boolean;
}

export interface ClientNet {
  lines: NetLine[];
  /** What the client keeps: what comes in less what goes out. The study's own figure, to the riyal. */
  net: number;
  certainty: Certainty;
  /** The lines that are estimates, in their order. Empty when the net is confirmed. */
  estimated: NetPart[];
  /** The lines that are confirmed, in their order. */
  confirmed: NetPart[];
  /** The lines that are estimates with some of their amount confirmed: obligations some of whose letters came. */
  partly: NetPart[];
  /**
   * Monthly deduction after the new financing, percent, beside the cap that applies. The installments
   * are counted from the rates the study assumes, so it is an estimate even on a written offer.
   */
  deduction: { after: number | null; cap: number };
}

/**
 * The client's net as lines, each with where its figure comes from.
 *
 * The mortgage counts up to the sale price: a lender does not lend more than the property is sold for,
 * and what the study keeps for the client is counted the same way.
 */
export function clientNet(input: DealInput, study: DealStudy): ClientNet {
  const structure = structureOf(input);
  const st = STRUCTURES[structure];
  const { active } = splitItems(input);
  const fee = normalizeFee(input.fee);
  const lines: NetLine[] = [];
  const line = (part: NetPart, amount: number, sure: boolean, extra: Partial<NetLine> = {}) =>
    lines.push({ part, amount, certainty: sure ? "confirmed" : "estimated", confirmed: sure ? amount : 0, ...extra });

  const mortgageSure = input.bankMortgage != null;
  const personalSure = input.bankPersonal != null;
  if (st.mortgage) {
    const mortgage = study.price > 0 ? Math.min(study.financing.mortgage, study.price) : study.financing.mortgage;
    line("mortgage", mortgage, mortgageSure, mortgageSure ? {} : { held: study.financing.mortgageCeiling != null });
  }
  if (st.personal) line("personal", study.financing.personal, personalSure, personalSure ? {} : { held: study.financing.personalCeiling != null });

  if (active.length > 0) {
    const amount = study.summary.totalObligations;
    const confirmedItems = active.filter((item) => item.confirmed);
    const confirmed = Math.round(confirmedItems.reduce((total, item) => total + Math.round(item.pay), 0));
    const all = confirmedItems.length === active.length;
    lines.push({
      part: "obligations",
      amount,
      certainty: all ? "confirmed" : "estimated",
      confirmed: all ? amount : confirmed,
      count: { all: active.length, confirmed: confirmedItems.length },
    });
  }

  // The lender's admin fee, the taxes and the costs are counted from the valuation and general terms.
  const costs = study.summary.costs.reduce((total, cost) => total + cost.amount, 0);
  if (costs > 0) line("costs", costs, false);

  // The office's fee is as sure as what each of its percents is counted on.
  const sure = (part: NetPart) => lines.find((l) => l.part === part)?.certainty !== "estimated";
  const settleSure = active.filter((item) => inSettlementBase(item, fee)).every((item) => item.confirmed);
  const financeSure =
    fee.financeBase === "personal"
      ? sure("personal")
      : fee.financeBase === "mortgage"
        ? sure("mortgage")
        : fee.financeBase === "net"
          ? lines.every((l) => l.certainty === "confirmed")
          : sure("mortgage") && sure("personal");
  if (study.fee > 0) line("fee", study.fee, (study.feeSettle === 0 || settleSure) && (study.feeFinance === 0 || financeSure));

  const estimated = lines.filter((l) => l.certainty === "estimated").map((l) => l.part);
  return {
    lines,
    net: study.clientNet,
    certainty: estimated.length === 0 ? "confirmed" : "estimated",
    estimated,
    confirmed: lines.filter((l) => l.certainty === "confirmed").map((l) => l.part),
    partly: lines.filter((l) => l.certainty === "estimated" && l.confirmed > 0).map((l) => l.part),
    deduction: { after: study.financing.dbrAfter, cap: Math.round(study.financing.totalCap * 100) },
  };
}

/** What comes in less what goes out, by the lines alone: the net the lines add up to. */
export function linesTotal(lines: readonly NetLine[]): number {
  return lines.reduce((total, l) => total + (NET_INCOME.has(l.part) ? l.amount : -l.amount), 0);
}
