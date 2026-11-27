import "server-only";
import { eq } from "drizzle-orm";
import { collectedRefusal, toHalala } from "@/domain/deal";
import type { Db } from "../db/client";
import { deals } from "../db/schema";
import type { Actor } from "../shared/actor";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";

/**
 * Records what the office actually collected as its fee on a closed deal, or takes a recorded amount
 * back when `amount` is null. The deal's own numbers stay as they are: the fee as counted is one
 * figure, the fee as collected another, and the month's report shows both.
 *
 * The deal's `updatedAt` is left alone on purpose. For a deal that came from the old system without a
 * closing event, that time is the day it closed.
 */
export async function recordCollectedFee(db: Db, args: { dealId: number; amount: number | null; actor: Actor }): Promise<{ changed: boolean }> {
  return db.transaction(async (tx) => {
    const [deal] = await tx.select({ id: deals.id, clientId: deals.clientId, stage: deals.stage, fee: deals.fee, feeCollected: deals.feeCollected }).from(deals).where(eq(deals.id, args.dealId));
    if (!deal) throw new DomainError("NOT_FOUND", `deal ${args.dealId}`);
    const refusal = collectedRefusal({ stage: deal.stage, amount: args.amount });
    if (refusal) throw new DomainError("COLLECTED_REFUSED", refusal, { reason: refusal });
    const amount = args.amount == null ? null : toHalala(args.amount);
    if (deal.feeCollected === amount) return { changed: false };
    await tx.update(deals).set({ feeCollected: amount }).where(eq(deals.id, deal.id));
    await audit(tx, args.actor, "deal.fee_collected", "deal", deal.id, { clientId: deal.clientId, counted: deal.fee, before: deal.feeCollected, after: amount });
    return { changed: true };
  });
}
