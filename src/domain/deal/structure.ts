import type { DealInput, DealItem, Stage, Structure } from "./types";

/** What each deal structure includes. */
export const STRUCTURES: Record<Structure, { mortgage: boolean; personal: boolean }> = {
  /** Settle, refinance the property, and add personal finance. */
  settle_refi_personal: { mortgage: true, personal: true },
  /** Settle the defaults and recover from personal finance only. The property stays as it is. */
  settle_personal: { mortgage: false, personal: true },
  /** Settle and refinance the property only. Existing personal finance stays. */
  settle_refi: { mortgage: true, personal: false },
};

export const STRUCTURE_KEYS = Object.keys(STRUCTURES) as Structure[];

export const DEFAULT_STRUCTURE: Structure = "settle_refi_personal";

export function structureOf(x: { structure?: Structure | null }): Structure {
  const key = x.structure ?? DEFAULT_STRUCTURE;
  return STRUCTURES[key] ? key : DEFAULT_STRUCTURE;
}

/** Items that are settled inside the structure, and items that stay with their installments. */
export function splitItems(x: Pick<DealInput, "items" | "structure">): { active: DealItem[]; kept: DealItem[] } {
  const st = STRUCTURES[structureOf(x)];
  const inDeal = (i: DealItem) =>
    i.by !== "out" && (st.mortgage || i.kind !== "mortgage_payoff") && (st.personal || i.by !== "bank");
  return { active: x.items.filter(inDeal), kept: x.items.filter((i) => !inDeal(i)) };
}

/** Every stage in order, with its expected duration in days. */
export const STAGES: readonly (readonly [Stage, number])[] = [
  ["study", 2],
  ["agreement", 2],
  ["settlement", 3],
  ["clearance", 5],
  ["simah_update", 10],
  ["payoff", 10],
  ["transfer", 3],
  ["bank_submit", 3],
  ["approval", 14],
  ["disbursement", 7],
  ["recovered", 3],
  ["closed", 0],
  ["lost", 0],
];

/** Stages that apply to a structure. Without a property there is no payoff and no transfer. */
export function stagesFor(structure?: Structure | null): { stage: Stage; days: number }[] {
  const { mortgage } = STRUCTURES[structureOf({ structure })];
  return STAGES.filter(([stage]) => mortgage || (stage !== "payoff" && stage !== "transfer")).map(([stage, days]) => ({
    stage,
    days,
  }));
}

/** Stages during which the company's capital is out. */
export const CAPITAL_OUT_STAGES: readonly Stage[] = [
  "settlement",
  "clearance",
  "simah_update",
  "payoff",
  "transfer",
  "bank_submit",
  "approval",
  "disbursement",
];
