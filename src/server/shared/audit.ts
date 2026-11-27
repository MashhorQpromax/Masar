import type { Tx } from "../db/client";
import { auditLog } from "../db/schema";
import type { Actor } from "./actor";

/** Records a change. Called inside the same transaction as the change itself. */
export async function audit(
  tx: Tx,
  actor: Actor,
  action: string,
  entity: string,
  entityId: number,
  details?: Record<string, unknown>,
): Promise<void> {
  await tx.insert(auditLog).values({ userId: actor.userId, ip: actor.ip ?? null, action, entity, entityId, details });
}
