import { CREDIT_RULES, sameDebts, type CreditAnalysis, type CreditReport, type Facility, type JudgmentKind } from "@/domain/credit";
import { payoffEstimate } from "@/domain/finance/amortization";
import { DEFAULT_PAYER } from "./borrower";
import type { CreditFlags, DealItem, ItemKind, PaidBy } from "./types";

/** A monthly commitment the client declared: a mortgage, a personal loan, a car, a card. */
export interface Owed {
  kind: string;
  lender?: string | null;
  monthly: number;
  remaining?: number | null;
}

/** Where a suggested item came from. The interface words its label from this. */
export type DraftSource =
  | { from: "judgment"; kind: JudgmentKind; decisionNo: string | null; creditor: string | null; date: string | null }
  | { from: "default"; lender: string; product: string }
  | { from: "obligation"; kind: "mortgage" | "personal" | "auto" | "card"; lender: string | null }
  | { from: "product"; lender: string; product: string };

/** An obligation suggested for a new deal. It becomes a deal item once it has an id and a label. */
export interface ItemDraft {
  kind: ItemKind;
  source: DraftSource;
  original: number;
  pay: number;
  by: PaidBy;
  monthly?: number | null;
}

/**
 * Annual rates assumed for an existing loan when its payoff is estimated, before the lender's
 * liability letter gives the real figure.
 */
export const PAYOFF_RATE = { mortgage: 5, other: 6 } as const;

/**
 * The first list of what a deal has to settle, read from the credit record and the client's commitments:
 * every open court order, every unpaid default that no order already covers, then the loans to pay off.
 */
export function itemDrafts(report: CreditReport | null, obligations: readonly Owed[]): ItemDraft[] {
  const drafts: ItemDraft[] = [];
  const unpaid = (report?.facilities ?? []).filter((f) => f.status === "default");
  const open = (report?.judgments ?? []).filter((j) => j.active);
  // A bounced cheque is its own debt. Only a court order can be the same debt as a default.
  const paired = sameDebts(open.filter((j) => j.kind !== "bounced_cheque"), unpaid);
  const enforced = new Set(paired.values());

  for (const j of open) {
    const amount = j.remaining ?? j.amount ?? 0;
    drafts.push({
      kind: "execution",
      source: { from: "judgment", kind: j.kind, decisionNo: j.decisionNo || null, creditor: j.creditor ?? paired.get(j)?.lender ?? null, date: j.date || null },
      original: amount,
      pay: amount,
      by: DEFAULT_PAYER.execution,
    });
  }
  for (const d of unpaid) {
    if (enforced.has(d)) continue;
    const amount = d.defaultNow ?? d.defaultAmount ?? d.balance ?? 0;
    drafts.push({ kind: "default", source: { from: "default", lender: d.lender, product: d.product }, original: amount, pay: amount, by: DEFAULT_PAYER.default });
  }
  for (const o of obligations) {
    const remaining = o.remaining ?? 0;
    const lender = o.lender ?? null;
    if (o.kind === "mortgage") {
      drafts.push({
        kind: "mortgage_payoff",
        source: { from: "obligation", kind: "mortgage", lender },
        original: remaining,
        pay: payoffEstimate(o.monthly, remaining, PAYOFF_RATE.mortgage),
        by: DEFAULT_PAYER.mortgage_payoff,
        monthly: o.monthly || null,
      });
    } else if (o.kind === "personal" || o.kind === "auto" || o.kind === "card") {
      const kind: ItemKind = o.kind === "card" ? "card" : "personal_payoff";
      drafts.push({
        kind,
        source: { from: "obligation", kind: o.kind, lender },
        original: remaining,
        pay: payoffEstimate(o.monthly, remaining, PAYOFF_RATE.other),
        by: DEFAULT_PAYER[kind],
        monthly: o.monthly || null,
      });
    }
  }
  return drafts;
}

