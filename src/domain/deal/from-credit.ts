import { sameDebts, type CreditAnalysis, type CreditReport, type JudgmentKind } from "@/domain/credit";
import { payoffEstimate } from "@/domain/finance/amortization";
import { DEFAULT_PAYER } from "./borrower";
import type { CreditFlags, ItemKind, PaidBy } from "./types";

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
  | { from: "obligation"; kind: "mortgage" | "personal" | "auto" | "card"; lender: string | null };

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

/** The facts of a credit record that change a deal's risks and its suggested fee. */
export function creditFlags(report: CreditReport, analysis: CreditAnalysis): CreditFlags {
  return {
    bankReopenMonths: analysis.banks.reopenInMonths,
    suspension: !!report.serviceSuspension,
    financeCoDefault: analysis.stats.financeCoDefaults > 0,
  };
}
