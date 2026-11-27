import "server-only";
import { portfolio, stationOf, type Portfolio, type Stage, type StationKey, type Structure, type Verdict } from "@/domain/deal";
import type { Db } from "../db/client";
import { listOpenDeals } from "./service";
import { holdsByDeal } from "./wait";

/** One deal as the road shows it. */
export interface RoadDeal {
  dealId: number;
  clientName: string;
  fileNo: string;
  stage: Stage;
  station: StationKey;
  structure: Structure;
  verdict: Verdict | null;
  capital: number | null;
  fee: number | null;
  clientNet: number | null;
  /** Days until the financing is disbursed. Null once that has happened. */
  daysToDisbursement: number | null;
  /** Days left of the current stage. Negative when late. */
  stageDueInDays: number | null;
  /** The current stage stands still until the wait after the deal's paid defaults ends. */
  held: boolean;
}

export interface RoadView {
  portfolio: Portfolio;
  deals: RoadDeal[];
}

/** Every deal in progress with where it stands, and the totals across them. */
export async function roadView(db: Db, now: Date): Promise<RoadView> {
  const open = await listOpenDeals(db);
  // A deal that pays a default waits for its lender afterwards: its dates and its lateness are counted with that wait.
  const holds = await holdsByDeal(db, open, now);
  const totals = portfolio(
    open.map((deal) => ({ ...deal, hold: holds.get(deal.dealId) ?? null })),
    now,
  );
  const entries = new Map(totals.entries.map((e) => [e.dealId, e]));
  const deals = open.flatMap((deal): RoadDeal[] => {
    const station = stationOf(deal.stage);
    const entry = entries.get(deal.dealId);
    if (!station || !entry) return [];
    return [
      {
        dealId: deal.dealId,
        clientName: deal.clientName,
        fileNo: deal.fileNo,
        stage: deal.stage,
        station,
        structure: deal.structure,
        verdict: deal.verdict,
        capital: deal.capital,
        fee: deal.fee,
        clientNet: deal.clientNet,
        daysToDisbursement: entry.daysToDisbursement,
        stageDueInDays: entry.stageDueInDays,
        held: entry.held,
      },
    ];
  });
  return { portfolio: totals, deals };
}
