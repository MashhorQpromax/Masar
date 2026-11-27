import { stagesFor } from "./structure";
import type { Stage, Structure } from "./types";

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
}

/**
 * Where a deal stands and when the stages ahead are expected, from the planned duration of each stage.
 * `enteredAt` is when the deal entered its current stage.
 */
export function dealTimeline(structure: Structure, stage: Stage, enteredAt: Date, now: Date): Timeline {
  const plan = stagesFor(structure).filter((s) => s.stage !== "lost");
  const index = plan.findIndex((s) => s.stage === stage);
  let cursor = enteredAt.getTime();
  const steps = plan.map((s, i): TimelineStep => {
    if (index < 0 || i < index) return { stage: s.stage, state: index < 0 ? "ahead" : "done", expectedAt: null };
    const step: TimelineStep = { stage: s.stage, state: i === index ? "current" : "ahead", expectedAt: new Date(cursor) };
    cursor += s.days * DAY;
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
      ? Math.ceil((enteredAt.getTime() + current.days * DAY - now.getTime()) / DAY)
      : null;
  return { steps, position: index + 1, total: plan.length, daysToDisbursement, stageDueInDays };
}
