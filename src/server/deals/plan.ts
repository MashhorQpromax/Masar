import "server-only";
import { desc, eq } from "drizzle-orm";
import { feePlan, planMoves, planRefusal, policyTerms, type DealInput, type DealStudy, type FeePlan, type PlanFigure } from "@/domain/deal";
import type { FeePart } from "@/domain/deal";
import { dayOf } from "@/domain/eligibility";
import type { FundingRoute } from "@/domain/funding";
import { lendersPrint, opportunityOf } from "@/domain/opportunity";
import type { Db, Tx } from "../db/client";
import { feeApprovals, users } from "../db/schema";
import type { Actor } from "../shared/actor";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";
import { printOf } from "../shared/print";
import { fundingOf } from "../funding/service";
import { lenderReplies } from "../knowledge/service";
import { feePolicy } from "../settings/fees";
import { borrowerOf } from "./mapping";
import { getDeal, type DealView } from "./service";

/**
 * A deal's plan as it stands, and its print. The print is of every input of the deal but its notes,
 * of every line the engine worked out, and of the terms of the lenders whose route the deal holds, so a
 * change anywhere the numbers come from drops an approval: a fact about the client that moves the
 * estimate, or a lender's term or its source.
 */
export function planOf(input: DealInput, study: DealStudy, route: Pick<FundingRoute, "mortgage" | "personal"> | null = null): { plan: FeePlan; print: string } {
  const plan: FeePlan = { ...feePlan(input, study), lenders: route ? printOf(lendersPrint(route)) : null };
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
  moves: { figures: { name: PlanFigure; then: number; now: number }[]; fee: FeePart[]; lenders: boolean };
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
 * The approval of a deal's fee plan that stands now, for a deal already read. Null when the plan was
 * never approved, or anything it rests on moved since. This is what opens the client's final offer: a
 * fee reaches a client only from a plan the manager approved as the deal is.
 */
export async function standingApproval(db: Tx, view: DealView, now: Date): Promise<PlanApproval | null> {
  const funding = await fundingOf(db, view, now);
  const route = funding.routes.find((r) => r.key === funding.chosen) ?? null;
  const [latest] = await planApprovalsOf(db as Db, { dealId: view.deal.id, now: planOf(view.input, view.study, route) });
  return latest?.stands ? latest : null;
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
    const funding = await fundingOf(tx, view, now);
    const route = funding.routes.find((r) => r.key === funding.chosen) ?? null;
    const current = planOf(view.input, view.study, route);
    // The route the deal is on, read as an opportunity: a lender's confirmed condition or its own refusal stops the approval.
    const card = route
      ? opportunityOf(
          { input: view.input, study: view.study, borrower: borrowerOf(view.client, now), credit: view.creditFlags, routes: funding.routes, chosen: funding.chosen, replies: await lenderReplies(tx, view.client.id), today: dayOf(now) },
          route,
        )
      : null;
    const blocked = !!card?.reasons.some((reason) => reason.code === "BLOCKED" || reason.code === "REFUSED");
    const [latest] = await planApprovalsOf(tx as unknown as Db, { dealId: view.deal.id, now: current });
    const refusal = planRefusal(current.plan, { now: current.print, standing: latest?.stands ? current.print : null, blocked });
    if (refusal) throw new DomainError("PLAN_REFUSED", refusal, { reason: refusal });

    const [person] = args.actor.name || args.actor.userId == null ? [] : await tx.select({ name: users.name }).from(users).where(eq(users.id, args.actor.userId));
    const approver = args.actor.name ?? person?.name ?? null;
    // The terms the fee is owed on are the policy's on this day, and are kept with what was approved.
    const plan: FeePlan = { ...current.plan, terms: policyTerms(await feePolicy(tx)) };
    const [row] = await tx
      .insert(feeApprovals)
      .values({ dealId: view.deal.id, userId: args.actor.userId, approver, print: current.print, plan: { ...plan }, createdAt: now })
      .returning();
    await audit(tx, args.actor, "deal.fee_approve", "deal", view.deal.id, {
      clientId: view.client.id,
      fee: { ...current.plan.fee },
      amount: current.plan.amounts.total,
      clientNet: current.plan.clientNet,
      terms: { ...plan.terms },
      route: route?.key ?? null,
      class: card?.class ?? null,
    });
    return { id: row!.id, at: row!.createdAt, by: approver, plan, stands: true, moves: { figures: [], fee: [], lenders: false } };
  });
}
