/**
 * What a client's papers say, held against what their file says.
 *
 * A paper is kept as a file, and a file is not read by the system. The person who checks a paper
 * writes down the figures it states: the salary on a salary certificate, the year of birth on an
 * identity card. From then on the paper is more than "checked": it stands behind a fact of the file,
 * or against it.
 *
 * Only a checked paper counts. One that waits to be looked at, or was sent back, says nothing. And a
 * checked paper nobody wrote a figure from proves nothing about that figure: the absence of a
 * difference is not agreement.
 *
 * Everything in this module is pure: no database, no clock, no text in any language.
 */
import { PAPER_FACTS, type PaperFact } from "../eligibility";
import { isPaperCode, type PaperCode } from "./papers";

/**
 * The facts each paper states, of the ones the file holds too. A GOSI statement gives the wage the
 * employer registered, which is the basic wage with housing and not the whole salary, so only its
 * basic wage is held against the file.
 */
export const PAPER_STATES: Partial<Record<PaperCode, readonly PaperFact[]>> = {
  id: ["birthYear"],
  salary_cert: ["totalSalary", "basicSalary"],
  payslip: ["totalSalary", "basicSalary"],
  gosi: ["basicSalary"],
  pension: ["totalSalary"],
};

/** The facts a paper states. A paper a person added by name states none the system knows. */
export const statesOf = (code: string): readonly PaperFact[] => (isPaperCode(code) ? (PAPER_STATES[code] ?? []) : []);

/** Two salaries agree when they differ by no more than this share of the larger: a rounding, not a raise. */
export const SALARY_TOLERANCE = 0.01;
/** Two birth years agree within one: a year typed from the Hijri date falls in either of two Gregorian years. */
export const BIRTH_YEAR_TOLERANCE = 1;

/** The bounds of a figure a paper may state. */
export const STATED_LIMITS = { salaryMax: 10_000_000, birthYearMin: 1930, adultAge: 18 } as const;

/** Whether two values of one fact say the same thing. */
export function factsAgree(fact: PaperFact, a: number, b: number): boolean {
  if (fact === "birthYear") return Math.abs(a - b) <= BIRTH_YEAR_TOLERANCE;
  return Math.abs(a - b) <= Math.max(a, b) * SALARY_TOLERANCE;
}

/** What a person wrote down from one paper. */
export type Stated = Partial<Record<PaperFact, number>>;

/**
 * Why figures cannot be written down from a paper:
 * - `NOT_ON_PAPER`: this paper does not state that fact.
 * - `OUT_OF_RANGE`: a salary that is not a positive amount, or a year nobody applying could be born in.
 * - `BASIC_ABOVE_TOTAL`: the basic salary is more than the total one, on the same paper.
 */
export type StatedProblem = "NOT_ON_PAPER" | "OUT_OF_RANGE" | "BASIC_ABOVE_TOTAL";

/** Why these figures cannot be kept for this paper. Null when they can. `year` is the current one. */
export function statedProblem(code: string, stated: Stated, year: number): StatedProblem | null {
  const allowed = statesOf(code);
  for (const fact of PAPER_FACTS) {
    const value = stated[fact];
    if (value == null) continue;
    if (!allowed.includes(fact)) return "NOT_ON_PAPER";
    if (!Number.isFinite(value)) return "OUT_OF_RANGE";
    if (fact === "birthYear") {
      if (!Number.isInteger(value) || value < STATED_LIMITS.birthYearMin || value > year - STATED_LIMITS.adultAge) return "OUT_OF_RANGE";
    } else if (value <= 0 || value > STATED_LIMITS.salaryMax) return "OUT_OF_RANGE";
  }
  if (stated.basicSalary != null && stated.totalSalary != null && stated.basicSalary > stated.totalSalary) return "BASIC_ABOVE_TOTAL";
  return null;
}

