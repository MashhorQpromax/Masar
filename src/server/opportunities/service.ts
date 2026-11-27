import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { dayOf } from "@/domain/eligibility";
import { opportunities, reportOf, reportRefusal, type Opportunity, type OpportunityReport } from "@/domain/opportunity";
import type { Db, Tx } from "../db/client";
import { opportunityReports, users } from "../db/schema";
import { borrowerOf } from "../deals/mapping";
import { planApprovalsOf, planOf, type PlanApproval } from "../deals/plan";
import { getDeal, type DealView } from "../deals/service";
import { fundingOf, type FundingView } from "../funding/service";
import { lenderReplies } from "../knowledge/service";
import type { Actor } from "../shared/actor";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";

/** A deal's opportunities, ranked, with the plan the deal holds and whether its approval stands. */
export interface OpportunitiesView {
  funding: FundingView;
  list: Opportunity[];
  /** The latest approval of the deal's fee plan, held against the plan as it stands now. Null: never approved. */
  approval: PlanApproval | null;
  plan: OpportunityReport["plan"];
  /** The client's consent to the office keeping and reading their data is recorded. */
  consented: boolean;
  today: string;
}

/** The opportunities of a deal already read. */
export async function opportunitiesOf(db: Tx, view: DealView, now: Date): Promise<OpportunitiesView> {
  const funding = await fundingOf(db, view, now);
  const today = dayOf(now);
  const list = opportunities({
    input: view.input,
    study: view.study,
    borrower: borrowerOf(view.client, now),
    credit: view.creditFlags,
    routes: funding.routes,
    chosen: funding.chosen,
    replies: await lenderReplies(db, view.client.id),
    today,
  });
  const route = funding.routes.find((r) => r.key === funding.chosen) ?? null;
  const [approval] = await planApprovalsOf(db as Db, { dealId: view.deal.id, now: planOf(view.input, view.study, route) });
  return {
    funding,
    list,
    approval: approval ?? null,
    plan: !approval ? "none" : approval.stands ? "stands" : "fell",
    consented: view.client.consentAt != null,
    today,
  };
}

export async function getOpportunities(db: Db, args: { dealId: number; now?: Date }): Promise<OpportunitiesView | null> {
  const now = args.now ?? new Date();
  const view = await getDeal(db, { dealId: args.dealId, now });
  return view ? opportunitiesOf(db, view, now) : null;
}

/** One saved report, as its list shows it. */
export interface ReportLine {
  id: number;
  at: Date;
  by: string | null;
  /** How many opportunities it holds, and the class of the first. */
  count: number;
  first: Opportunity["class"] | null;
}

/** A deal's saved reports, newest first. */
export async function reportsOf(db: Tx, dealId: number): Promise<ReportLine[]> {
  const rows = await db
    .select({ id: opportunityReports.id, at: opportunityReports.createdAt, author: opportunityReports.author, by: users.name, body: opportunityReports.body })
    .from(opportunityReports)
    .leftJoin(users, eq(users.id, opportunityReports.userId))
    .where(eq(opportunityReports.dealId, dealId))
    .orderBy(desc(opportunityReports.id));
  return rows.map((row) => {
    const body = row.body as unknown as OpportunityReport;
    return { id: row.id, at: row.at, by: row.author ?? row.by, count: body.cards.length, first: body.cards[0]?.class ?? null };
  });
}

/** One saved report of a deal, as it was made. Null when the deal has no report of that number. */
export async function reportById(db: Tx, args: { dealId: number; reportId: number }): Promise<{ id: number; at: Date; by: string | null; body: OpportunityReport } | null> {
  const [row] = await db
    .select({ id: opportunityReports.id, at: opportunityReports.createdAt, author: opportunityReports.author, by: users.name, body: opportunityReports.body })
    .from(opportunityReports)
    .leftJoin(users, eq(users.id, opportunityReports.userId))
    .where(and(eq(opportunityReports.id, args.reportId), eq(opportunityReports.dealId, args.dealId)));
  return row ? { id: row.id, at: row.at, by: row.author ?? row.by, body: row.body as unknown as OpportunityReport } : null;
}

/**
 * Saves the study of a deal's opportunities as it stands now, in the client's file with its day. The
 * opportunities are worked out again here, so what is kept is what the stored numbers give at this
 * moment and not what a screen showed. Refused for a client whose consent is not recorded.
 */
export async function makeReport(db: Db, args: { dealId: number; actor: Actor & { name?: string | null }; now?: Date }): Promise<{ id: number }> {
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    const view = await getDeal(tx as unknown as Db, { dealId: args.dealId, now });
    if (!view) throw new DomainError("NOT_FOUND", `deal ${args.dealId}`);
    const study = await opportunitiesOf(tx, view, now);
    const refusal = reportRefusal({ consented: study.consented, opportunities: study.list.length });
    if (refusal) throw new DomainError("REPORT_REFUSED", refusal, { reason: refusal });
    const body = reportOf({ input: view.input, study: view.study, list: study.list, today: study.today, plan: study.plan });
    const [person] = args.actor.name || args.actor.userId == null ? [] : await tx.select({ name: users.name }).from(users).where(eq(users.id, args.actor.userId));
    const [row] = await tx
      .insert(opportunityReports)
      .values({
        dealId: view.deal.id,
        clientId: view.client.id,
        userId: args.actor.userId,
        author: args.actor.name ?? person?.name ?? null,
        body: body as unknown as Record<string, unknown>,
        createdAt: now,
      })
      .returning({ id: opportunityReports.id });
    await audit(tx, args.actor, "deal.report", "deal", view.deal.id, {
      clientId: view.client.id,
      report: row!.id,
      opportunities: body.cards.length,
      classes: body.cards.map((card) => card.class),
    });
    return { id: row!.id };
  });
}
