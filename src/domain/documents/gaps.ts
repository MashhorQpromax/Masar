/**
 * How a project's papers answer the gaps of its study. Kept apart from the list of papers itself so
 * the form that studies a project as it is typed can read it without the lenders' rules.
 */
import type { GapCode, ProjectFacts } from "../project";
import type { PaperStatus } from "./checklist";
import type { PaperCode } from "./papers";

/**
 * The papers that answer a gap of a project's study. A gap with none is a fact somebody writes down,
 * or a paper the file has no place for yet.
 */
export function gapPapers(code: GapCode, facts: Pick<ProjectFacts, "borrowerType">): readonly PaperCode[] {
  const company = facts.borrowerType === "company";
  switch (code) {
    case "DEED_COPY":
      return ["deed"];
    case "FEASIBILITY":
      return ["feasibility"];
    case "PERMIT":
      return ["permit"];
    case "VALUATION_REPORT":
      return ["valuation"];
    case "STATEMENTS":
      return company ? ["bank_12", "fin_statements"] : ["bank_12"];
    case "CREDIT_REPORT":
      return company ? ["simah", "simah_company"] : ["simah"];
    case "USE_OF_FUNDS":
      return ["sources_uses"];
    case "NO_EXPROPRIATION":
      return ["zoning"];
    default:
      return [];
  }
}

const PAPER_GAPS: readonly GapCode[] = ["DEED_COPY", "FEASIBILITY", "PERMIT", "VALUATION_REPORT", "STATEMENTS", "CREDIT_REPORT", "USE_OF_FUNDS", "NO_EXPROPRIATION"];

/**
 * The gaps a project's file answers with its papers: every paper the gap names was checked by a
 * person and stands as good. A paper that only arrived, or was sent back, answers nothing.
 */
export function heldGaps(facts: Pick<ProjectFacts, "borrowerType">, papers: readonly { code: string; status: PaperStatus }[]): Set<GapCode> {
  const good = new Set(papers.filter((paper) => paper.status === "verified").map((paper) => paper.code));
  return new Set(PAPER_GAPS.filter((gap) => gapPapers(gap, facts).every((code) => good.has(code))));
}

/** Where the papers of a gap stand together: all good, some arrived and wait, or still owed. Null when the gap names no paper. */
export function gapStanding(
  code: GapCode,
  facts: Pick<ProjectFacts, "borrowerType">,
  papers: readonly { code: string; status: PaperStatus }[],
): "verified" | "received" | "rejected" | "missing" | null {
  const codes = gapPapers(code, facts);
  if (!codes.length) return null;
  const states = codes.map((paper) => papers.find((kept) => kept.code === paper)?.status ?? "missing");
  if (states.every((state) => state === "verified")) return "verified";
  if (states.includes("rejected")) return "rejected";
  if (states.some((state) => state === "received" || state === "verified")) return "received";
  return "missing";
}