/** The kind of commitment a deal settles as a mortgage, a loan or a card. */
export type RunningKind = "mortgage" | "personal" | "card" | "auto";

/** How a running product on the record is taken as a commitment, by the name SIMAH gives the product. */
const OWED_KIND: [RegExp, RunningKind][] = [
  [/منزلي|عقاري/, "mortgage"],
  [/شخصي/, "personal"],
  [/بطاقة/, "card"],
  [/سيارة|تأجير|تاجير/, "auto"],
];

/**
 * The finance on a record that is still being paid, neither closed nor defaulted nor a default that
 * was paid, each with the kind of commitment its name says it is. Null is finance SIMAH names in
 * another way, such as buy now and pay later. A phone line is not finance.
 */
export function runningFinance(report: CreditReport | null): { facility: Facility; kind: RunningKind | null }[] {
  return (report?.facilities ?? [])
    .filter((f) => (f.status === "current" || f.status === "late") && f.creditorType !== "telecom")
    .map((facility) => ({ facility, kind: OWED_KIND.find(([pattern]) => pattern.test(facility.product))?.[1] ?? null }));
}

/**
 * The loans and cards a record shows as still running, as commitments a deal can settle. A product
 * counts when the record gives it an installment or a balance: what it does not give stays empty
 * and is never guessed. A phone line is not a commitment.
 */
export function owedFrom(report: CreditReport | null): Owed[] {
  const owed: Owed[] = [];
  for (const { facility: f, kind } of runningFinance(report)) {
    if (!kind) continue;
    const monthly = f.installment ?? 0;
    const remaining = f.balance ?? 0;
    if (monthly <= 0 && remaining <= 0) continue;
    owed.push({ kind, lender: f.lender, monthly: Math.max(0, monthly), remaining: remaining > 0 ? remaining : null });
  }
  return owed;
}

/** What the record did not give about a suggested item, so a person has to. */
export type DraftGap = "amount" | "monthly";

/** A suggested item with what is missing from it. */
export interface ReportDraft extends ItemDraft {
  missing: DraftGap[];
}

function gaps(draft: ItemDraft): DraftGap[] {
  const missing: DraftGap[] = [];
  if (!draft.original) missing.push("amount");
  // An installment matters where it is counted or where a payoff is estimated from it. A card has none.
  const needsMonthly = draft.kind === "mortgage_payoff" || draft.kind === "personal_payoff" || draft.kind === "other";
  if (needsMonthly && !draft.monthly) missing.push("monthly");
  return missing;
}

/**
 * Everything a credit record says a deal has to deal with, ready to be reviewed: the court orders and
 * unpaid defaults, the loans and cards still running at an estimated payoff, and any other running
 * finance, which starts as staying outside the deal with its installment counted.
 */
export function reportDrafts(report: CreditReport | null): ReportDraft[] {
  const drafts: ItemDraft[] = itemDrafts(report, owedFrom(report));
  for (const { facility: f, kind } of runningFinance(report)) {
    if (kind) continue;
    const monthly = f.installment ?? 0;
    const remaining = f.balance ?? 0;
    if (monthly <= 0) continue;
    drafts.push({ kind: "other", source: { from: "product", lender: f.lender, product: f.product }, original: Math.max(0, remaining), pay: Math.max(0, remaining), by: "out", monthly });
  }
  return drafts.map((draft) => ({ ...draft, missing: gaps(draft) }));
}

/** The words of a draft's source that an item added from it carries in its label. */
function draftParty(source: DraftSource): string | null {
  const text = source.from === "judgment" ? (source.decisionNo ?? source.creditor) : source.lender;
  return text?.trim() || null;
}

type Held = Pick<DealItem, "kind" | "label" | "original"> & { confirmed?: boolean };

/** How a suggested item was found in a deal: by name and amount, by name alone, by amount alone, or by the label it was added under. */
type Placing = "exact" | "about" | "named" | "amount" | "label";

