import "server-only";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { AUDIT_AREAS, WATCHED_ACTIONS, type AuditArea } from "@/domain/audit";
import type { Db } from "../db/client";
import { auditLog, clients, deals, products, users } from "../db/schema";

/** What an event is about, with enough to name it and to link to it. */
export type AuditSubject =
  | { kind: "client"; id: number; name: string; fileNo: string }
  | { kind: "deal"; id: number; name: string; fileNo: string }
  | { kind: "user"; id: number; name: string }
  | { kind: "product"; id: number; name: string };

export interface AuditLine {
  id: number;
  at: Date;
  action: string;
  /** Who did it. Null for the system itself, and for someone who was not signed in. */
  who: { id: number; name: string } | null;
  ip: string | null;
  /** Null when the event is about nothing in particular, or about something that no longer exists. */
  subject: AuditSubject | null;
  details: Record<string, unknown>;
}

export interface AuditQuery {
  area?: AuditArea;
  /** Only the events worth a second look. */
  watched?: boolean;
  /** Only what this person did. */
  userId?: number;
  /** Only events older than this one: the last line of the page before. */
  before?: number;
  limit?: number;
}

const PAGE = 60;

/**
 * The audit log, newest first, a page at a time. Each event comes with who did it and what it is
 * about, so a screen can say it in words without asking again.
 */
export async function readAudit(db: Db, query: AuditQuery = {}): Promise<{ lines: AuditLine[]; next: number | null }> {
  const limit = Math.min(Math.max(query.limit ?? PAGE, 1), 200);
  const actor = alias(users, "actor");
  const aboutUser = alias(users, "about_user");
  const dealClient = alias(clients, "deal_client");

  const rows = await db
    .select({
      id: auditLog.id,
      at: auditLog.createdAt,
      action: auditLog.action,
      userId: auditLog.userId,
      actorName: actor.name,
      ip: auditLog.ip,
      entity: auditLog.entity,
      entityId: auditLog.entityId,
      details: auditLog.details,
      clientName: clients.fullName,
      clientFile: clients.fileNo,
      dealId: deals.id,
      dealClientName: dealClient.fullName,
      dealClientFile: dealClient.fileNo,
      aboutUserName: aboutUser.name,
      productName: products.name,
    })
    .from(auditLog)
    .leftJoin(actor, eq(actor.id, auditLog.userId))
    .leftJoin(clients, and(eq(auditLog.entity, "client"), eq(clients.id, auditLog.entityId)))
    .leftJoin(deals, and(eq(auditLog.entity, "deal"), eq(deals.id, auditLog.entityId)))
    .leftJoin(dealClient, eq(dealClient.id, deals.clientId))
    .leftJoin(aboutUser, and(eq(auditLog.entity, "user"), eq(aboutUser.id, auditLog.entityId)))
    .leftJoin(products, and(eq(auditLog.entity, "product"), eq(products.id, auditLog.entityId)))
    .where(
      and(
        query.area ? inArray(auditLog.action, [...AUDIT_AREAS[query.area]]) : undefined,
        query.watched ? inArray(auditLog.action, [...WATCHED_ACTIONS]) : undefined,
        query.userId != null ? eq(auditLog.userId, query.userId) : undefined,
        query.before != null ? lt(auditLog.id, query.before) : undefined,
      ),
    )
    .orderBy(desc(auditLog.id))
    .limit(limit + 1);

  const lines = rows.slice(0, limit).map((row): AuditLine => {
    let subject: AuditSubject | null = null;
    if (row.entityId != null) {
      if (row.clientName != null) subject = { kind: "client", id: row.entityId, name: row.clientName, fileNo: row.clientFile ?? "" };
      else if (row.dealId != null && row.dealClientName != null) subject = { kind: "deal", id: row.dealId, name: row.dealClientName, fileNo: row.dealClientFile ?? "" };
      else if (row.aboutUserName != null) subject = { kind: "user", id: row.entityId, name: row.aboutUserName };
      else if (row.productName != null) subject = { kind: "product", id: row.entityId, name: row.productName };
    }
    return {
      id: row.id,
      at: row.at,
      action: row.action,
      who: row.userId != null && row.actorName != null ? { id: row.userId, name: row.actorName } : null,
      ip: row.ip,
      subject,
      details: row.details ?? {},
    };
  });
  return { lines, next: rows.length > limit ? lines[lines.length - 1]!.id : null };
}

/** Everyone who has an account, for choosing whose events to read. */
export async function auditPeople(db: Db): Promise<{ id: number; name: string }[]> {
  return db.select({ id: users.id, name: users.name }).from(users).orderBy(users.name, users.id);
}
