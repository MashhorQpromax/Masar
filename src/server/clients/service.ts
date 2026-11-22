import "server-only";
import { eq, sql } from "drizzle-orm";
import { ZodError } from "zod";
import type { Tx } from "../db/client";
import { clients } from "../db/schema";
import type { Actor } from "../shared/actor";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";
import { borrowerInputSchema, type BorrowerInput } from "./input";

export type ClientRow = typeof clients.$inferSelect;

export function parseBorrower(value: unknown): BorrowerInput {
  try {
    return borrowerInputSchema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new DomainError("INVALID_INPUT", error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    throw error;
  }
}

/**
 * The next file number, "C-001" and up. Call inside the transaction that inserts the client:
 * the lock makes two people opening files at the same moment take different numbers.
 */
async function nextFileNo(tx: Tx): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('masar.clients.file_no'))`);
  const [row] = await tx
    .select({ last: sql<number>`coalesce(max(substring(${clients.fileNo} from '^C-([0-9]+)$')::int), 0)` })
    .from(clients);
  return `C-${String(Number(row?.last ?? 0) + 1).padStart(3, "0")}`;
}

/** Opens a file for a new client. Runs inside the caller's transaction. */
export async function createClient(tx: Tx, args: { input: BorrowerInput; actor: Actor; now: Date }): Promise<ClientRow> {
  const fileNo = await nextFileNo(tx);
  const [client] = await tx
    .insert(clients)
    .values({ ...args.input, fileNo, ownerId: args.actor.userId, createdAt: args.now, updatedAt: args.now })
    .returning();
  await audit(tx, args.actor, "client.create", "client", client!.id, { fileNo });
  return client!;
}

/** Changes the facts a deal is computed from. Runs inside the caller's transaction. */
export async function updateBorrower(
  tx: Tx,
  args: { clientId: number; input: BorrowerInput; actor: Actor; now: Date },
): Promise<ClientRow> {
  const [before] = await tx.select().from(clients).where(eq(clients.id, args.clientId));
  if (!before) throw new DomainError("NOT_FOUND", `client ${args.clientId}`);
  const changed = (Object.keys(args.input) as (keyof BorrowerInput)[]).filter((key) => before[key] !== args.input[key]);
  if (!changed.length) return before;
  const [client] = await tx
    .update(clients)
    .set({ ...args.input, updatedAt: args.now })
    .where(eq(clients.id, args.clientId))
    .returning();
  await audit(tx, args.actor, "client.update", "client", args.clientId, { changed });
  return client!;
}
