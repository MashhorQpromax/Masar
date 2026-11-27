import type { Stage, Verdict } from "../deal";

/**
 * The messages the office writes about a deal. Five are for the client: what the study found, the
 * final offer with the office's fee in detail, the papers still owed, where the file stands, and a
 * reply in the person's own words. The sixth is the deal in the company's own numbers, for a partner
 * or a funder.
 */
export const MESSAGE_KINDS = ["study", "offer", "papers", "progress", "reply", "internal"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const isMessageKind = (text: string): text is MessageKind => (MESSAGE_KINDS as readonly string[]).includes(text);

/** A message written for the client. The internal one carries the office's capital and return and never goes to one. */
export const isClientMessage = (kind: MessageKind): boolean => kind !== "internal";

/**
 * Why some messages are closed:
 * - `REJECTED`: the deal was cancelled.
 * - `DEFICIT`: the deal does not close on its numbers, which makes the client a rejected one.
 * - `STUDY_OPEN`: the study still lacks a figure, so there is nothing to tell yet but the papers owed.
 */
export type GateReason = "REJECTED" | "DEFICIT" | "STUDY_OPEN";

export interface Gate {
  allowed: MessageKind[];
  reason: GateReason | null;
}

/**
 * Which messages may be written for a deal as it stands. A broker thinks before they write: a client
 * hears from the office only about a file that can close.
 *
 * `approved`: the deal's fee plan stands approved as the deal is now. The final offer carries the
 * office's fee, and a fee reaches a client only once the manager approved it, so the offer is open
 * only then. Left out, it reads as not approved.
 */
export function messageGate(deal: { stage: Stage; verdict: Verdict; approved?: boolean }): Gate {
  if (deal.stage === "lost") return { allowed: ["internal"], reason: "REJECTED" };
  if (deal.verdict === "short") return { allowed: ["internal"], reason: "DEFICIT" };
  if (deal.verdict === "needs_info") return { allowed: ["papers", "reply", "internal"], reason: "STUDY_OPEN" };
  return { allowed: MESSAGE_KINDS.filter((kind) => kind !== "offer" || deal.approved === true), reason: null };
}

/** True when anything at all may be said to the client. It also decides whether their link opens. */
export const clientReachable = (gate: Gate): boolean => gate.allowed.some(isClientMessage);
