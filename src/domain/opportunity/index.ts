/**
 * The opportunities of a deal: each way the catalogue can fund it, read as a card a person can act on.
 *
 * A card walks one road in order: whether the lenders take the client, what the deal costs on it, what
 * the office takes, what the client keeps, and the verdict. Beside it stand how far it can be relied
 * on and where each thing it assumes comes from.
 *
 * Four classes:
 * - confirmed: every lender of the opportunity said yes in writing, the reply is in the file, and it is
 *   recent. Nothing else makes an opportunity confirmed.
 * - ready: every condition that applies is met on a lender's term that has a source and a date, nothing
 *   confirmed refuses the client, and no lender has replied in writing yet.
 * - theoretical: the numbers say it can be done, but a condition has no source, a fact about the client
 *   is missing, or the deal lacks what it needs to be judged.
 * - not viable: a confirmed condition refuses the client, a lender said no, or the client would be left
 *   with a deficit. Nothing is offered on it.
 *
 * Paying a default never makes an opportunity confirmed. The record shows the default paid, not gone,
 * and each lender decides for itself how long after it takes the client: every opportunity whose deal
 * pays one says so, with the wait each of its lenders sets.
 *
 * Everything in this module is pure: no database, no clock, no text in any language.
 */
import { clientNet, dealStudy, splitItems, structureOf, type Borrower, type ClientNet, type CreditFlags, type DealInput, type DealStudy, type Structure, type Verdict } from "../deal";
import { AMOUNT_TERMS, TERM_VALIDITY_MONTHS, validUntil, type Eligibility, type Finding, type SourceStrength, type Term, type TermSource, type TermStanding } from "../eligibility";
import type { FundingRoute, RouteFinding, RouteLeg } from "../funding";

export type Part = "mortgage" | "personal";
const PARTS = ["mortgage", "personal"] as const satisfies readonly Part[];

export const OPPORTUNITY_CLASSES = ["confirmed", "ready", "theoretical", "not_viable"] as const;
export type OpportunityClass = (typeof OPPORTUNITY_CLASSES)[number];

