import "server-only";
import crypto from "node:crypto";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { clientReachable, LINK_DAYS, messageGate } from "@/domain/messages";
import { tokenHash } from "../auth/secret";
import type { Db, Tx } from "../db/client";
import { deals, shareLinks } from "../db/schema";
import { getDeal, type DealView } from "../deals/service";
import type { Actor } from "../shared/actor";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";

const DAY = 86_400_000;

/**
 * A client's link opens their own page without an account, so the token in it is the whole key.
 * It is 192 bits derived from a random seed and the application secret. The database keeps the seed
 * and the token's hash: the office can show the link again, and a copy of the database opens nothing.
 */
export function linkToken(secret: string, seed: string): string {
  return crypto.createHmac("sha256", secret).update(`share-link:${seed}`).digest("base64url").slice(0, 32);
}

/** The demo's links are derived from this, so the same link opens on every copy of the demo. It guards made-up data only. */
export const DEMO_LINK_SECRET = "masar-demo-links";

const TOKEN = /^[A-Za-z0-9_-]{32}$/;

export interface ClientLink {
  token: string;
  expiresAt: Date;
  views: number;
  lastViewAt: Date | null;
}

/** The link a client has open now. Null when they have none. */
export async function linkOf(db: Tx, args: { clientId: number; secret: string; now: Date }): Promise<ClientLink | null> {
  const [row] = await db
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.clientId, args.clientId), eq(shareLinks.revoked, false), gt(shareLinks.expiresAt, args.now)))
    .orderBy(desc(shareLinks.id))
    .limit(1);
  if (!row) return null;
  return { token: linkToken(args.secret, row.seed), expiresAt: row.expiresAt, views: row.views, lastViewAt: row.lastViewAt };
}

/** The deal a client's page is about: their newest one. Null when they have none. */
export async function dealOfClient(db: Tx, clientId: number): Promise<number | null> {
  const [deal] = await db.select({ id: deals.id }).from(deals).where(eq(deals.clientId, clientId)).orderBy(desc(deals.id)).limit(1);
  return deal?.id ?? null;
}

/** Whether the office may speak to the client of a deal at all. A link opens only while it may. */
export const reachable = (view: Pick<DealView, "deal" | "study">): boolean =>
  clientReachable(messageGate({ stage: view.deal.stage, verdict: view.study.verdict }));

/**
 * Opens a link for the client of a deal, or returns the one already open. A client the office does
 * not write to gets no link.
 */
export async function openLink(db: Db, args: { dealId: number; secret: string; actor: Actor; now?: Date }): Promise<ClientLink> {
  const now = args.now ?? new Date();
  const view = await getDeal(db, { dealId: args.dealId, now });
  if (!view) throw new DomainError("NOT_FOUND", `deal ${args.dealId}`);
  if (!reachable(view)) throw new DomainError("GATE_CLOSED", `deal ${args.dealId}`);
  const clientId = view.client.id;
  return db.transaction(async (tx) => {
    const open = await linkOf(tx, { clientId, secret: args.secret, now });
    if (open) return open;
    const seed = crypto.randomBytes(18).toString("base64url");
    const token = linkToken(args.secret, seed);
    const expiresAt = new Date(now.getTime() + LINK_DAYS * DAY);
    await tx.insert(shareLinks).values({ tokenHash: tokenHash(token), seed, clientId, userId: args.actor.userId, expiresAt, createdAt: now });
    await audit(tx, args.actor, "link.open", "client", clientId, { days: LINK_DAYS });
    return { token, expiresAt, views: 0, lastViewAt: null };
  });
}

/** Closes every link of a client. Whoever holds one finds it shut. */
export async function closeLinks(db: Db, args: { clientId: number; actor: Actor }): Promise<void> {
  await db.transaction(async (tx) => {
    const closed = await tx
      .update(shareLinks)
      .set({ revoked: true })
      .where(and(eq(shareLinks.clientId, args.clientId), eq(shareLinks.revoked, false)))
      .returning({ id: shareLinks.id });
    if (closed.length) await audit(tx, args.actor, "link.close", "client", args.clientId, { links: closed.length });
  });
}

/** Who a token opens. Null for anything that is not an open link. */
export async function readLink(db: Tx, args: { token: string; now: Date }): Promise<{ id: number; clientId: number; expiresAt: Date } | null> {
  if (!TOKEN.test(args.token)) return null;
  const [row] = await db
    .select({ id: shareLinks.id, clientId: shareLinks.clientId, expiresAt: shareLinks.expiresAt })
    .from(shareLinks)
    .where(and(eq(shareLinks.tokenHash, tokenHash(args.token)), eq(shareLinks.revoked, false), gt(shareLinks.expiresAt, args.now)));
  return row ?? null;
}

/** Counts one opening of a link. */
export async function countView(db: Tx, linkId: number, now: Date): Promise<void> {
  await db
    .update(shareLinks)
    .set({ views: sql`${shareLinks.views} + 1`, lastViewAt: now })
    .where(eq(shareLinks.id, linkId));
}
