/**
 * Approving a client's analysis: the person who may sign the office's recommendation says it stands.
 *
 * An approval rests on four things: the client's file as the analysis reads it, the SIMAH record,
 * the terms of the lenders it sends the client to, and what the analysis found (`approvalBasis`). Each is kept as a print. When any of
 * them is no longer what it was, the approval falls and the analysis has to be approved again:
 * nobody acts on an approval of something that has changed since.
 *
 * A recommendation is incomplete when its best answer needs verification or the analysis lists
 * anything missing, unconfirmed or in dispute. It is approved only with the reason the person
 * approves it all the same, and what was open is kept with it. An analysis that cannot be read at
 * all (`pending`), or whose file disagrees with a checked paper, is not approved at all.
 *
 * Pure: the prints are made by the server; this module only compares them.
 */
import type { Eligibility, ProductKind } from "../eligibility";
import type { AnalysisVerdict, ClientAnalysis, Gap, GapCode } from "./types";

/** What an approval rests on, each kept as its own print so a fall can say what changed. */
export const APPROVAL_PARTS = ["file", "record", "lenders", "result"] as const;
export type ApprovalPart = (typeof APPROVAL_PARTS)[number];

/** The print of each part. Equal prints mean equal parts; how a print is made is the server's. */
export type Fingerprint = Record<ApprovalPart, string>;

/** The shortest and the longest reason for approving an incomplete recommendation. */
export const REASON_MIN = 15;
export const REASON_MAX = 500;

/**
 * Stable text of a value: object keys in order, undefined left out, so two equal values always give
 * the same text whatever order their keys were written in.
 */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? "null" : canonical(item))).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

/** What is still open in a recommendation. Complete when nothing is. */
export interface Completeness {
  complete: boolean;
  /** The best answer needs verification: no lender gives a reliable one yet. */
  verify: boolean;
  /** How many of the analysis's gaps about the client are of each kind. */
  missing: number;
  unconfirmed: number;
  conflict: number;
  /** A lender the analysis sends the client to rests on a term nobody confirmed. */
  terms: boolean;
  /** The gaps about the client, by code, in the analysis's order. */
  gaps: GapCode[];
}

/**
 * What is still open in the recommendation. The analysis lists every product of the catalogue whose
 * terms nobody confirmed (`TERMS`); a recommendation is not made incomplete by a lender it does not
 * send the client to, only by one it does.
 */
export function completeness(analysis: Pick<ClientAnalysis, "verdict" | "gaps" | "steps">): Completeness {
  const own = analysis.gaps.filter((gap) => gap.code !== "TERMS");
  const of = (kind: Gap["kind"]) => own.filter((gap) => gap.kind === kind).length;
  const verify = analysis.verdict === "needs_verification" || analysis.verdict === "pending";
  const terms = analysis.steps.some((step) => step.code === "CONFIRM_TERMS" || (step.code === "APPLY" && (step.termsOpen || step.estimated)));
  return {
    complete: !verify && own.length === 0 && !terms,
    verify,
    missing: of("missing"),
    unconfirmed: of("unconfirmed"),
    conflict: of("conflict"),
    terms,
    gaps: own.map((gap) => gap.code),
  };
}

/** What a recommendation said when it was approved, kept with the approval. */
export interface ApprovalSummary {
  verdict: AnalysisVerdict;
  afterClearing: ClientAnalysis["afterClearing"];
  completeness: Completeness;
  /** Where the analysis sent the client, as it stood. */
  apply: { kind: ProductKind; lender: string; product: string; amount: number; eligibility: Eligibility; afterClearing: boolean }[];
}

export function approvalSummary(analysis: ClientAnalysis): ApprovalSummary {
  return {
    verdict: analysis.verdict,
    afterClearing: analysis.afterClearing,
    completeness: completeness(analysis),
    apply: analysis.steps.flatMap((step) =>
      step.code === "APPLY"
        ? [{ kind: step.kind, lender: step.lender, product: step.product, amount: step.amount, eligibility: step.eligibility, afterClearing: step.afterClearing }]
        : [],
    ),
  };
}

/**
 * What of the catalogue and of the result an approval rests on: the products the recommendation sends
 * the client to, with their terms and sources, and what the analysis found about the client. A lender
 * it does not send the client to, and how many of the catalogue's products nobody confirmed, are left
 * out: confirming another lender's terms does not unsettle an approval, unless it changes where the
 * client is sent.
 */
export function approvalBasis<P extends { lenderName: string; name: string }>(analysis: ClientAnalysis, products: readonly P[]): { lenders: P[]; result: unknown } {
  const summary = approvalSummary(analysis);
  return {
    lenders: products.filter((product) => summary.apply.some((apply) => apply.lender === product.lenderName && apply.product === product.name)),
    result: {
      summary,
      steps: analysis.steps,
      gaps: analysis.gaps.filter((gap) => gap.code !== "TERMS"),
      income: analysis.income,
      burden: analysis.burden,
      strengths: analysis.strengths,
      risks: analysis.risks,
    },
  };
}

/**
 * Why an approval is refused. Null when it may be recorded.
 * - `PENDING`: the analysis cannot be read: too little in the file, or no consent on file.
 * - `STANDS`: an approval of exactly this already stands.
 * - `CONFLICT`: the file and a checked paper disagree. No reason approves over it: which figure is
 *   true is settled first, since every lender's answer waits on it.
 * - `REASON_NEEDED`: the recommendation is incomplete and no reason, or too short a one, was given.
 */
export type ApprovalRefusal = "PENDING" | "STANDS" | "CONFLICT" | "REASON_NEEDED";

export function approvalRefusal(
  analysis: Pick<ClientAnalysis, "verdict" | "gaps" | "steps">,
  args: { reason: string | null; now: Fingerprint; standing: Fingerprint | null },
): ApprovalRefusal | null {
  if (analysis.verdict === "pending") return "PENDING";
  if (args.standing && changedParts(args.standing, args.now).length === 0) return "STANDS";
  const open = completeness(analysis);
  if (open.conflict > 0) return "CONFLICT";
  if (!open.complete && (args.reason?.trim().length ?? 0) < REASON_MIN) return "REASON_NEEDED";
  return null;
}

/** The parts that are no longer what an approval rested on, in the order they are told. Empty: it stands. */
export function changedParts(then: Fingerprint, now: Fingerprint): ApprovalPart[] {
  return APPROVAL_PARTS.filter((part) => then[part] !== now[part]);
}