export const CONFIDENCES = ["high", "medium", "low"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

/** What a lender answered about this client for one part of the deal, as the file records it. */
export interface LenderReply {
  lenderId: string;
  part: Part;
  decision: "approved" | "approved_modified" | "rejected";
  /** The amount approved. Null for a refusal. */
  amount: number | null;
  /** The day the answer was recorded. */
  on: string;
  /** A paper in the file holds the answer in writing, and nobody sent that paper back. */
  written: boolean;
}

/** A lender's answer counts for as long as a confirmed term does. After that the lender is asked again. */
export const REPLY_VALIDITY_MONTHS = TERM_VALIDITY_MONTHS;

/** The answer that stands for one part of an opportunity: the lender's latest. */
export interface LegReply {
  part: Part;
  lender: string;
  decision: LenderReply["decision"];
  amount: number | null;
  on: string;
  until: string;
  written: boolean;
  /** Older than its validity: it is history, and the lender is asked again. */
  stale: boolean;
}

/** Why an opportunity has its class. The first reason is the one that decides it. */
export type ClassReason =
  | { code: "DEFICIT"; amount: number }
  | { code: "BLOCKED"; count: number }
  | { code: "REFUSED"; lender: string; part: Part; on: string }
  | { code: "REPLIED" }
  | { code: "MET" }
  | { code: "ACTIONS"; count: number }
  | { code: "DOUBTS"; count: number }
  | { code: "INCOMPLETE" }
  | { code: "REFUSED_BEFORE"; lender: string; part: Part; on: string };

/**
 * How firm one thing an opportunity rests on is: a paper, the word of a lender's employee, a figure
 * worked out from general terms, or nothing that can be relied on.
 */
export type Footing = "written" | "verbal" | "estimate" | "none";

export type AssumptionKey = "conditions" | "amount" | "facts" | "obligations" | "costs";

export type AssumptionSource =
  /** The lender's own answer for this client, recorded on this day. */
  | { kind: "reply"; on: string; until: string; written: boolean }
  /** A lender's amount typed on the deal as its offer. */
  | { kind: "offer" }
  /** The lender's terms, held by the weakest source among them. */
  | { kind: "term"; source: TermSource; until: string }
  /** Worked out from the lender's terms and the file: the terms no source confirms, and whether an expected valuation enters it. */
  | { kind: "computed"; open: Term[]; valuation: boolean }
  /** Conditions that have no reliable answer yet: the lender's terms nobody confirmed, and the facts the file lacks. */
  | { kind: "open"; terms: Term[]; facts: number }
  /** Facts that the file and a checked paper state differently. */
  | { kind: "conflict"; count: number }
  /** Creditors' letters: how many of the settled obligations one confirms. */
  | { kind: "letters"; confirmed: number; all: number }
  /** General terms and the expected valuation. */
  | { kind: "general" };

export interface Assumption {
  key: AssumptionKey;
  /** The lender and part it is about, for a lender's conditions or amount. */
  lender: string | null;
  part: Part | null;
  footing: Footing;
  source: AssumptionSource;
  /** One of the links the opportunity's confidence is the weakest of. */
  link: boolean;
}

/** One lender's wait after a default is paid. */
export interface SettledWait {
  lender: string;
  part: Part;
  /** Months the lender waits after a default is paid. Null: nobody confirmed it with the lender. */
  months: number | null;
  /** Months still to wait, as the record will read after the deal. */
  left: number;
  /** The lender's term on it has a source and a date that hold today. */
  confirmed: boolean;
}

export interface Settlement {
  /** The deal itself pays a default or a court order. Paying it does not guarantee the financing. */
  pays: boolean;
  waits: SettledWait[];
}

export interface Opportunity {
  key: string;
  route: FundingRoute;
  /** The deal holds this opportunity's terms now. */
  chosen: boolean;
  /** The deal on this opportunity: the route's terms, with a lender's approved amount where one stands. */
  input: DealInput;
  study: DealStudy;
  net: ClientNet;
  /** The new financing, as the client's net counts it. */
  financing: number;
  /** The financing less the deal's as it stands now, in riyals. */
  financingDiff: number;
  /** What goes out of the financing before the client: what the deal settles, and the costs. */
  cost: number;
  fee: number;
  class: OpportunityClass;
  reasons: ClassReason[];
  confidence: Confidence;
  assumptions: Assumption[];
  /** Null when the deal pays no default and no lender looks at one paid before. */
  settlement: Settlement | null;
  replies: LegReply[];
}

export interface OpportunityArgs {
  /** The deal as it stands. */
  input: DealInput;
  study: DealStudy;
  borrower: Borrower;
  credit?: CreditFlags | null;
  /** Every way the catalogue funds the deal, best first. */
  routes: readonly FundingRoute[];
  /** The route the deal holds now. */
  chosen: string | null;
  /** Lenders' answers about this client, newest first. */
  replies: readonly LenderReply[];
  /** Today, as an ISO day. */
  today: string;
}

const CLASS_RANK: Record<OpportunityClass, number> = { confirmed: 3, ready: 2, theoretical: 1, not_viable: 0 };
const FOOTING_RANK: Record<Footing, number> = { written: 3, verbal: 2, estimate: 1, none: 0 };
const CONFIDENCE_OF: Record<Footing, Confidence> = { written: "high", verbal: "medium", estimate: "medium", none: "low" };

const legs = (route: FundingRoute): { part: Part; leg: RouteLeg }[] => PARTS.flatMap((part) => (route[part] ? [{ part, leg: route[part] }] : []));

/** The latest answer of each lender of a route, part by part. */
function repliesOf(route: FundingRoute, replies: readonly LenderReply[], today: string): LegReply[] {
  return legs(route).flatMap(({ part, leg }) => {
    const reply = replies.find((r) => r.lenderId === leg.product.lenderId && r.part === part);
    if (!reply) return [];
    const until = validUntil(reply.on, REPLY_VALIDITY_MONTHS);
    return [{ part, lender: leg.product.lenderName, decision: reply.decision, amount: reply.amount, on: reply.on, until, written: reply.written, stale: today > until }];
  });
}

const approves = (reply: LegReply | undefined): reply is LegReply => !!reply && !reply.stale && reply.decision !== "rejected";

/** Of the standings a set of answers rests on, the one that can be relied on least. Null when none rests on a lender's term. */
function weakestStanding(standings: readonly (TermStanding | null)[]): Extract<TermStanding, { state: "confirmed" }> | null {
  let weakest: Extract<TermStanding, { state: "confirmed" }> | null = null;
  for (const standing of standings) {
    if (!standing || standing.state !== "confirmed") continue;
    if (!weakest || (standing.strength === "verbal" && weakest.strength === "written") || (standing.strength === weakest.strength && standing.validUntil < weakest.validUntil)) weakest = standing;
  }
  return weakest;
}

const footingOf = (strength: SourceStrength): Footing => (strength === "verbal" ? "verbal" : "written");

/** Whether one lender takes the client for one part, and on what. */
function conditionsOf(part: Part, leg: RouteLeg, reply: LegReply | undefined): Assumption {
  const base = { key: "conditions" as const, lender: leg.product.lenderName, part, link: true };
  if (approves(reply) && reply.written) return { ...base, footing: "written", source: { kind: "reply", on: reply.on, until: reply.until, written: true } };
  const findings: Finding[] = leg.findings;
  const open = findings.filter((f) => f.outcome === "unknown");
  if (open.length > 0) {
    const terms = [...new Set(open.flatMap((f) => (f.doubt !== "FACT_MISSING" && f.term ? [f.term] : [])))];
    return { ...base, footing: "none", source: { kind: "open", terms, facts: open.filter((f) => f.doubt === "FACT_MISSING").length } };
  }
  const weakest = weakestStanding(findings.map((f) => f.standing));
  // Every condition that applies rests on facts of the file and on rules that bind every lender alike.
  if (!weakest) return { ...base, footing: "written", source: { kind: "general" } };
  return { ...base, footing: footingOf(weakest.strength), source: { kind: "term", source: weakest.source, until: weakest.validUntil } };
}

/** How much one lender lends for one part, and on what. */
function amountOf(part: Part, leg: RouteLeg, reply: LegReply | undefined, offer: boolean): Assumption {
  const base = { key: "amount" as const, lender: leg.product.lenderName, part, link: true };
  if (approves(reply) && reply.amount != null) return { ...base, footing: reply.written ? "written" : "verbal", source: { kind: "reply", on: reply.on, until: reply.until, written: reply.written } };
  if (offer) return { ...base, footing: "written", source: { kind: "offer" } };
  const terms = leg.product.terms;
  const relevant = AMOUNT_TERMS.filter((term) => term !== "ltv" || part === "mortgage");
  const open = relevant.filter((term) => terms?.[term]?.state !== "confirmed");
  // A mortgage is counted on the valuation the office expects. Until a lender values the property and offers, it is an estimate.
  const valuation = part === "mortgage";
  if (open.length > 0 || valuation) return { ...base, footing: "estimate", source: { kind: "computed", open, valuation } };
  const weakest = weakestStanding(relevant.map((term) => terms?.[term] ?? null));
  return weakest ? { ...base, footing: footingOf(weakest.strength), source: { kind: "term", source: weakest.source, until: weakest.validUntil } } : { ...base, footing: "estimate", source: { kind: "computed", open, valuation } };
}

/** The deal on one route: the route's terms, and the amount a lender approved for a part where one stands. */
function dealOn(args: OpportunityArgs, route: FundingRoute, replies: LegReply[]): { input: DealInput; study: DealStudy; offers: Set<Part> } {
  if (route.key === args.chosen) {
    const offers = new Set<Part>(PARTS.filter((part) => (part === "mortgage" ? args.input.bankMortgage : args.input.bankPersonal) != null));
    return { input: args.input, study: args.study, offers };
  }
  const approved = (part: Part) => {
    const reply = replies.find((r) => r.part === part);
    return approves(reply) && reply.amount != null ? reply.amount : null;
  };
  const bankMortgage = route.mortgage ? approved("mortgage") : null;
  const bankPersonal = route.personal ? approved("personal") : null;
  const input: DealInput = { ...args.input, ...route.terms, bankMortgage, bankPersonal };
  if (bankMortgage == null && bankPersonal == null) return { input, study: route.study, offers: new Set() };
  return { input, study: dealStudy(input, args.borrower, args.credit), offers: new Set() };
}

function settlementOf(input: DealInput, route: FundingRoute): Settlement | null {
  const pays = splitItems(input).active.some((item) => item.kind === "execution" || item.kind === "default");
  const waits: SettledWait[] = legs(route).flatMap(({ part, leg }) => {
    const check = leg.checks.find((c) => c.code === "SETTLED_WAIT" || c.code === "SETTLED_UNCONFIRMED" || c.code === "SETTLED_ACCEPTED");
    if (!check) return [];
    return [
      {
        lender: leg.product.lenderName,
        part,
        months: leg.product.settledDefaultWaitMonths ?? null,
        left: check.code === "SETTLED_WAIT" ? check.params.months : 0,
        confirmed: leg.product.terms?.settled?.state === "confirmed",
      },
    ];
  });
  return pays || waits.length > 0 ? { pays, waits } : null;
}

function classOf(route: FundingRoute, study: DealStudy, replies: LegReply[]): { class: OpportunityClass; reasons: ClassReason[] } {
  const refused = replies.find((r) => !r.stale && r.decision === "rejected");
  const blockers = route.blockers.length;
  const deficit = study.clientNet < 0 && study.verdict !== "needs_info";
  const notViable: ClassReason[] = [
    ...(refused ? [{ code: "REFUSED" as const, lender: refused.lender, part: refused.part, on: refused.on }] : []),
    ...(blockers > 0 ? [{ code: "BLOCKED" as const, count: blockers }] : []),
    ...(deficit ? [{ code: "DEFICIT" as const, amount: -study.clientNet }] : []),
  ];
  if (notViable.length > 0) return { class: "not_viable", reasons: notViable };

  const before = replies.find((r) => r.stale && r.decision === "rejected");
  const incomplete = study.verdict === "needs_info";
  const writtenAll = legs(route).every(({ part }) => {
    const reply = replies.find((r) => r.part === part);
    return approves(reply) && reply.written;
  });
  if (writtenAll && !incomplete && !before) return { class: "confirmed", reasons: [{ code: "REPLIED" }] };

  const theoretical: ClassReason[] = [
    ...(incomplete ? [{ code: "INCOMPLETE" as const }] : []),
    ...(before ? [{ code: "REFUSED_BEFORE" as const, lender: before.lender, part: before.part, on: before.on }] : []),
    ...(route.eligibility === "needs_verification" ? [{ code: "DOUBTS" as const, count: route.doubts.length }] : []),
  ];
  if (theoretical.length > 0) return { class: "theoretical", reasons: theoretical };
  return { class: "ready", reasons: route.eligibility === "conditional" ? [{ code: "ACTIONS", count: route.actions.length }] : [{ code: "MET" }] };
}

const incoming = (net: ClientNet): number => net.lines.reduce((total, line) => total + (line.part === "mortgage" || line.part === "personal" ? line.amount : 0), 0);
const outgoing = (net: ClientNet): number => net.lines.reduce((total, line) => total + (line.part === "obligations" || line.part === "costs" ? line.amount : 0), 0);

/** One route as an opportunity. */
export function opportunityOf(args: OpportunityArgs, route: FundingRoute): Opportunity {
  const replies = repliesOf(route, args.replies, args.today);
  const { input, study, offers } = dealOn(args, route, replies);
  const net = clientNet(input, study);
  const now = clientNet(args.input, args.study);
  const { class: cls, reasons } = classOf(route, study, replies);

  const assumptions: Assumption[] = [];
  for (const { part, leg } of legs(route)) {
    const reply = replies.find((r) => r.part === part);
    assumptions.push(conditionsOf(part, leg, reply), amountOf(part, leg, reply, offers.has(part)));
  }
  const conflicts = route.doubts.filter((d) => d.finding.check.code === "FACT_CONFLICT").length;
  if (conflicts > 0) assumptions.push({ key: "facts", lender: null, part: null, footing: "none", source: { kind: "conflict", count: conflicts }, link: true });
  const obligations = net.lines.find((line) => line.part === "obligations");
  if (obligations?.count) {
    const { all, confirmed } = obligations.count;
    assumptions.push({ key: "obligations", lender: null, part: null, footing: confirmed === all ? "written" : "estimate", source: { kind: "letters", confirmed, all }, link: true });
  }
  // The lender's admin fee and the taxes are counted from general terms. Small beside the rest, they are said and not weighed.
  if (net.lines.some((line) => line.part === "costs")) assumptions.push({ key: "costs", lender: null, part: null, footing: "estimate", source: { kind: "general" }, link: false });

  const weakest = assumptions.filter((a) => a.link).reduce<Footing>((low, a) => (FOOTING_RANK[a.footing] < FOOTING_RANK[low] ? a.footing : low), "written");
  const financing = incoming(net);
  return {
    key: route.key,
    route,
    chosen: route.key === args.chosen,
    input,
    study,
    net,
    financing,
    financingDiff: financing - incoming(now),
    cost: outgoing(net),
    fee: study.fee,
    class: cls,
    reasons,
    confidence: CONFIDENCE_OF[weakest],
    assumptions,
    settlement: settlementOf(input, route),
    replies,
  };
}

/**
 * Every opportunity of a deal, ranked: the classes in their order, and within a class the order the
 * routes already come in (a route a lender would take first, then what the client keeps).
 */
export function opportunities(args: OpportunityArgs): Opportunity[] {
  const cards = args.routes.map((route, index) => ({ card: opportunityOf(args, route), index }));
  return cards.sort((a, b) => CLASS_RANK[b.card.class] - CLASS_RANK[a.card.class] || a.index - b.index).map(({ card }) => card);
}

/** Whether a message to the client may speak of an opportunity: never of one that cannot be carried out. */
export const speakable = (o: Pick<Opportunity, "class" | "study">): boolean => o.class !== "not_viable" && o.study.clientNet >= 0 && (o.study.verdict === "go" || o.study.verdict === "tight");

/**
 * The print of the lenders' terms an opportunity rests on: each product's values, standings and special
 * conditions. A change to any of them changes the print, and an approval held against it falls.
 */
export function lendersPrint(route: Pick<FundingRoute, "mortgage" | "personal"> | null): unknown {
  if (!route) return null;
  return PARTS.map((part) => (route[part] ? { part, product: route[part].product } : null));
}

/**
 * One opportunity as a person reads it, and as a report keeps it: plain figures and codes, nothing that
 * has to be worked out again. The screen and the report read the same card, so they agree to the riyal.
 */
export interface OpportunityCard {
  key: string;
  lenders: { mortgage: string | null; personal: string | null };
  oneLender: boolean;
  chosen: boolean;
  class: OpportunityClass;
  reasons: ClassReason[];
  confidence: Confidence;
  eligibility: Eligibility;
  financing: number;
  financingDiff: number;
  cost: number;
  fee: number;
  /** The monthly installment of the new financing. */
  monthly: number;
  net: ClientNet;
  assumptions: Assumption[];
  settlement: Settlement | null;
  replies: LegReply[];
  /** Confirmed conditions that refuse the client, what has no reliable answer yet, and what the client does first. */
  blockers: RouteFinding[];
  doubts: RouteFinding[];
  actions: RouteFinding[];
}

export function cardOf(o: Opportunity): OpportunityCard {
  const { route } = o;
  return {
    key: o.key,
    lenders: { mortgage: route.mortgage?.product.lenderName ?? null, personal: route.personal?.product.lenderName ?? null },
    oneLender: route.oneLender,
    chosen: o.chosen,
    class: o.class,
    reasons: o.reasons,
    confidence: o.confidence,
    eligibility: route.eligibility,
    financing: o.financing,
    financingDiff: o.financingDiff,
    cost: o.cost,
    fee: o.fee,
    monthly: (route.mortgage?.installment ?? 0) + (route.personal?.installment ?? 0),
    net: o.net,
    assumptions: o.assumptions,
    settlement: o.settlement,
    replies: o.replies,
    blockers: route.blockers,
    doubts: route.doubts,
    actions: route.actions,
  };
}

/** A study of a deal's opportunities as it was made on a day: a copy that never changes. */
export interface OpportunityReport {
  version: 1;
  /** The day it was made, in Riyadh. */
  day: string;
  structure: Structure;
  /** The deal as it stood beside its opportunities. */
  asIs: { financing: number; net: ClientNet; verdict: Verdict };
  cards: OpportunityCard[];
  /** The deal's fee plan as it stood: approved, approved and fallen since, or never approved. */
  plan: "stands" | "fell" | "none";
}

export function reportOf(args: { input: DealInput; study: DealStudy; list: readonly Opportunity[]; today: string; plan: OpportunityReport["plan"] }): OpportunityReport {
  const net = clientNet(args.input, args.study);
  return {
    version: 1,
    day: args.today,
    structure: structureOf(args.input),
    asIs: { financing: incoming(net), net, verdict: args.study.verdict },
    cards: args.list.map(cardOf),
    plan: args.plan,
  };
}

/** Why a report is not made. Null when it may be. */
export type ReportRefusal = "NO_CONSENT" | "NO_OPPORTUNITIES";

export function reportRefusal(args: { consented: boolean; opportunities: number }): ReportRefusal | null {
  if (!args.consented) return "NO_CONSENT";
  return args.opportunities === 0 ? "NO_OPPORTUNITIES" : null;
}