/** The figures of a stored value that this paper may state, and nothing else of it. */
export function statedOf(code: string, value: unknown): Stated {
  const stated: Stated = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return stated;
  for (const fact of statesOf(code)) {
    const figure = (value as Record<string, unknown>)[fact];
    if (typeof figure === "number" && Number.isFinite(figure) && figure > 0) stated[fact] = figure;
  }
  return stated;
}

/** A checked paper with what was written down from it. */
export interface StatedPaper {
  id: number;
  code: string;
  /** The name a person gave a paper they added. Null for a paper known by its code. */
  label: string | null;
  stated: Stated;
}

/** What one checked paper says about one fact. */
export interface Statement {
  paperId: number;
  code: string;
  label: string | null;
  value: number;
}

/**
 * - `unstated`: no checked paper states it. Nothing stands behind the file's value, and nothing against it.
 * - `agrees`: every checked paper that states it says what the file says.
 * - `conflict`: the file and a paper differ, or two papers do.
 */
export type FactState = "unstated" | "agrees" | "conflict";

/** One fact of the file, with what the checked papers say about it. */
export interface FactReading {
  fact: PaperFact;
  /** What the file holds. Null when it holds nothing. */
  file: number | null;
  /** What each checked paper says, in the order the papers are kept. */
  stated: Statement[];
  state: FactState;
  /** The papers that state it say the same thing, so in a conflict the file is the one that differs. */
  papersAgree: boolean;
}

/** Every fact of the file held against the client's checked papers. Pass only papers a person verified. */
export function readFacts(file: Readonly<Record<PaperFact, number | null>>, papers: readonly StatedPaper[]): FactReading[] {
  return PAPER_FACTS.map((fact) => {
    const held = (file[fact] ?? 0) > 0 ? file[fact]! : null;
    const stated: Statement[] = papers.flatMap((paper) => {
      const value = statedOf(paper.code, paper.stated)[fact];
      return value != null ? [{ paperId: paper.id, code: paper.code, label: paper.label, value }] : [];
    });
    const papersAgree = stated.every((a, index) => stated.slice(index + 1).every((b) => factsAgree(fact, a.value, b.value)));
    const fileAgrees = held != null && stated.every((s) => factsAgree(fact, held, s.value));
    const state: FactState = !stated.length ? "unstated" : papersAgree && fileAgrees ? "agrees" : "conflict";
    return { fact, file: held, stated, state, papersAgree };
  });
}

/** The facts in dispute, in the order the facts are named. */
export const disputedFacts = (readings: readonly FactReading[]): PaperFact[] => readings.filter((reading) => reading.state === "conflict").map((reading) => reading.fact);

/**
 * Why the file cannot take what a paper says about a fact:
 * - `NOT_STATED`: that paper is not checked, or states nothing about it.
 * - `NO_CONFLICT`: the file already says what the papers say.
 * - `PAPERS_DISAGREE`: another checked paper says something else, so taking one would settle nothing.
 *   The paper that is wrong or out of date goes back first, or what was written from it is corrected.
 */
export type RelyProblem = "NOT_STATED" | "NO_CONFLICT" | "PAPERS_DISAGREE";

/** Whether the file can take what one paper says about one fact. Null when it can. */
export function relyProblem(reading: FactReading, paperId: number): RelyProblem | null {
  if (!reading.stated.some((statement) => statement.paperId === paperId)) return "NOT_STATED";
  if (reading.state !== "conflict") return "NO_CONFLICT";
  return reading.papersAgree ? null : "PAPERS_DISAGREE";
}

/**
 * The salary an income is counted from, as the eligibility engine counts it: the total one, or the
 * basic one when the file holds no total. The income is proven when a checked paper states that
 * very figure and agrees with the file.
 */
export function incomeProven(readings: readonly FactReading[]): boolean {
  const of = (fact: PaperFact) => readings.find((reading) => reading.fact === fact);
  const counted = of("totalSalary")?.file != null ? of("totalSalary") : of("basicSalary");
  return counted?.state === "agrees";
}
