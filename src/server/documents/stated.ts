import "server-only";
import { statedProblem, type Stated } from "@/domain/documents";
import { riyadhDay } from "../shared/clock";
import { DomainError } from "../shared/errors";

/** The year a figure is checked in: nobody applying was born less than eighteen years before it. */
const yearOf = (now: Date): number => Number(riyadhDay(now).slice(0, 4));

/** The figures as they are kept for a paper, or the refusal that says what is wrong with them. */
export function statedFor(code: string, stated: Stated | undefined, now: Date): Stated {
  const given = Object.fromEntries(Object.entries(stated ?? {}).filter(([, value]) => value != null)) as Stated;
  const problem = statedProblem(code, given, yearOf(now));
  if (problem) throw new DomainError("FIGURE_REFUSED", `paper ${code}: ${problem}`, { problem });
  return given;
}
