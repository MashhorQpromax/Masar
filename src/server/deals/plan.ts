import "server-only";
import { desc, eq } from "drizzle-orm";
import { feePlan, planMoves, planRefusal, type DealInput, type DealStudy, type FeePlan, type PlanFigure } from "@/domain/deal";
import type { FeePart } from "@/domain/deal";
import type { Db } from "../db/client";
import { feeApprovals, users } from "../db/schema";
import type { Actor } from "../shared/actor";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";
import { printOf } from "../shared/print";
import { getDeal } from "./service";

/**
 * A deal's plan as it stands, and its print. The print is of every input of the deal but its notes,
 * and of every line the engine worked out, so a change anywhere the numbers come from drops an
 * approval, a fact about the client that moves the estimate included.
 */
export function planOf(input: DealInput, study: DealStudy): { plan: FeePlan; print: string } {
  const plan = feePlan(input, study);
  const { notes: _notes, ...numbers } = input;
  return { plan, print: printOf({ input: numbers, ledger: study.ledger, plan }) };
}

/** One approval of a deal's fee plan, held against the plan as it stands now. */
export interface PlanApproval {
  id: number;
  at: Date;
  /** Who approved it. Null once their account is gone and no name was kept. */
  by: string | null;
  /** The plan as approved, never changed since. */
  plan: FeePlan;
  stands: boolean;
  /** What moved since, when it fell. */
  moves: { figures: { name: PlanFigure; then: number; now: number }[]; fee: FeePart[] };
}

/** Every approval of a deal's fee plan, newest first, each held against the plan as it stands. */
export async function planApprovalsOf(db: Db, args: { dealId: number; now: { plan: FeePlan; print: string } }): Promise<PlanApproval[]> {
  const rows = await db
    .select({ approval: feeApprovals, by: users.name })
    .from(feeApprovals)
    .leftJoin(users, eq(users.id, feeApprovals.userId))
    .where(eq(feeApprovals.dealId, args.dealId))
    .orderBy(desc(feeApprovals.id));
  return rows.map(({ approval, by }) => {
    const plan = approval.plan as unknown as FeePlan;
    return { id: approval.id, at: approval.createdAt, by: approval.approver ?? by, plan, stands: approval.print === args.now.print, moves: planMoves(plan, args.now.plan) };
  });
}

/**
 * Approves a deal's fee plan as it stands now. The deal is worked out again here, so what is approved
 * is what the stored numbers give at this moment, not what a screen showed. A deal that does not
 * close, or one whose plan is already approved as it is, is refused with the reason. The plan is kept
 * as a copy that never changes, and logged with what the fee comes to and what the client keeps.
 */
export async function approveFeePlan(db: Db, args: { dealId: number; actor: Actor & { name?: string | null }; now?: Date }): Promise<PlanApproval> {
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    const view = await getDeal(tx as unknown as Db, { dealId: args.dealId, now });
    if (!view) throw new DomainError("NOT_FOUND", `deal ${args.dealId}`);
    if (view.deal.stage === "closed" || view.deal.stage === "lost") throw new DomainError("DEAL_ENDED", `deal ${view.deal.id}`);
    const current = planOf(view.input, view.study);
    const [latest] = await planApprovalsOf(tx as unknown as Db, { dealId: view.deal.id, now: current });
    const refusal = planRefusal(current.plan, { now: current.print, standing: latest?.stands ? current.print : null });
    if (refusal) throw new DomainError("PLAN_REFUSED", refusal, { reason: refusal });

    const [person] = args.actor.name || args.actor.userId == null ? [] : await tx.select({ name: users.name }).from(users).where(eq(users.id, args.actor.userId));
    const approver = args.actor.name ?? person?.name ?? null;
    const [row] = await tx
      .insert(feeApprovals)
      .values({ dealId: view.deal.id, userId: args.actor.userId, approver, print: current.print, plan: { ...current.plan }, createdAt: now })
      .returning();
    await audit(tx, args.actor, "deal.fee_approve", "deal", view.deal.id, {
      clientId: view.client.id,
      fee: { ...current.plan.fee },
      amount: current.plan.amounts.total,
      clientNet: current.plan.clientNet,
    });
    return { id: row!.id, at: row!.createdAt, by: approver, plan: current.plan, stands: true, moves: { figures: [], fee: [] } };
  });
}
