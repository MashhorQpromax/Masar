import { clientNet, splitItems, splitLabel, structureOf, waitOnRoad, type Certainty, type DealInput, type DealStudy, type DealWait, type LenderKind, type Stage, type Structure } from "../deal";

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
  /**
   * The new financing, one entry per part the deal has. A part is confirmed when the lender's written
   * offer gives it, and an estimate when it is counted from the salary and the rules.
   */
  financing: { part: "mortgage" | "personal"; amount: number; lender: string | null; lenderKind: LenderKind | null; certainty: Certainty }[];
  /** True when a lender actually offered at least one part. */
  offered: boolean;
  /** Cash the client keeps at the end. Zero when nothing is left over. */
  keeps: number;
  /** Confirmed only when every figure behind it stands on a written word: an offer and the creditors' letters, nothing counted. */
  keepsCertainty: Certainty;
  /** How long the whole road takes, as a range of weeks. */
  weeks: { from: number; to: number };
  /**
   * The whole road in months, when the wait a lender sets after the defaults are paid is part of it.
   * Then the months say how long, not the weeks. Null for a deal that waits for nothing.
   */
  months: { from: number; to: number } | null;
}

/** Days of a road as months a client can be told: rounded up, so that the road is never promised shorter than it is. */
const monthsOf = (days: number): number => Math.max(1, Math.ceil((days * 12) / 365));

const PAYOFF_KINDS: ReadonlySet<string> = new Set(["mortgage_payoff", "personal_payoff", "card"]);

/**
 * The client's side of a deal, taken from its study. `wait` is what its lenders set after a paid
 * default, when the deal pays one: only its months and the road with them are handed in, never the
 * return or the money the office has out.
 */
export function clientFacts(deal: { stage: Stage; input: DealInput; study: DealStudy; wait?: Pick<DealWait, "months" | "days"> | null }): ClientFacts {
  const structure = structureOf(deal.input);
  // A deal that went on past the stage that waits is told its road as it goes.
  const wait = waitOnRoad(deal.wait, { structure, stage: deal.stage });
  const { active } = splitItems({ items: deal.input.items, structure });
  const paidOff = active.filter((item) => PAYOFF_KINDS.has(item.kind));
  const settled = active.filter((item) => !PAYOFF_KINDS.has(item.kind));
  const sum = (items: typeof active) => items.reduce((total, item) => total + item.pay, 0);
  const holders = paidOff.map((item) => splitLabel(item.label).party).filter((party): party is string => !!party);
  const weeks = Math.round(deal.study.days / 7);
  const net = clientNet(deal.input, deal.study);
  const certainty = (part: "mortgage" | "personal"): Certainty => net.lines.find((line) => line.part === part)?.certainty ?? "estimated";
  return {
    stage: deal.stage,
    structure,
    settles: sum(settled),
    payoff: sum(paidOff),
    payoffAt: [...new Set(holders)],
    financing: deal.study.summary.financing
      .filter((part) => part.amount > 0)
      .map((part) => ({ part: part.kind, amount: part.amount, lender: part.lender, lenderKind: part.lenderKind, certainty: certainty(part.kind) })),
    offered: deal.study.financing.source === "bank",
    keeps: Math.max(0, deal.study.clientNet),
    keepsCertainty: net.certainty,
    weeks: { from: Math.max(4, weeks - 2), to: Math.max(6, weeks + 2) },
    months: wait && wait.months.to > 0 ? { from: monthsOf(wait.days.from), to: monthsOf(wait.days.to) } : null,
  };
}
