import { stagesFor } from "./structure";
import type { Stage, Structure } from "./types";
import { holdingStage, type Hold } from "./wait";

const DAY = 24 * 60 * 60 * 1000;

export type StepState = "done" | "current" | "ahead";

export interface TimelineStep {
  stage: Stage;
  state: StepState;
  /** Expected start of the stage. Null for stages already passed. */
  expectedAt: Date | null;
}

export interface Timeline {
  steps: TimelineStep[];
  /** Position of the current stage, from 1. Zero when the deal is lost. */
  position: number;
  total: number;
  /** Days until the financing is disbursed and the capital starts coming back. Null once that has happened. */
  daysToDisbursement: number | null;
  /** Days left of the current stage's planned duration. Negative when the stage is late. Null when the deal ended. */
  stageDueInDays: number | null;
  /** The current stage stands still: it cannot start before the wait after the paid defaults ends, and that wait is still running. */
  held: boolean;
}

/**
 * Where a deal stands and when the stages ahead are expected, from the planned duration of each stage.
 * `enteredAt` is when the deal entered its current stage.
 *
 * `hold` is the wait a lender sets after the deal's defaults are paid. The stage after the record's
 * update cannot start before it ends, so that stage and every one after it move with it. A deal already
 * past that stage is past the wait.
 */
export function dealTimeline(structure: Structure, stage: Stage, enteredAt: Date, now: Date, hold?: Hold | null): Timeline {
  const plan = stagesFor(structure).filter((s) => s.stage !== "lost");
  const index = plan.findIndex((s) => s.stage === stage);
  const holding = hold ? holdingStage(structure) : null;
  const settlement = plan.findIndex((s) => s.stage === "settlement");
  // The wait runs from the day the defaults were paid. When they were paid and nobody recorded the day, from the current stage.
  let holdUntil: number | null = !hold ? null : hold.paidAt ? hold.paidAt.getTime() + hold.days * DAY : index > settlement ? enteredAt.getTime() + hold.days * DAY : null;
  let cursor = enteredAt.getTime();
  let currentStart = cursor;
  const steps = plan.map((s, i): TimelineStep => {
    if (index < 0 || i < index) return { stage: s.stage, state: index < 0 ? "ahead" : "done", expectedAt: null };
    if (s.stage === holding && holdUntil != null) cursor = Math.max(cursor, holdUntil);
    if (i === index) currentStart = cursor;
    const step: TimelineStep = { stage: s.stage, state: i === index ? "current" : "ahead", expectedAt: new Date(i === index ? enteredAt.getTime() : cursor) };
    cursor += s.days * DAY;
    // A settlement still ahead: the wait starts when it is expected to end.
    if (hold && s.stage === "settlement" && holdUntil == null) holdUntil = cursor + hold.days * DAY;
    return step;
  });
  const recovered = steps.find((s) => s.stage === "recovered");
  const daysToDisbursement =
    recovered?.expectedAt && recovered.state === "ahead"
      ? Math.max(0, Math.ceil((recovered.expectedAt.getTime() - now.getTime()) / DAY))
      : null;
  const current = index >= 0 ? plan[index] : undefined;
  const stageDueInDays =
    current && current.stage !== "closed"
      ? Math.ceil((currentStart + current.days * DAY - now.getTime()) / DAY)
      : null;
  const held = current != null && current.stage === holding && holdUntil != null && holdUntil > now.getTime();
  return { steps, position: index + 1, total: plan.length, daysToDisbursement, stageDueInDays, held };
}
