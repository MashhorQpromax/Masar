/**
 * The office's month: the deals that came in, the deals that closed and their fees, the deals that fell
 * through, and what the lenders answered. Everything is counted from what the system already holds:
 * nobody enters anything for it, and it changes nothing.
 *
 * A closed deal's fee is the fee as the deal was last counted. What the office actually collected is
 * not recorded yet, so the report never calls it collected.
 *
 * Pure: no database, no clock, no text in any language. Days are ISO days in Riyadh, worked out by the
 * caller.
 */
import type { Stage } from "../deal";

/** A month as "yyyy-mm". */
export type Month = string;

export const isMonth = (text: unknown): text is Month => typeof text === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(text);

/** The month an ISO day falls in. */
export const monthOf = (day: string): Month => day.slice(0, 7);

/** The month `by` months after this one; a negative `by` goes back. */
export function shiftMonth(month: Month, by: number): Month {
  const [year, number] = month.split("-").map(Number) as [number, number];
  const index = year * 12 + (number - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string): number => Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS));

/** A deal as the month reads it. */
export interface MonthDeal {
  dealId: number;
  clientName: string;
  fileNo: string;
  /** The day it was opened. */
  openedOn: string;
  stage: Stage;
  /** The day it entered the stage it stands in now. Null when no stage was recorded for it. */
  stageOn: string | null;
  /** The fee as the deal was last counted. Null before it was counted. */
  fee: number | null;
}

/** One answer a lender gave, as the office recorded it. */
export interface MonthAnswer {
  lenderId: number;
  lender: string;
  decision: "approved" | "approved_modified" | "rejected";
  /** A paper of the file held the answer when it was recorded. */
  written: boolean;
  /** The day the lender answered. */
  on: string;
}

/** One request the office prepared for a lender. */
export interface MonthRequest {
  /** The day a person sent it. Null: not sent. */
  sentOn: string | null;
  /** The day its answer was recorded. Null: no answer yet. */
  answeredOn: string | null;
  /** Sent, and still waiting for the lender. */
  waiting: boolean;
}

/** A deal that closed or fell through in the month. */
export interface EndedDeal {
  dealId: number;
  clientName: string;
  fileNo: string;
  on: string;
  /** Days from opening to that day. */
  days: number;
  fee: number | null;
}

export interface LenderMonth {
  lenderId: number;
  lender: string;
  answers: number;
  approved: number;
  refused: number;
  written: number;
}

export interface MonthReport {
  month: Month;
  /** Deals opened in the month. */
  opened: number;
  /** Deals closed in the month, the latest first. */
  closed: EndedDeal[];
  /** Deals that fell through in the month, the latest first. */
  lost: EndedDeal[];
  /** The fees of the deals closed in the month, as each was last counted. */
  closedFees: number;
  /** Days from opening to closing, on average, of the deals closed in the month. Null when none closed. */
  closedDays: number | null;
  /** The lenders that answered in the month, the busiest first. */
  lenders: LenderMonth[];
  requests: {
    /** Sent in the month. */
    sent: number;
    /** Answered in the month. */
    answered: number;
    /** Waiting for an answer now, whatever the month. */
    waiting: number;
  };
}

function ended(deals: readonly MonthDeal[], stage: "closed" | "lost", month: Month): EndedDeal[] {
  return deals
    .filter((deal) => deal.stage === stage && deal.stageOn != null && monthOf(deal.stageOn) === month)
    .map((deal) => ({ dealId: deal.dealId, clientName: deal.clientName, fileNo: deal.fileNo, on: deal.stageOn!, days: daysBetween(deal.openedOn, deal.stageOn!), fee: deal.fee }))
    .sort((a, b) => b.on.localeCompare(a.on) || b.dealId - a.dealId);
}

/** The month as the office reads it. */
export function monthReport(args: { month: Month; deals: readonly MonthDeal[]; answers: readonly MonthAnswer[]; requests: readonly MonthRequest[] }): MonthReport {
  const { month } = args;
  const closed = ended(args.deals, "closed", month);
  const lost = ended(args.deals, "lost", month);

  const byLender = new Map<number, LenderMonth>();
  for (const answer of args.answers) {
    if (monthOf(answer.on) !== month) continue;
    const line = byLender.get(answer.lenderId) ?? { lenderId: answer.lenderId, lender: answer.lender, answers: 0, approved: 0, refused: 0, written: 0 };
    line.answers += 1;
    if (answer.decision === "rejected") line.refused += 1;
    else line.approved += 1;
    if (answer.written) line.written += 1;
    byLender.set(answer.lenderId, line);
  }

  return {
    month,
    opened: args.deals.filter((deal) => monthOf(deal.openedOn) === month).length,
    closed,
    lost,
    closedFees: closed.reduce((sum, deal) => sum + (deal.fee ?? 0), 0),
    closedDays: closed.length ? Math.round(closed.reduce((sum, deal) => sum + deal.days, 0) / closed.length) : null,
    lenders: [...byLender.values()].sort((a, b) => b.answers - a.answers || a.lender.localeCompare(b.lender, "ar")),
    requests: {
      sent: args.requests.filter((request) => request.sentOn != null && monthOf(request.sentOn) === month).length,
      answered: args.requests.filter((request) => request.answeredOn != null && monthOf(request.answeredOn) === month).length,
      waiting: args.requests.filter((request) => request.waiting).length,
    },
  };
}

/** The first month the office has anything in: the month its first deal was opened. Null with no deal. */
export function firstMonth(deals: readonly Pick<MonthDeal, "openedOn">[]): Month | null {
  return deals.reduce<Month | null>((first, deal) => (first == null || monthOf(deal.openedOn) < first ? monthOf(deal.openedOn) : first), null);
}
