import { stationOf, type Stage, type StationKey } from "../deal";

/**
 * Where a client's file stands, as a list of people shows it:
 * - `open`: a deal is in progress, at this station of its road.
 * - `done`: the last deal was completed.
 * - `rejected`: the last deal did not close and the file was rejected.
 * - `none`: a file with no deal yet.
 */
export type FileState = { kind: "open"; stage: Stage; station: StationKey } | { kind: "done" } | { kind: "rejected" } | { kind: "none" };

/** The state of a file from the stage of its newest deal. */
export function fileState(stage: Stage | null): FileState {
  if (stage == null) return { kind: "none" };
  if (stage === "closed") return { kind: "done" };
  if (stage === "lost") return { kind: "rejected" };
  const station = stationOf(stage);
  return station ? { kind: "open", stage, station } : { kind: "none" };
}
