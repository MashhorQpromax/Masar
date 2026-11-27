import { requiredDocuments, type Nationality } from "../eligibility";
import type { ProjectFacts } from "../project";
import { isPaperCode, PAPERS, type PaperCode, type PaperNeed } from "./papers";

/** A project's owner has no salary. A lender reads their accounts, as it does for someone who works for themselves. */
const OWNER_SECTOR = "self";

/** Papers only a company has. A person who holds the land in their own name is not asked for them. */
const COMPANY_PAPERS: ReadonlySet<string> = new Set<PaperCode>(["cr", "fin_statements", "zakat", "simah_company"]);

/**
 * The papers a project's file needs: what a lender asks of any project, the company's own papers when
 * a company borrows, and the letters the land itself calls for. While nobody said who borrows, the
 * company's papers are listed as optional. Nothing here depends on a deal: a project has none.
 */
export function projectPapers(facts: Pick<ProjectFacts, "borrowerType" | "existingLien" | "nearHaram">, nationality: Nationality): PaperNeed[] {
  const company = facts.borrowerType === "company";
  const person = facts.borrowerType === "individual";
  const asked = [...requiredDocuments("project", OWNER_SECTOR, nationality), { code: "simah_company", required: true }];
  const needs: PaperNeed[] = [];
  for (const { code, required } of asked) {
    if (!isPaperCode(code)) continue;
    if (COMPANY_PAPERS.has(code)) {
      if (person) continue;
      needs.push({ code, category: PAPERS[code], required: company });
    } else if (code === "lien") needs.push({ code, category: PAPERS[code], required: facts.existingLien });
    else if (code === "zoning") needs.push({ code, category: PAPERS[code], required: facts.nearHaram });
    else needs.push({ code, category: PAPERS[code], required });
  }
  return needs;
}
