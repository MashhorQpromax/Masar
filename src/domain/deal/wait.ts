import { round0, sum } from "../shared/num";
import { splitItems, STAGES, stagesFor, STRUCTURES, structureOf } from "./structure";
import type { DealItem, DealStudy, Stage, Structure } from "./types";

/**
 * The wait after a default is paid.
 *
 * A lender does not take a client the day their default is paid. The record shows the default paid,
 * not gone, and the lender holds the client for months before any new financing. The owner stated the
 * market's practice on 2026-11-27 as six months to a year, and chose the same day how it enters a
 * deal: every deal that pays a default or a court order shows it, the road and the yearly return are
 * counted with it, and it refuses nothing. A deal's verdict never reads it.
 *
 * Where a lender's own term on it is confirmed, the lender's months stand in place of the market's.
 * The wait is counted from the day the defaults are paid, so it runs beside the clearances and the
 * record's update, and the stage after them starts when both are done.
 *
 * Everything in this module is pure: no database, no clock, no text in any language.
 */

/** Months a lender holds a client after their default is paid, where no lender's own term says otherwise. */
export const MARKET_WAIT_MONTHS = { from: 6, to: 12 } as const;

/** A shortest and a longest. */
export interface Span {
  from: number;
  to: number;
}

/** What one lender of the deal says about a client whose default was paid. */
export interface LenderHold {
  lender: string;
  /** Months the lender waits. Null: nobody recorded it. */
  months: number | null;
  /** The lender's term on it has a source and a date that hold today. */
  confirmed: boolean;
}

/** The part of a catalogue product that says how long its lender holds such a client. */
export interface HoldTerm {
  lenderName: string;
  financeType: string;
  settledDefaultWaitMonths?: number | null;
  terms?: { settled?: { state: string } };
}

/** The months a deal waits, and whose word they are. */
export interface WaitMonths {
  /** Months from the day the defaults are paid until every lender of the deal takes the client. */
  months: Span;
  /** `lender` when every lender of the deal confirmed its own months, `market` when the market's practice stands in for one. */
  basis: "lender" | "market";
  /** The lenders whose confirmed months are the ones counted. Empty on the market's practice. */
  lenders: string[];
}

export interface DealWait extends WaitMonths {
  /** The whole road in days with the wait in it. */
  days: Span;
  /** The yearly return on that road, percent with one decimal: `low` on the longest wait. Null when the deal puts no capital in. */
  annualized: { low: number; high: number } | null;
  /** What the office pays for defaults and court orders. It is out from the settlement to the end of the wait. */
  exposed: number;
}

/** The hold as a deal's timeline counts it. */
export interface Hold {
  /** Days a lender holds the client after the defaults are paid. */
  days: number;
  /** The day they were paid. Null while the settlement is ahead, or when nobody recorded the day. */
  paidAt: Date | null;
}

type Light = Pick<DealItem, "kind" | "by">;
const isOrder = (item: Light) => item.kind === "execution" || item.kind === "default";

/** The deal pays a default or a court order: afterwards its client is one a lender holds. */
export function paysDefault(x: { items: readonly Light[]; structure?: Structure | null }): boolean {
  return splitItems(x).active.some(isOrder);
}

export const monthsToDays = (months: number): number => Math.round((months * 365) / 12);

/** The stages the wait runs beside: it is counted from the payment, while the clearances come and the record updates. */
const BESIDE_WAIT: readonly Stage[] = ["clearance", "simah_update"];

/** The stage that cannot start before the wait ends: the one after the record's update. */
export function holdingStage(structure?: Structure | null): Stage | null {
  const plan = stagesFor(structure);
  const at = plan.findIndex((step) => step.stage === "simah_update");
  return at >= 0 ? (plan[at + 1]?.stage ?? null) : null;
}

/**
 * The wait is still on the deal's road: the deal stands at the stage that waits for it, or before it.
 * A deal the office took on to the stages after it went on without waiting, and its road is counted as it goes.
 */
export function waitAhead(structure: Structure | null | undefined, stage: Stage): boolean {
  const plan = stagesFor(structure).map((step) => step.stage);
  const holding = holdingStage(structure);
  const at = plan.indexOf(stage);
  return stage !== "lost" && holding != null && at >= 0 && at <= plan.indexOf(holding);
}

/** The wait as a deal's road counts it: the wait while it is ahead, and none once the deal went past it. */
export function waitOnRoad<T extends object>(wait: T | null | undefined, deal: { structure?: Structure | null; stage: Stage }): T | null {
  return wait && waitAhead(deal.structure, deal.stage) ? wait : null;
}

/** Days the whole road takes when a lender holds the client `waitDays` after the defaults are paid. */
export function roadDays(structure: Structure | null | undefined, waitDays: number): number {
  let days = 0;
  let beside = 0;
  for (const step of stagesFor(structure)) {
    if (BESIDE_WAIT.includes(step.stage)) beside += step.days;
    else days += step.days;
  }
  return days + Math.max(beside, waitDays);
}

