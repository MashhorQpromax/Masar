import { splitItems, splitLabel, structureOf, type DealInput, type DealStudy, type LenderKind, type Stage, type Structure } from "../deal";

/**
 * What a client may be told about their deal, and nothing else. The company's fee, its capital and
 * its return are not here on purpose: a message or a page built from these facts cannot leak them.
 */
export interface ClientFacts {
  stage: Stage;
  structure: Structure;
  /** Enforcement orders, defaults and other dues the deal pays for the client. */
  settles: number;
  /** Financing the deal pays off: the mortgage, a personal loan, a card. */
  payoff: number;
  /** Who holds that financing, each named once. */
  payoffAt: string[];
  /** The new financing, one entry per part the deal has. */
  financing: { part: "mortgage" | "personal"; amount: number; lender: string | null; lenderKind: LenderKind | null }[];
  /** True when the amounts are what a lender actually offered. */
  offered: boolean;
  /** Cash the client keeps at the end. Zero when nothing is left over. */
  keeps: number;
  /** How long the whole road takes, as a range of weeks. */
  weeks: { from: number; to: number };
}

const PAYOFF_KINDS: ReadonlySet<string> = new Set(["mortgage_payoff", "personal_payoff", "card"]);

/** The client's side of a deal, taken from its study. */
export function clientFacts(deal: { stage: Stage; input: Pick<DealInput, "items" | "structure">; study: DealStudy }): ClientFacts {
  const structure = structureOf(deal.input);
  const { active } = splitItems({ items: deal.input.items, structure });
  const paidOff = active.filter((item) => PAYOFF_KINDS.has(item.kind));
  const settled = active.filter((item) => !PAYOFF_KINDS.has(item.kind));
  const sum = (items: typeof active) => items.reduce((total, item) => total + item.pay, 0);
  const holders = paidOff.map((item) => splitLabel(item.label).party).filter((party): party is string => !!party);
  const weeks = Math.round(deal.study.days / 7);
  return {
    stage: deal.stage,
    structure,
    settles: sum(settled),
    payoff: sum(paidOff),
    payoffAt: [...new Set(holders)],
    financing: deal.study.summary.financing
      .filter((part) => part.amount > 0)
      .map((part) => ({ part: part.kind, amount: part.amount, lender: part.lender, lenderKind: part.lenderKind })),
    offered: deal.study.financing.source === "bank",
    keeps: Math.max(0, deal.study.clientNet),
    weeks: { from: Math.max(4, weeks - 2), to: Math.max(6, weeks + 2) },
  };
}
