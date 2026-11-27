import "server-only";
import { createHash } from "node:crypto";

/**
 * The old system's data, read as it is stored.
 *
 * The old application kept everything in the `public` schema, in the shapes SQLite gave it: times as
 * text in UTC, yes and no as 0 and 1, lists and objects as JSON text. Nothing here interprets a value.
 * This module only reads. It is deleted with `legacy/` once the switch is done.
 */
export type LegacyRow = Record<string, unknown>;

/** Runs one statement on the old database and returns its rows. */
export type LegacyQuery = (sql: string) => Promise<LegacyRow[]>;

/** The old tables that hold something worth keeping, in the order they are read. */
export const LEGACY_TABLES = [
  "users",
  "passkeys",
  "lenders",
  "products",
  "lender_rules",
  "clients",
  "obligations",
  "documents",
  "credit_reports",
  "applications",
  "outcomes",
  "notes",
  "studies",
  "deals",
  "wa_messages",
  "share_links",
  "audit_log",
] as const;
export type LegacyTable = (typeof LEGACY_TABLES)[number];

/**
 * Old tables left behind on purpose. A session and a one-time code live for hours: everyone signs in
 * once more after the switch. File contents are read one at a time, beside the paper they belong to.
 */
export const LEGACY_LEFT = ["sessions", "login_codes"] as const;

/** What a table held at one moment: how many rows, and a fingerprint of everything in them. */
export interface TableMark {
  rows: number;
  print: string;
}

/** The name the stored files' mark goes by, beside the tables'. */
const FILES_MARK = "file_blobs";

export interface LegacyData {
  tables: Record<LegacyTable, LegacyRow[]>;
  /** A mark of every table read, and one of the stored files. Two reads with the same marks read the same data. */
  marks: Record<string, TableMark>;
  /** Tables of the list above that the old database does not have. They are read as empty. */
  absent: LegacyTable[];
  /** The size in bytes of each stored file, by the id of its old document row. */
  blobSizes: Map<number, number>;
  /** How many rows the tables left behind hold, for the report. */
  left: Record<(typeof LEGACY_LEFT)[number], number>;
}

const asNumber = (value: unknown): number => Number(value);

function markOf(rows: unknown[]): TableMark {
  // A driver may hand a large number over as a bigint, which has no JSON form of its own.
  const text = JSON.stringify(rows, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value));
  return { rows: rows.length, print: createHash("sha256").update(text).digest("hex").slice(0, 32) };
}

/** Reads every old table in full. Call it inside one read-only transaction so the copy is of one moment. */
export async function readLegacy(query: LegacyQuery): Promise<LegacyData> {
  const present = new Set((await query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).map((row) => String(row.table_name)));

  const tables = {} as Record<LegacyTable, LegacyRow[]>;
  const absent: LegacyTable[] = [];
  for (const table of LEGACY_TABLES) {
    if (!present.has(table)) {
      tables[table] = [];
      absent.push(table);
      continue;
    }
    tables[table] = await query(`SELECT * FROM public.${table} ORDER BY id`);
  }
  const marks: Record<string, TableMark> = {};
  for (const table of LEGACY_TABLES) marks[table] = markOf(tables[table]);

  const blobSizes = new Map<number, number>();
  if (present.has("file_blobs")) {
    for (const row of await query("SELECT doc_id, octet_length(data) AS size FROM public.file_blobs ORDER BY doc_id")) blobSizes.set(asNumber(row.doc_id), asNumber(row.size));
  }
  // A file's content is held against its own fingerprint when it is read. Here it is enough to know which files there are, and how large.
  marks[FILES_MARK] = markOf([...blobSizes]);

  const left = { sessions: 0, login_codes: 0 };
  for (const table of LEGACY_LEFT) {
    if (present.has(table)) left[table] = asNumber((await query(`SELECT count(*) AS n FROM public.${table}`))[0]?.n ?? 0);
  }
  return { tables, marks, absent, blobSizes, left };
}

/** The bytes of one stored file. Null when the old database holds none for that document. */
export async function readBlob(query: LegacyQuery, docId: number): Promise<Uint8Array | null> {
  if (!Number.isInteger(docId)) throw new Error(`bad document id ${docId}`);
  const [row] = await query(`SELECT data FROM public.file_blobs WHERE doc_id = ${docId}`);
  const data = row?.data;
  if (data == null) return null;
  return data instanceof Uint8Array ? new Uint8Array(data) : null;
}
