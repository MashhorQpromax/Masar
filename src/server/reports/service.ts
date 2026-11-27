import "server-only";
import { desc, eq, inArray, min } from "drizzle-orm";
import { dayOf } from "@/domain/eligibility";
import { firstMonth, monthOf, monthReport, type Month, type MonthAnswer, type MonthDeal, type MonthReport } from "@/domain/report";
import type { Tx } from "../db/client";
import { clients, dealStageEvents, deals, lenderRequests, lenders, outcomes } from "../db/schema";

export interface MonthView extends MonthReport {
  /** The month that holds today. */
  thisMonth: Month;
  /** The month the office's first deal was opened, or this month when there is none. */
  first: Month;
}

/**
 * The office's month, read from what the system holds: deals and the days they entered their stages,
 * lenders' answers, and requests. It reads and writes nothing.
 */
export async function monthView(db: Tx, args: { month: Month; now: Date }): Promise<MonthView> {
  const dealRows = await db
    .select({ dealId: deals.id, clientName: clients.fullName, fileNo: clients.fileNo, createdAt: deals.createdAt, stage: deals.stage, fee: deals.fee, collected: deals.feeCollected })
    .from(deals)
    .innerJoin(clients, eq(clients.id, deals.clientId));
  // A deal opens with its first stage, the day its study began, as its page counts it; the row's own time when none was kept.
  const opening = new Map(
    (await db.select({ dealId: dealStageEvents.dealId, at: min(dealStageEvents.createdAt) }).from(dealStageEvents).groupBy(dealStageEvents.dealId)).map((row) => [row.dealId, row.at]),
  );
  // The day a deal entered the stage it ends in: its latest event of that stage.
  const endings = await db
    .select({ dealId: dealStageEvents.dealId, stage: dealStageEvents.stage, at: dealStageEvents.createdAt })
    .from(dealStageEvents)
    .where(inArray(dealStageEvents.stage, ["closed", "lost"]))
    .orderBy(desc(dealStageEvents.createdAt), desc(dealStageEvents.id));
  const endedOn = (dealId: number, stage: string): string | null => {
    const event = endings.find((row) => row.dealId === dealId && row.stage === stage);
    return event ? dayOf(event.at) : null;
  };
  const list: MonthDeal[] = dealRows.map((row) => ({
    dealId: row.dealId,
    clientName: row.clientName,
    fileNo: row.fileNo,
    openedOn: dayOf(opening.get(row.dealId) ?? row.createdAt),
    stage: row.stage,
    stageOn: row.stage === "closed" || row.stage === "lost" ? endedOn(row.dealId, row.stage) : null,
    fee: row.fee,
    collected: row.collected,
  }));

  const answerRows = await db
    .select({ lenderId: outcomes.lenderId, lender: lenders.name, decision: outcomes.decision, paper: outcomes.replyPaperId, on: outcomes.answeredOn, at: outcomes.createdAt })
    .from(outcomes)
    .innerJoin(lenders, eq(lenders.id, outcomes.lenderId));
  const answers: MonthAnswer[] = answerRows.map((row) => ({ lenderId: row.lenderId, lender: row.lender, decision: row.decision, written: row.paper != null, on: row.on ?? dayOf(row.at) }));

  const requestRows = await db.select({ status: lenderRequests.status, sentOn: lenderRequests.sentOn, answeredAt: lenderRequests.answeredAt }).from(lenderRequests);
  const requests = requestRows.map((row) => ({ sentOn: row.sentOn, answeredOn: row.answeredAt ? dayOf(row.answeredAt) : null, waiting: row.status === "sent" }));

  const thisMonth = monthOf(dayOf(args.now));
  return { ...monthReport({ month: args.month, deals: list, answers, requests }), thisMonth, first: firstMonth(list) ?? thisMonth };
}
