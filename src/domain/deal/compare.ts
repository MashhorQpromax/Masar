/**
 * Two scenarios of one deal side by side: the deal as it stands, and the same deal with a few of its
 * levers moved (the structure, the fee, a discount on what is settled, a lender's offer, the valuation).
 * Both are read on the same rows, and each row says by how many riyals the second differs.
 *
 * A scenario is a what-if: it changes nothing of the deal and is never offered to the client.
 *
 * Everything in this module is pure: no database, no clock, no text in any language.
 */
import { withDiscount } from "./alternatives";
import { normalizeFee } from "./fee";
import { clientNet } from "./net";
import { structureOf } from "./structure";
import type { DealInput, DealStudy, FinanceBase, Structure, Verdict } from "./types";

/** What may be moved in a scenario. Anything left out stays as the deal has it. */
export interface Levers {
  structure?: Structure;
  settlePct?: number;
  financePct?: number;
  financeBase?: FinanceBase;
  /** Percent off the court orders and defaults the company settles. */
  discountPct?: number;
  /** A lender's offer to try. */
  bankMortgage?: number;
  bankPersonal?: number;
  propertyValue?: number;
}

/** The levers a scenario may move, in the order they are asked. */
export const LEVERS = ["structure", "settlePct", "financePct", "financeBase", "discountPct", "bankMortgage", "bankPersonal", "propertyValue"] as const;
export type Lever = (typeof LEVERS)[number];

/** The deal with the levers moved. */
export function scenarioInput(input: DealInput, levers: Levers): DealInput {
  const fee = normalizeFee(input.fee);
  return {
    ...input,
    structure: levers.structure ?? structureOf(input),
    fee: {
      ...fee,
      settlePct: levers.settlePct ?? fee.settlePct,
      financePct: levers.financePct ?? fee.financePct,
      financeBase: levers.financeBase ?? fee.financeBase,
    },
    items: levers.discountPct ? withDiscount(input, levers.discountPct / 100) : input.items,
    bankMortgage: levers.bankMortgage ?? input.bankMortgage,
    bankPersonal: levers.bankPersonal ?? input.bankPersonal,
    propertyValue: levers.propertyValue ?? input.propertyValue,
  };
}

/** The levers that move something: a lever set to what the deal already has is no change. */
export function movedLevers(input: DealInput, levers: Levers): Lever[] {
  const fee = normalizeFee(input.fee);
  const now: Record<Lever, unknown> = {
    structure: structureOf(input),
    settlePct: fee.settlePct,
    financePct: fee.financePct,
    financeBase: fee.financeBase,
    discountPct: 0,
    bankMortgage: input.bankMortgage,
    bankPersonal: input.bankPersonal,
    propertyValue: input.propertyValue,
  };
  return LEVERS.filter((lever) => levers[lever] != null && levers[lever] !== now[lever]);
}

/** The rows both scenarios are read on: the client's side first, then the office's. */
export const COMPARE_ROWS = ["mortgage", "personal", "obligations", "costs", "fee", "clientNet", "capital"] as const;
export type CompareRow = (typeof COMPARE_ROWS)[number];

export interface ScenarioFigures {
  verdict: Verdict;
  figures: Record<CompareRow, number>;
}

/** A scenario's figures, from the same lines the client's net is read on. */
export function scenarioFigures(input: DealInput, study: DealStudy): ScenarioFigures {
  const net = clientNet(input, study);
  const line = (part: "mortgage" | "personal" | "obligations" | "costs" | "fee") => net.lines.find((l) => l.part === part)?.amount ?? 0;
  return {
    verdict: study.verdict,
    figures: {
      mortgage: line("mortgage"),
      personal: line("personal"),
      obligations: line("obligations"),
      costs: line("costs"),
      fee: line("fee"),
      clientNet: net.net,
      capital: study.capital,
    },
  };
}

export interface ComparedRow {
  row: CompareRow;
  a: number;
  b: number;
  /** The second less the first, in riyals. */
  diff: number;
}

/** Both scenarios on the same rows, each with the difference. A row that is nothing in both is left out. */
export function compareScenarios(a: ScenarioFigures, b: ScenarioFigures): ComparedRow[] {
  return COMPARE_ROWS.flatMap((row) => {
    const [x, y] = [a.figures[row], b.figures[row]];
    return x === 0 && y === 0 ? [] : [{ row, a: x, b: y, diff: y - x }];
  });
}
