import { STRUCTURES, structureOf } from "./structure";
import type { Timeline } from "./timeline";
import type { Stage, Structure } from "./types";

/**
 * The road a deal travels has six stations. Each station groups the detailed stages that belong
 * together, so a person sees where a deal stands at a glance and the stages stay for the detail.
 */
export type StationKey = "study" | "settle" | "credit" | "property" | "bank" | "payout";

export const STATIONS: readonly { key: StationKey; stages: readonly Stage[] }[] = [
  { key: "study", stages: ["study", "agreement"] },
  { key: "settle", stages: ["settlement", "clearance"] },
  { key: "credit", stages: ["simah_update"] },
  { key: "property", stages: ["payoff", "transfer"] },
  { key: "bank", stages: ["bank_submit", "approval"] },
  { key: "payout", stages: ["disbursement", "recovered"] },
];

/** The station a stage belongs to. Null for deals that ended (closed or lost). */
export function stationOf(stage: Stage): StationKey | null {
  return STATIONS.find((s) => s.stages.includes(stage))?.key ?? null;
}

/** Stations a structure passes through. Without a property the deal skips the property station. */
export function stationsFor(structure?: Structure | null): StationKey[] {
  const { mortgage } = STRUCTURES[structureOf({ structure })];
  return STATIONS.filter((s) => mortgage || s.key !== "property").map((s) => s.key);
}

export type StationState = "done" | "current" | "ahead";

export interface StationStep {
  key: StationKey;
  state: StationState;
  /** When the deal reached the station, or when it is expected to. Null when unknown. */
  at: Date | null;
  /** True when `at` is a forecast. */
  expected: boolean;
}

export interface StationTimeline {
  steps: StationStep[];
  /** Position of the current station, from 1. Zero when the deal ended. */
  position: number;
  total: number;
}

/**
 * The stage timeline folded into stations. `history` is every stage the deal entered and when,
 * oldest first; the dates of stations already passed come from it.
 */
export function stationTimeline(
  structure: Structure,
  timeline: Timeline,
  history: readonly { stage: Stage; at: Date }[],
): StationTimeline {
  const firstEntered = new Map<Stage, Date>();
  for (const event of history) if (!firstEntered.has(event.stage)) firstEntered.set(event.stage, event.at);

  const keys = stationsFor(structure);
  const steps = keys.map((key): StationStep => {
    const stages = STATIONS.find((s) => s.key === key)!.stages;
    const mine = timeline.steps.filter((s) => stages.includes(s.stage));
    const state: StationState = mine.some((s) => s.state === "current")
      ? "current"
      : mine.length > 0 && mine.every((s) => s.state === "done")
        ? "done"
        : "ahead";
    if (state === "ahead") {
      return { key, state, at: mine.find((s) => s.expectedAt)?.expectedAt ?? null, expected: true };
    }
    const entered = stages.map((s) => firstEntered.get(s)).filter((d): d is Date => !!d);
    const at = entered.length ? new Date(Math.min(...entered.map((d) => d.getTime()))) : null;
    return { key, state, at, expected: false };
  });
  return { steps, position: steps.findIndex((s) => s.state === "current") + 1, total: steps.length };
}
