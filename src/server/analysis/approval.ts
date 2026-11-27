import "server-only";
import { desc, eq } from "drizzle-orm";
import {
  approvalRefusal,
  approvalSummary,
  changedParts,
  completeness,
  REASON_MAX,
  type AnalysisVerdict,
  type ApprovalPart,
  type ApprovalSummary,
  type Fingerprint,
} from "@/domain/analysis";
import type { Db } from "../db/client";
import { analysisApprovals, users } from "../db/schema";
import type { Actor } from "../shared/actor";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";
import { getAnalysis } from "./service";

/** One approval of a client's analysis, held against the analysis as it reads now. */
export interface Approval {
  id: number;
  at: Date;
  /** Who approved it. Null once their account is gone. */
  by: string | null;
  verdict: AnalysisVerdict;
  complete: boolean;
  reason: string | null;
  summary: ApprovalSummary;
  /** What is no longer what the approval rested on. Empty: it stands. */
  changed: ApprovalPart[];
}

const EVERY_PART: ApprovalPart[] = ["file", "record", "lenders", "result"];

/**
 * Every approval of a client's analysis, newest first, each held against the prints of the analysis
 * as it reads now. With no analysis now (no record), every approval has fallen.
 */
export async function approvalsOf(db: Db, args: { clientId: number; now: Fingerprint | null }): Promise<Approval[]> {
  const rows = await db
    .select({ approval: analysisApprovals, by: users.name })
    .from(analysisApprovals)
    .leftJoin(users, eq(users.id, analysisApprovals.userId))
    .where(eq(analysisApprovals.clientId, args.clientId))
    .orderBy(desc(analysisApprovals.id));
  return rows.map(({ approval, by }) => ({
    id: approval.id,
    at: approval.createdAt,
    by: approval.approver ?? by,
    verdict: approval.verdict as AnalysisVerdict,
    complete: approval.complete,
    reason: approval.reason,
    summary: approval.summary as unknown as ApprovalSummary,
    changed: args.now ? changedParts(approval.fingerprint as Fingerprint, args.now) : EVERY_PART,
  }));
}

/**
 * Approves a client's analysis as it reads now. The analysis is worked out again here, so what is
 * approved is what the file, the record and the catalogue say at this moment and not what a screen
 * showed. An incomplete recommendation needs the reason it is approved all the same; the approval
 * keeps what was open, the prints of the four parts, and what the analysis read and found.
 */
export async function approveAnalysis(db: Db, args: { clientId: number; reason?: string | null; actor: Actor & { name?: string | null }; now?: Date }): Promise<Approval> {
  const now = args.now ?? new Date();
  const reason = args.reason?.replace(/\s+/g, " ").trim().slice(0, REASON_MAX) || null;
  return db.transaction(async (tx) => {
    const view = await getAnalysis(tx as unknown as Db, { clientId: args.clientId, now });
    if (!view) throw new DomainError("NOT_FOUND", `client ${args.clientId}`);
    const { analysis, fingerprint, record } = view;
    if (!analysis || !fingerprint || !record) throw new DomainError("APPROVAL_REFUSED", "no analysis", { reason: "PENDING" });
    const [latest] = await approvalsOf(tx as unknown as Db, { clientId: args.clientId, now: fingerprint });
    const standing = latest && latest.changed.length === 0 ? fingerprint : null;
    const refusal = approvalRefusal(analysis, { reason, now: fingerprint, standing });
    if (refusal) throw new DomainError("APPROVAL_REFUSED", refusal, { reason: refusal });

    const summary = approvalSummary(analysis);
    const open = completeness(analysis);
    const [account] = args.actor.userId == null ? [] : await tx.select({ name: users.name }).from(users).where(eq(users.id, args.actor.userId));
    const approver = account?.name ?? args.actor.name ?? null;
    const [row] = await tx
      .insert(analysisApprovals)
      .values({
        clientId: args.clientId,
        userId: args.actor.userId,
        approver,
        verdict: analysis.verdict,
        complete: open.complete,
        // A complete recommendation needs no reason; one given is kept all the same.
        reason,
        fingerprint,
        summary: summary as unknown as Record<string, unknown>,
        basis: { file: view.file, recordId: record.id, analysis } as unknown as Record<string, unknown>,
        createdAt: now,
      })
      .returning({ id: analysisApprovals.id });
    await audit(tx, args.actor, "study.approve", "client", args.clientId, {
      verdict: analysis.verdict,
      complete: open.complete,
      open: open.complete ? null : { verify: open.verify, missing: open.missing, unconfirmed: open.unconfirmed, conflict: open.conflict, terms: open.terms },
      reason,
      recordId: record.id,
    });
    return { id: row!.id, at: now, by: approver, verdict: analysis.verdict, complete: open.complete, reason, summary, changed: [] };
  });
}