/**
 * Finds each suggested item in a deal. A draft is in the deal when an item of its kind names its
 * lender or its decision number, or has about its amount. The surest match is made first (the name
 * and the exact amount, then the name and about the amount, then the name, then the amount), so of
 * two loans from one lender the one that is missing is the one still suggested. A draft the record
 * gives no name for is, last, known by the label it is added under, so it is not offered again once
 * its amount is written. Each item answers for one draft only.
 */
function placeDrafts<T extends ItemDraft & { label?: string | null }>(drafts: readonly T[], items: readonly Held[]): Map<T, { at: number; how: Placing }> {
  const taken = new Set<number>();
  const placed = new Map<T, { at: number; how: Placing }>();
  const named = (draft: T, item: Held): boolean => {
    const party = draftParty(draft.source);
    return !!party && item.label.includes(party);
  };
  const about = (draft: T, item: Held): boolean =>
    draft.original > 0 && item.original > 0 && Math.abs(item.original - draft.original) <= Math.max(CREDIT_RULES.sameDebtTolerance, draft.original * CREDIT_RULES.sameDebtShare);
  const passes: [Placing, (draft: T, item: Held) => boolean][] = [
    ["exact", (draft, item) => named(draft, item) && item.original === draft.original],
    ["about", (draft, item) => named(draft, item) && about(draft, item)],
    ["named", named],
    ["amount", about],
    ["label", (draft, item) => !!draft.label && item.label === draft.label],
  ];
  for (const [how, matches] of passes) {
    for (const draft of drafts) {
      if (placed.has(draft)) continue;
      const at = items.findIndex((item, index) => !taken.has(index) && item.kind === draft.kind && matches(draft, item));
      if (at < 0) continue;
      taken.add(at);
      placed.set(draft, { at, how });
    }
  }
  return placed;
}

/** The suggested items a deal does not hold yet (`placeDrafts` says how one is found). */
export function pendingDrafts<T extends ItemDraft & { label?: string | null }>(drafts: readonly T[], items: readonly Held[]): T[] {
  const placed = placeDrafts(drafts, items);
  return drafts.filter((draft) => !placed.has(draft));
}

/** A debt the record and the deal both name, at amounts that differ by more than a rounding. */
export interface RecordDifference<T> {
  draft: T;
  /** The deal's item, by its place in the deal's list. */
  item: number;
  /** What the record says is owed. */
  record: number;
  /** What the deal says is owed. */
  deal: number;
}

/** The debts whose amount the record fixes: what a court ordered and what a lender declared in default. A loan's balance falls every month. */
const FIXED_DEBTS: readonly ItemKind[] = ["execution", "default"];

/**
 * The court orders and defaults the deal names at another amount than the record. These are what the
 * office pays, so a deal that holds less than the record owes is a deal whose capital is short. An
 * item whose amount was confirmed by a paper from the creditor is newer than the record and differs
 * from nothing. A running loan is left out: its balance on the record is older than the deal, and the
 * creditor's letter settles it.
 */
export function recordDifferences<T extends ItemDraft & { label?: string | null }>(drafts: readonly T[], items: readonly Held[]): RecordDifference<T>[] {
  const differences: RecordDifference<T>[] = [];
  for (const [draft, { at, how }] of placeDrafts(drafts, items)) {
    const item = items[at]!;
    if (how !== "named" || !FIXED_DEBTS.includes(draft.kind) || item.confirmed) continue;
    if (draft.original <= 0 || item.original <= 0) continue;
    differences.push({ draft, item: at, record: draft.original, deal: item.original });
  }
  return differences.sort((a, b) => a.item - b.item);
}

/** The facts of a credit record that change a deal's risks and its suggested fee. */
export function creditFlags(report: CreditReport, analysis: CreditAnalysis): CreditFlags {
  return {
    bankReopenMonths: analysis.banks.reopenInMonths,
    suspension: !!report.serviceSuspension,
    financeCoDefault: analysis.stats.financeCoDefaults > 0,
  };
}
