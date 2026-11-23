import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { DEFAULT_POLICY, policyProblem, type FeePolicy } from "@/domain/deal";
import type { Db, Tx } from "../db/client";
import { officeSettings } from "../db/schema";
import type { Actor } from "../shared/actor";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";

const KEY = "fees";

const pct = z.number().min(0).max(100);
const policySchema = z.object({
  settlePct: pct,
  financePct: pct,
  financeBase: z.enum(["total", "personal", "mortgage"]),
  min: pct,
  max: pct,
});

/**
 * The office's fee policy as it stands: what the manager last set, or the default when nothing was
 * set. A stored policy that no longer reads is taken as the default rather than trusted.
 */
export async function feePolicy(db: Db | Tx): Promise<FeePolicy> {
  const [row] = await db.select({ value: officeSettings.value }).from(officeSettings).where(eq(officeSettings.key, KEY));
  const parsed = row ? policySchema.safeParse(row.value) : null;
  return parsed?.success && policyProblem(parsed.data) == null ? parsed.data : { ...DEFAULT_POLICY };
}

/**
 * Sets the office's fee policy. It is checked before it is kept: a range that does not hold, or a
 * starting percent outside its own range, is refused with the reason. Deals already saved keep their
 * own fee; only deals started after this begin from it. Logged with what it was before.
 */
export async function setFeePolicy(db: Db, args: { input: unknown; actor: Actor; now?: Date }): Promise<FeePolicy> {
  const parsed = policySchema.safeParse(args.input);
  if (!parsed.success) throw new DomainError("INVALID_INPUT", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const policy = parsed.data;
  const problem = policyProblem(policy);
  if (problem) throw new DomainError("POLICY_REFUSED", problem, { reason: problem });
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    const before = await feePolicy(tx);
    await tx
      .insert(officeSettings)
      .values({ key: KEY, value: { ...policy }, userId: args.actor.userId, updatedAt: now })
      .onConflictDoUpdate({ target: officeSettings.key, set: { value: { ...policy }, userId: args.actor.userId, updatedAt: now } });
    await audit(tx, args.actor, "settings.fees", "settings", 0, { before: { ...before }, after: { ...policy } });
    return policy;
  });
}
