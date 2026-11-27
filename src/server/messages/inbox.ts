import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, max } from "drizzle-orm";
import { normalizePhone } from "@/domain/shared/phone";
import { adoptMessages, phoneFor } from "../clients/service";
import type { Db, Tx } from "../db/client";
import { clients, deals, waMessages } from "../db/schema";
import type { Actor } from "../shared/actor";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";
import type { ThreadMessage } from "./service";

/** One conversation: with a client, or with a number the office does not know yet. */
export interface Conversation {
  /** Null for a number the office does not know. */
  client: { id: number; name: string; fileNo: string; dealId: number | null } | null;
  phone: string;
  /** The name the sender carries on WhatsApp. Shown for an unknown number only. */
  waName: string | null;
  last: { direction: "in" | "out"; type: string; body: string | null; status: string | null; at: Date };
  /** The last word is theirs, and nobody said it needs no answer. */
  waiting: boolean;
}

/** The newest message of every conversation: one per client, and one per number of no client. */
async function lastIds(db: Tx): Promise<number[]> {
  const known = await db.select({ last: max(waMessages.id) }).from(waMessages).where(isNotNull(waMessages.clientId)).groupBy(waMessages.clientId);
  const unknown = await db.select({ last: max(waMessages.id) }).from(waMessages).where(isNull(waMessages.clientId)).groupBy(waMessages.phone);
  return [...known, ...unknown].flatMap((row) => (row.last == null ? [] : [row.last])).sort((a, b) => b - a);
}

/** How many conversations wait for an answer. */
export async function waitingCount(db: Db): Promise<number> {
  const ids = await lastIds(db);
  if (!ids.length) return 0;
  const waiting = await db
    .select({ id: waMessages.id })
    .from(waMessages)
    .where(and(inArray(waMessages.id, ids), eq(waMessages.direction, "in"), isNull(waMessages.seenAt)));
  return waiting.length;
}

/** Every conversation by its newest message, the ones that wait for an answer first. */
export async function inboxOf(db: Db, args: { limit?: number } = {}): Promise<Conversation[]> {
  const ids = (await lastIds(db)).slice(0, args.limit ?? 80);
  if (!ids.length) return [];
  const rows = await db
    .select({
      id: waMessages.id,
      clientId: waMessages.clientId,
      phone: waMessages.phone,
      direction: waMessages.direction,
      type: waMessages.type,
      body: waMessages.body,
      status: waMessages.status,
      seenAt: waMessages.seenAt,
      at: waMessages.createdAt,
    })
    .from(waMessages)
    .where(inArray(waMessages.id, ids))
    .orderBy(desc(waMessages.id));

  const clientIds = rows.flatMap((row) => (row.clientId == null ? [] : [row.clientId]));
  const people = clientIds.length ? await db.select({ id: clients.id, name: clients.fullName, fileNo: clients.fileNo }).from(clients).where(inArray(clients.id, clientIds)) : [];
  const newest = clientIds.length ? await db.select({ clientId: deals.clientId, dealId: max(deals.id) }).from(deals).where(inArray(deals.clientId, clientIds)).groupBy(deals.clientId) : [];
  const dealOf = new Map(newest.map((row) => [row.clientId, row.dealId]));
  const personOf = new Map(people.map((person) => [person.id, { ...person, dealId: dealOf.get(person.id) ?? null }]));

  const strangers = rows.filter((row) => row.clientId == null).map((row) => row.phone);
  const named = strangers.length
    ? await db
        .select({ phone: waMessages.phone, name: waMessages.name })
        .from(waMessages)
        .where(and(isNull(waMessages.clientId), inArray(waMessages.phone, strangers), isNotNull(waMessages.name)))
        .orderBy(asc(waMessages.id))
    : [];
  // The name they carry now is the one on their newest message.
  const nameOf = new Map(named.map((row) => [row.phone, row.name]));

  const list = rows.map((row): Conversation => ({
    client: row.clientId == null ? null : (personOf.get(row.clientId) ?? null),
    phone: row.phone,
    waName: row.clientId == null ? (nameOf.get(row.phone) ?? null) : null,
    last: { direction: row.direction, type: row.type, body: row.body, status: row.status, at: row.at },
    waiting: row.direction === "in" && row.seenAt == null,
  }));
  return [...list.filter((talk) => talk.waiting), ...list.filter((talk) => !talk.waiting)];
}

/** What a number of no client wrote, oldest first, and the name it carries on WhatsApp. */
export interface Stranger {
  phone: string;
  waName: string | null;
  thread: ThreadMessage[];
  waiting: boolean;
}

/** The conversation with a number the office does not know. Null when that number never wrote, or is a client's. */
export async function strangerOf(db: Db, phone: string): Promise<Stranger | null> {
  const number = normalizePhone(phone);
  if (!number) return null;
  const rows = await db
    .select()
    .from(waMessages)
    .where(and(isNull(waMessages.clientId), eq(waMessages.phone, number)))
    .orderBy(desc(waMessages.id))
    .limit(40);
  if (!rows.length) return null;
  const newest = rows[0]!;
  return {
    phone: number,
    waName: rows.find((row) => row.name)?.name ?? null,
    waiting: newest.direction === "in" && newest.seenAt == null,
    thread: rows
      .reverse()
      .map((row) => ({ id: row.id, direction: row.direction, type: row.type, body: row.body, status: row.status, error: row.error, fileId: row.fileId, by: null, at: row.createdAt })),
  };
}

/**
 * Says whose number this is: the number goes on the client's file, in place of the one that was
 * there, and what it wrote joins their conversation.
 */
export async function claimNumber(db: Db, args: { phone: string; clientId: number; actor: Actor; now?: Date }): Promise<{ adopted: number }> {
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    const [client] = await tx.select({ id: clients.id, phone: clients.phone }).from(clients).where(eq(clients.id, args.clientId));
    if (!client) throw new DomainError("NOT_FOUND", `client ${args.clientId}`);
    const phone = await phoneFor(tx, { phone: args.phone, clientId: client.id });
    const before = normalizePhone(client.phone);
    if (client.phone !== phone) await tx.update(clients).set({ phone, updatedAt: now }).where(eq(clients.id, client.id));
    const adopted = await adoptMessages(tx, { clientId: client.id, phone });
    await audit(tx, args.actor, "client.contact", "client", client.id, { changed: before === phone ? [] : ["phone"], adopted, via: "inbox" });
    return { adopted };
  });
}

/**
 * Says a conversation needs no answer, so it stops waiting. For a client by their id, for a number of
 * no client by the number.
 */
export async function markHandled(db: Db, args: { clientId: number } | { phone: string }, actor: Actor, now = new Date()): Promise<number> {
  const whose = "clientId" in args ? eq(waMessages.clientId, args.clientId) : and(isNull(waMessages.clientId), eq(waMessages.phone, normalizePhone(args.phone) ?? ""));
  return db.transaction(async (tx) => {
    const seen = await tx
      .update(waMessages)
      .set({ seenAt: now })
      .where(and(whose, eq(waMessages.direction, "in"), isNull(waMessages.seenAt)))
      .returning({ id: waMessages.id });
    if (seen.length) await audit(tx, actor, "wa.handled", "wa_message", Math.max(...seen.map((row) => row.id)), { messages: seen.length });
    return seen.length;
  });
}
