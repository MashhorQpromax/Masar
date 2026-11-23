import "server-only";
import { desc, eq } from "drizzle-orm";
import { approveAnalysis } from "../analysis/approval";
import type { Db } from "../db/client";
import { analysisApprovals, clients, users } from "../db/schema";
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
