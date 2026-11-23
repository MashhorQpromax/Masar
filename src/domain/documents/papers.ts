import { splitItems, STAGES, STRUCTURES, structureOf, type DealItem, type Stage, type Structure } from "../deal";
import { requiredDocuments, type DocumentCategory, type Nationality } from "../eligibility";
import type { Sector } from "../shared/sector";

/** Where a paper is filed. The lender's groups, the papers the deal itself produces, and what a person added. */
export type PaperCategory = DocumentCategory | "deal" | "extra";

export const PAPER_CATEGORIES: readonly PaperCategory[] = ["identity", "obligations", "income", "collateral", "business", "deal", "extra"];

/** Every paper known by a code, with the group it is filed under. */
export const PAPERS = {
  id: "identity",
  address: "identity",
  family: "identity",
  license: "identity",
  simah: "obligations",
  obligations: "obligations",
  salary_cert: "income",
  payslip: "income",
  gosi: "income",
  pension: "income",
  bank_3: "income",
  bank_12: "income",
  sakani: "income",
  deed: "collateral",
  valuation: "collateral",
  quote: "collateral",
  permit: "collateral",
  lien: "collateral",
  zoning: "collateral",
  cr: "business",
  fin_statements: "business",
  zakat: "business",
  feasibility: "business",
  boq: "business",
  sources_uses: "business",
  agreement: "deal",
  clearance: "deal",
  payoff_letter: "deal",
  transfer_deed: "deal",
} as const satisfies Record<string, PaperCategory>;

export type PaperCode = keyof typeof PAPERS;

export const PAPER_CODES = Object.keys(PAPERS) as PaperCode[];

export const isPaperCode = (code: string): code is PaperCode => Object.hasOwn(PAPERS, code);

/** A paper a person added by name carries a code of its own that starts with this. */
export const CUSTOM_PREFIX = "custom:";

export const isCustomCode = (code: string): boolean => code.startsWith(CUSTOM_PREFIX) && code.length > CUSTOM_PREFIX.length;

/**
 * Who brings a paper. The client brings what is theirs. The office brings what the deal itself
 * produces, and the valuation it orders: nobody asks the client for those.
 */
export type PaperSource = "client" | "office";

const OFFICE_PAPERS: ReadonlySet<string> = new Set<PaperCode>(["valuation", "agreement", "clearance", "payoff_letter", "transfer_deed"]);

export const paperSource = (code: string): PaperSource => (OFFICE_PAPERS.has(code) ? "office" : "client");

/** The SIMAH report is the one paper that is read, not only kept. It enters through the credit record. */
export const SIMAH_PAPER: PaperCode = "simah";

export interface PaperNeed {
  code: PaperCode;
  category: PaperCategory;
  required: boolean;
}

/** What the papers of a deal depend on: its shape, where it stands on the road, and what it settles. */
export interface DealOnTheRoad {
  structure?: Structure | null;
  stage: Stage;
  /** Every stage the deal entered, oldest first. It tells how far a cancelled deal got. */
  history: readonly Stage[];
  items: readonly DealItem[];
}

const ORDER = STAGES.map(([stage]) => stage);
const ENDED: readonly Stage[] = ["closed", "lost"];
const at = (stage: Stage): number => ORDER.indexOf(stage);

/** True once the deal is in a stage or past it. A closed deal passed them all; a cancelled one got as far as its history says. */
export function hasReached(deal: Pick<DealOnTheRoad, "stage" | "history">, target: Stage): boolean {
  if (deal.stage === "closed") return true;
  if (deal.stage === "lost") return deal.history.some((stage) => !ENDED.includes(stage) && at(stage) >= at(target));
  return at(deal.stage) >= at(target);
}

/**
 * The papers a deal's file needs today.
 *
 * It starts from what a lender asks for the financing the deal ends in: the mortgage, the personal
 * finance, or both. Then come the papers the deal itself produces, each one asked for once the deal
 * reaches the stage that produces it: the signed agreement, the clearance letters for what the company
 * paid, the mortgage payoff letter, and the deed after the property moves to the company's side.
 */
export function dealPapers(deal: DealOnTheRoad, who: { sector: Sector; nationality: Nationality }): PaperNeed[] {
  const structure = structureOf(deal);
  const shape = STRUCTURES[structure];
  const needs = new Map<PaperCode, PaperNeed>();
  const ask = (code: string, required: boolean) => {
    if (!isPaperCode(code)) return;
    const known = needs.get(code);
    if (known) known.required ||= required;
    else needs.set(code, { code, category: PAPERS[code], required });
  };

  for (const financeType of ["mortgage", "personal"] as const) {
    if (!shape[financeType]) continue;
    for (const need of requiredDocuments(financeType, who.sector, who.nationality)) ask(need.code, need.required);
  }

  const { active } = splitItems({ items: [...deal.items], structure });
  // A liability letter is how each amount the deal pays is confirmed.
  if (active.length > 0) ask("obligations", true);

  if (hasReached(deal, "agreement")) ask("agreement", true);
  if (active.some((item) => item.by === "company" && item.kind !== "mortgage_payoff") && hasReached(deal, "clearance")) ask("clearance", true);
  if (shape.mortgage && active.some((item) => item.kind === "mortgage_payoff") && hasReached(deal, "payoff")) ask("payoff_letter", true);
  if (shape.mortgage && hasReached(deal, "transfer")) ask("transfer_deed", true);

  return [...needs.values()];
}
