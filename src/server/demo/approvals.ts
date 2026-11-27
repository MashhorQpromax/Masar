import "server-only";
import { desc, eq } from "drizzle-orm";
import { approveAnalysis } from "../analysis/approval";
import type { Db } from "../db/client";
import { approveFeePlan } from "../deals/plan";
import { analysisApprovals, clients, deals, feeApprovals, users } from "../db/schema";
import type { Actor } from "../shared/actor";

/**
 * The invented client whose approval stands, and the one whose approval fell when her file changed.
 * Neither file disagrees with its papers: one that does is not approved at all until it is settled.
 */
export const DEMO_APPROVED = "C-017";
export const DEMO_FALLEN = "C-021";

/** Written by whoever approved, in the demonstration's own words. */
export const DEMO_REASON = "عرض تجريبي: اعتُمدت على أن يُسدَّد القرار قبل التقديم، والجهة تُسأل قبل أي سداد.";

/**
 * Approves two invented clients' analyses, after the example lenders are in. One approval stands. The
 * other is kept as it would stand had the client's file changed since it was approved: its print of
 * the file is another, so it shows as fallen with the reason. Does nothing when they are already there.
 */
export async function seedDemoApprovals(db: Db, now: Date): Promise<void> {
  const [known] = await db.select({ id: analysisApprovals.id }).from(analysisApprovals).limit(1);
  if (known) return;
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).orderBy(users.id).limit(1);
  const actor: Actor = { userId: admin?.id ?? null };
  for (const fileNo of [DEMO_APPROVED, DEMO_FALLEN]) {
    const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.fileNo, fileNo));
    if (client) await approveAnalysis(db, { clientId: client.id, reason: DEMO_REASON, actor, now });
  }
  const [fallen] = await db
    .select({ id: analysisApprovals.id, fingerprint: analysisApprovals.fingerprint })
    .from(analysisApprovals)
    .innerJoin(clients, eq(clients.id, analysisApprovals.clientId))
    .where(eq(clients.fileNo, DEMO_FALLEN))
    .orderBy(desc(analysisApprovals.id))
    .limit(1);
  if (fallen) await db.update(analysisApprovals).set({ fingerprint: { ...fallen.fingerprint, file: "before-the-file-changed" } }).where(eq(analysisApprovals.id, fallen.id));
}

/**
 * The invented clients whose deal's fee plan stands, and the one whose plan fell when the numbers moved.
 * The first is the client a lender answered in writing at another amount than her deal is counted on,
 * so her final offer is shut although her plan stands. The second has no such paper: his final offer
 * is open, and the demonstration shows it.
 */
export const DEMO_PLAN_STANDS = "C-017";
export const DEMO_PLAN_OFFER = "C-019";
export const DEMO_PLAN_FELL = "C-014";

/**
 * Approves three invented deals' fee plans. Two stand. The third is kept as it would stand had the
 * deal's numbers moved since: its copy says the client was left 4,000 riyals more, and its print is
 * another, so it shows as fallen with what moved. Does nothing when they are already there.
 */
export async function seedDemoPlans(db: Db, now: Date): Promise<void> {
  const [known] = await db.select({ id: feeApprovals.id }).from(feeApprovals).limit(1);
  if (known) return;
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).orderBy(users.id).limit(1);
  const actor: Actor = { userId: admin?.id ?? null };
  for (const fileNo of [DEMO_PLAN_STANDS, DEMO_PLAN_OFFER, DEMO_PLAN_FELL]) {
    const [deal] = await db.select({ id: deals.id }).from(deals).innerJoin(clients, eq(clients.id, deals.clientId)).where(eq(clients.fileNo, fileNo)).orderBy(desc(deals.id)).limit(1);
    if (!deal) continue;
    const approved = await approveFeePlan(db, { dealId: deal.id, actor, now });
    if (fileNo !== DEMO_PLAN_FELL) continue;
    const plan = { ...approved.plan, clientNet: approved.plan.clientNet + 4000 };
    await db.update(feeApprovals).set({ print: "before-the-numbers-moved", plan: { ...plan } }).where(eq(feeApprovals.id, approved.id));
  }
}