const sure = (hold: LenderHold): hold is LenderHold & { months: number } => hold.months != null && hold.confirmed;

function spanOf(hold: LenderHold): Span {
  if (sure(hold)) return { from: hold.months, to: hold.months };
  // A figure nobody confirmed never shortens the wait: the market's practice stands. A longer one is a warning, and lengthens it.
  const market = MARKET_WAIT_MONTHS;
  return { from: market.from, to: Math.max(market.to, hold.months ?? 0) };
}

/**
 * The lenders of a deal, each with what its catalogue product says. A part whose lender is not in the
 * catalogue, or was never named, is a lender nobody asked.
 */
export function holdsOf(input: { structure?: Structure | null; targetBank: string | null; personalLender?: string | null }, products: readonly HoldTerm[]): LenderHold[] {
  const parts = STRUCTURES[structureOf(input)];
  const named: { type: "mortgage" | "personal"; name: string | null }[] = [];
  if (parts.mortgage) named.push({ type: "mortgage", name: input.targetBank });
  if (parts.personal) named.push({ type: "personal", name: input.personalLender ?? (parts.mortgage ? null : input.targetBank) });
  return named.flatMap(({ type, name }): LenderHold[] => {
    const found = name ? products.filter((product) => product.financeType === type && product.lenderName === name) : [];
    if (!found.length) return [{ lender: name ?? "", months: null, confirmed: false }];
    return found.map((product) => ({
      lender: product.lenderName,
      months: product.settledDefaultWaitMonths ?? null,
      confirmed: product.terms?.settled?.state === "confirmed",
    }));
  });
}

/**
 * How long the deal waits after it pays a default or a court order. Null for a deal that pays none.
 * Every lender of the deal has to take the client, so the longest wait among them is the one counted.
 */
export function waitMonths(x: { items: readonly Light[]; structure?: Structure | null }, holds: readonly LenderHold[] = []): WaitMonths | null {
  if (!paysDefault(x)) return null;
  const spans = holds.map(spanOf);
  const months = spans.length ? { from: Math.max(...spans.map((s) => s.from)), to: Math.max(...spans.map((s) => s.to)) } : { ...MARKET_WAIT_MONTHS };
  const basis = holds.length > 0 && holds.every(sure) ? "lender" : "market";
  const lenders = basis === "lender" ? [...new Set(holds.filter((hold) => hold.months === months.to).map((hold) => hold.lender))] : [];
  return { months, basis, lenders };
}

/** The wait of a deal and what it does to the road and the yearly return. The deal's figures and verdict stay as they are. */
export function dealWait(
  input: { items: readonly DealItem[]; structure?: Structure | null },
  study: Pick<DealStudy, "roi" | "structure">,
  holds: readonly LenderHold[] = [],
): DealWait | null {
  const wait = waitMonths(input, holds);
  if (!wait) return null;
  const days = { from: roadDays(study.structure, monthsToDays(wait.months.from)), to: roadDays(study.structure, monthsToDays(wait.months.to)) };
  // The same count the study makes of its own days, on the longer road.
  const yearly = (road: number) => Math.round((((study.roi ?? 0) * 365) / road) * 10) / 10;
  const paid = splitItems(input).active.filter((item) => isOrder(item) && item.by === "company");
  return {
    ...wait,
    days,
    annualized: study.roi != null ? { low: yearly(days.to), high: yearly(days.from) } : null,
    exposed: round0(sum(paid, (item) => item.pay || 0)),
  };
}

const ORDER: readonly Stage[] = STAGES.map(([stage]) => stage);
const PAID_FROM = ORDER.indexOf("settlement") + 1;

/** The day a deal's defaults were paid: the day it first went past the settlement. Null while that is ahead. `history` is oldest first. */
export function paidAtOf(history: readonly { stage: Stage; at: Date }[]): Date | null {
  return history.find((event) => event.stage !== "lost" && ORDER.indexOf(event.stage) >= PAID_FROM)?.at ?? null;
}

const DAY = 24 * 60 * 60 * 1000;

/** The days the wait ends, on its shortest and on its longest. Null until the defaults are paid, and for a deal that waits for nothing. */
export function waitEnds(wait: WaitMonths | null, paidAt: Date | null): { from: Date; to: Date } | null {
  if (!wait || !paidAt || wait.months.to === 0) return null;
  const end = (months: number) => new Date(paidAt.getTime() + monthsToDays(months) * DAY);
  return { from: end(wait.months.from), to: end(wait.months.to) };
}

/** The hold a deal's timeline counts: the shortest wait, from the day the defaults were paid. Null when the deal waits for nothing. */
export function holdOf(wait: WaitMonths | null, paidAt: Date | null): Hold | null {
  return wait && wait.months.from > 0 ? { days: monthsToDays(wait.months.from), paidAt } : null;
}
