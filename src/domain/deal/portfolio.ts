import { CAPITAL_OUT_STAGES } from "./structure";
import { dealTimeline } from "./timeline";
import type { Stage, Structure, Verdict } from "./types";

/** What the portfolio view needs to know about one deal in progress. */
export interface PortfolioDeal {
  dealId: number;
  stage: Stage;
  structure: Structure;
  capital: number | null;
  fee: number | null;
  verdict: Verdict | null;
  /** When the deal entered its current stage. */
  stageEnteredAt: Date;
}

export interface PortfolioEntry {
  dealId: number;
  /** Days until the financing is disbursed. Null once that has happened. */
  daysToDisbursement: number | null;
  /** Days left of the current stage. Negative when late. */
  stageDueInDays: number | null;
  /** True while the company's capital is out on this deal. */
  capitalOut: boolean;
}

export interface Portfolio {
  count: number;
  /** Capital the company has out right now. */
  capitalOut: number;
  /** Fees of the deals that close. A deal that is short earns nothing until it is fixed. */
  expectedFees: number;
  /** Capital that is out and expected back within `horizonDays`. */
  returningSoon: number;
  horizonDays: number;
  /** The deal closest to disbursement among those that close. */
  nearest: PortfolioEntry | null;
  /** The deal whose current stage is due first, or most overdue. */
  next: PortfolioEntry | null;
  entries: PortfolioEntry[];
}

const closes = (verdict: Verdict | null) => verdict === "go" || verdict === "tight";

/** Totals and priorities across the deals in progress. */
export function portfolio(deals: readonly PortfolioDeal[], now: Date, horizonDays = 30): Portfolio {
  const entries = deals.map((d): PortfolioEntry => {
    const t = dealTimeline(d.structure, d.stage, d.stageEnteredAt, now);
    return {
      dealId: d.dealId,
      daysToDisbursement: t.daysToDisbursement,
      stageDueInDays: t.stageDueInDays,
      capitalOut: CAPITAL_OUT_STAGES.includes(d.stage),
    };
  });
  const byId = new Map(deals.map((d) => [d.dealId, d]));
  const total = (list: PortfolioEntry[], pick: (d: PortfolioDeal) => number | null) =>
    list.reduce((sum, e) => sum + (pick(byId.get(e.dealId)!) ?? 0), 0);

  const out = entries.filter((e) => e.capitalOut);
  const closing = entries.filter((e) => closes(byId.get(e.dealId)!.verdict));
  const withDays = closing.filter((e) => e.daysToDisbursement != null);
  const withDue = entries.filter((e) => e.stageDueInDays != null);

  return {
    count: deals.length,
    capitalOut: total(out, (d) => d.capital),
    expectedFees: total(closing, (d) => d.fee),
    returningSoon: total(
      out.filter((e) => e.daysToDisbursement != null && e.daysToDisbursement <= horizonDays),
      (d) => d.capital,
    ),
    horizonDays,
    nearest: withDays.length ? withDays.reduce((a, b) => (b.daysToDisbursement! < a.daysToDisbursement! ? b : a)) : null,
    next: withDue.length ? withDue.reduce((a, b) => (b.stageDueInDays! < a.stageDueInDays! ? b : a)) : null,
    entries,
  };
}
