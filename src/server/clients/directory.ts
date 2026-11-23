import "server-only";
import { and, count, desc, eq, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { Stage, Structure, Verdict } from "@/domain/deal";
import { digitsOf } from "@/domain/shared/phone";
import { FOLD_DROP, FOLD_FROM, FOLD_TO, foldText } from "@/domain/shared/text";
import type { Db } from "../db/client";
import { clients, deals, notes, users } from "../db/schema";
import type { ClientRow } from "./service";

/** One person in the list of everyone the office opened a file for. */
export interface DirectoryRow {
  id: number;
  fileNo: string;
  name: string;
  phone: string | null;
  employer: string | null;
  city: string | null;
  /** Their newest deal. Null for a file with no deal. */
  deal: { id: number; stage: Stage; structure: Structure; verdict: Verdict | null } | null;
  /** When the file last moved: its newest deal's last change, or its own. */
  movedAt: Date;
}

/** A column as a search compares it: see `foldText`, which does the same to what was typed. */
const folded = (column: AnyColumn): SQL => sql`translate(lower(coalesce(${column}, '')), ${FOLD_FROM + FOLD_DROP}, ${FOLD_TO})`;

/** What was typed, safe inside a LIKE pattern. */
const like = (text: string): string => `%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

const newestDeal = sql`(select max(d.id) from ${deals} d where d.client_id = ${clients.id})`;

/**
 * Everyone with a file, the most recently moved first. A search reads a name, an employer, a file
 * number or, for those allowed to see phone numbers, part of a mobile number. Every word typed must
 * be found somewhere.
 */
export async function listClients(db: Db, args: { q?: string | null; byPhone?: boolean; limit?: number } = {}): Promise<{ rows: DirectoryRow[]; total: number }> {
  const words = foldText(args.q ?? "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 6);
  const filters = words.map((word) => {
    const ways: SQL[] = [sql`${folded(clients.fullName)} like ${like(word)}`, sql`${folded(clients.employer)} like ${like(word)}`, sql`lower(${clients.fileNo}) like ${like(word)}`];
    // A number may be typed 05…, 5… or 9665…; all three end the same way.
    const digits = digitsOf(word).replace(/^(00)?966(?=5)/, "").replace(/^0(?=5)/, "");
    if (args.byPhone && digits.length >= 4) ways.push(sql`regexp_replace(coalesce(${clients.phone}, ''), '[^0-9]', '', 'g') like ${`%${digits}%`}`);
    return or(...ways)!;
  });
  const where = filters.length ? and(...filters) : undefined;

  const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(clients).where(where);
  const movedAt = sql<Date>`coalesce(${deals.updatedAt}, ${clients.updatedAt})`;
  const found = await db
    .select({
      id: clients.id,
      fileNo: clients.fileNo,
      name: clients.fullName,
      phone: clients.phone,
      employer: clients.employer,
      city: clients.city,
      dealId: deals.id,
      stage: deals.stage,
      structure: deals.structure,
      verdict: deals.verdict,
      dealAt: deals.updatedAt,
      clientAt: clients.updatedAt,
    })
    .from(clients)
    .leftJoin(deals, eq(deals.id, newestDeal))
    .where(where)
    .orderBy(desc(movedAt), desc(clients.id))
    .limit(args.limit ?? 60);

  return {
    total,
    rows: found.map((row) => ({
      id: row.id,
      fileNo: row.fileNo,
      name: row.name,
      phone: row.phone,
      employer: row.employer,
      city: row.city,
      deal: row.dealId != null && row.stage && row.structure ? { id: row.dealId, stage: row.stage, structure: row.structure, verdict: row.verdict } : null,
      movedAt: row.dealAt ?? row.clientAt,
    })),
  };
}

/** A deal as a person's file lists it. */
export interface CardDeal {
  id: number;
  stage: Stage;
  structure: Structure;
  verdict: Verdict | null;
  capital: number | null;
  fee: number | null;
  clientNet: number | null;
  startedAt: Date;
  movedAt: Date;
}

/** A line on a person's file: a note someone left, or why the file was rejected or reopened. */
export interface CardNote {
  id: number;
  kind: string;
  body: string;
  by: string | null;
  at: Date;
}

/** A person's file: who they are, every deal they had, and what was noted along the way. */
export interface ClientCard {
  client: ClientRow;
  /** Newest first. */
  deals: CardDeal[];
  /** Newest first. */
  notes: CardNote[];
}

export async function getClientCard(db: Db, clientId: number): Promise<ClientCard | null> {
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!client) return null;
  const had = await db
    .select({
      id: deals.id,
      stage: deals.stage,
      structure: deals.structure,
      verdict: deals.verdict,
      capital: deals.capital,
      fee: deals.fee,
      clientNet: deals.clientNet,
      startedAt: deals.createdAt,
      movedAt: deals.updatedAt,
    })
    .from(deals)
    .where(eq(deals.clientId, clientId))
    .orderBy(desc(deals.id));
  const noted = await db
    .select({ id: notes.id, kind: notes.kind, body: notes.body, by: users.name, at: notes.createdAt })
    .from(notes)
    .leftJoin(users, eq(users.id, notes.userId))
    .where(eq(notes.clientId, clientId))
    .orderBy(desc(notes.id))
    .limit(40);
  return { client, deals: had, notes: noted };
}
