import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { FOLLOW_UP_DAYS, FOLLOW_UP_RANGE } from "@/domain/request";
import type { Db, Tx } from "../db/client";
import { officeSettings } from "../db/schema";
import type { Actor } from "../shared/actor";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";

const KEY = "requests";

const schema = z.object({
  followUpDays: z.number().int().min(FOLLOW_UP_RANGE.min).max(FOLLOW_UP_RANGE.max),
});

/** Days the office waits for a lender's answer before a request shows for a follow-up. */
export async function followUpDays(db: Db | Tx): Promise<number> {
  const [row] = await db.select({ value: officeSettings.value }).from(officeSettings).where(eq(officeSettings.key, KEY));
  const parsed = row ? schema.safeParse(row.value) : null;
  return parsed?.success ? parsed.data.followUpDays : FOLLOW_UP_DAYS;
}

/** Sets the wait. Logged with what it was before. */
export async function setFollowUpDays(db: Db, args: { days: unknown; actor: Actor; now?: Date }): Promise<number> {
  const parsed = schema.safeParse({ followUpDays: args.days });
  if (!parsed.success) throw new DomainError("INVALID_INPUT", "follow-up days");
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    const before = await followUpDays(tx);
    await tx
      .insert(officeSettings)
      .values({
        key: KEY,
        value: { ...parsed.data },
        userId: args.actor.userId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: officeSettings.key,
        set: {
          value: { ...parsed.data },
          userId: args.actor.userId,
          updatedAt: now,
        },
      });
    await audit(tx, args.actor, "settings.requests", "settings", 0, {
      before,
      after: parsed.data.followUpDays,
    });
    return parsed.data.followUpDays;
  });
}
