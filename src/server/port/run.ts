import "server-only";
import { createHash } from "node:crypto";
import { desc, eq, getTableName, gt, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { fileKind } from "@/domain/documents";
import type { Db, Tx } from "../db/client";
import * as t from "../db/schema";
import { BASE_LENDERS } from "../lenders/base";
import { convert, type DealCheck, type Finding, type Ported } from "./convert";
import { LEGACY_TABLES, readBlob, readLegacy, type LegacyData, type LegacyQuery, type LegacyRow, type LegacyTable, type TableMark } from "./legacy";

/**
 * Moves the old system's data into this one.
 *
 * It reads the old tables, turns them into this system's rows, and checks what it can before a single
 * row is written: every stored file against its fingerprint, every deal's figures on this engine
 * beside the ones the old system stored, every authenticator secret against the application secret.
 * All of that looking happens inside read-only transactions, so the database itself refuses a write.
 * Without `write` it stops there and reports. With it, and with nothing standing in the way, everything
 * is written in one transaction: the move happens whole or not at all. Before that transaction closes
 * each new table is counted against what was meant to go into it and the old data is read once more:
 * a move that wrote something else, or whose source changed under it, is undone.
 *
 * The move leaves a mark of every old table in the log. Run again afterwards, it writes nothing and
 * says whether the old tables are still as they were: what is entered in the old system after the
 * move is not in this one.
 *
 * The old tables are only ever read.
 */
export interface PortArgs {
  /** Where the old tables are. May be the same database as `target`: the old ones live in `public`. */
  legacy: Db;
  target: Db;
  write: boolean;
  now: Date;
  /** Whether a sealed authenticator secret opens with the application secret. Left out, it is not checked. */
  opens?: (sealed: string) => boolean;
}

export interface TableCount {
  table: string;
  /** Rows in the old table. Null for a table this system adds. */
  old: number | null;
  /** Rows that come over. */
  moved: number;
}

export interface PortResult {
  wrote: boolean;
  counts: TableCount[];
  findings: Finding[];
  dealChecks: DealCheck[];
  /** Total size of the files that come over, in bytes. */
  fileBytes: number;
  /** Authenticator secrets held, and how many of them open. Null when it was not checked. */
  secrets: { held: number; opened: number } | null;
  /**
   * Set when the move was made before this run: when, what the old tables hold differently since, and
   * whether anyone has worked in this system since. Changes in the old tables after people moved over
   * are someone still using the old system; before that, they are data the move left behind.
   */
  moved: { at: Date; changed: string[]; usedSince: boolean } | null;
}

/** How everything that is only looked at is read: one moment of the data, and no write possible. */
const READING = { isolationLevel: "repeatable read", accessMode: "read only" } as const;

/** Runs old-style SQL on a handle and returns plain rows, whichever driver is underneath. */
export const queryOn =
  (db: Tx): LegacyQuery =>
  async (text) => {
    const result: unknown = await db.execute(sql.raw(text));
    const rows = Array.isArray(result) ? result : ((result as { rows?: unknown }).rows ?? []);
    return [...(rows as LegacyRow[])];
  };

/** Every table of this system, parents first. The move fills them in this order. */
const TARGET_TABLES: PgTable[] = [
  t.users,
  t.passkeys,
  t.lenders,
  t.products,
  t.lenderRules,
  t.clients,
  t.obligations,
  t.documents,
  t.documentFiles,
  t.fileBlobs,
  t.creditReports,
  t.applications,
  t.outcomes,
  t.notes,
  t.studies,
  t.deals,
  t.dealItems,
  t.dealStageEvents,
  t.waMessages,
  t.shareLinks,
  t.loginCodes,
  t.sessions,
  t.authSteps,
  t.auditLog,
];

/** Tables whose rows carry an id that the database hands out. Its counter is moved past the rows that came over. */
const COUNTED: PgTable[] = TARGET_TABLES.filter((table) => ![t.fileBlobs, t.sessions, t.authSteps].includes(table as never));

const CHUNK = 400;

async function insertAll<T extends PgTable>(tx: Tx, table: T, rows: T["$inferInsert"][]): Promise<void> {
  for (let start = 0; start < rows.length; start += CHUNK) await tx.insert(table).values(rows.slice(start, start + CHUNK));
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/**
 * Reads every stored file once and holds it against what the old row says about it. The fingerprint has
 * to match: a file that does not is not the file that was uploaded. What the bytes say the file is wins
 * over what the old row called it.
 */
async function checkFiles(query: LegacyQuery, ported: Ported): Promise<number> {
  let total = 0;
  for (const file of ported.files) {
    const bytes = await readBlob(query, file.from);
    if (!bytes) {
      ported.findings.push({ level: "stop", table: "documents", id: file.from, what: "the content of the file could not be read" });
      continue;
    }
    if (sha256(bytes) !== file.row.sha256) {
      ported.findings.push({ level: "stop", table: "documents", id: file.from, what: "the file does not match the fingerprint stored with it" });
      continue;
    }
    const kind = fileKind(bytes);
    if (!kind) ported.findings.push({ level: "note", table: "documents", id: file.from, what: `the file does not begin like a ${file.row.kind}; it comes over as the old system kept it` });
    else if (kind !== file.row.kind) file.row.kind = kind;
    file.row.size = bytes.length;
    total += bytes.length;
  }
  return total;
}

function countsOf(legacy: LegacyData, ported: Ported): TableCount[] {
  const old = (table: LegacyTable): number => legacy.tables[table].length;
  return [
    { table: "users", old: old("users"), moved: ported.users.length },
    { table: "passkeys", old: old("passkeys"), moved: ported.passkeys.length },
    { table: "lenders", old: old("lenders"), moved: ported.lenders.length },
    { table: "products", old: old("products"), moved: ported.products.length },
    { table: "lender_rules", old: old("lender_rules"), moved: ported.lenderRules.length },
    { table: "clients", old: old("clients"), moved: ported.clients.length },
    { table: "obligations", old: old("obligations"), moved: ported.obligations.length },
    { table: "documents", old: old("documents"), moved: ported.documents.length },
    { table: "document_files", old: legacy.blobSizes.size, moved: ported.files.length },
    { table: "credit_reports", old: old("credit_reports"), moved: ported.creditReports.length },
    { table: "applications", old: old("applications"), moved: ported.applications.length },
    { table: "outcomes", old: old("outcomes"), moved: ported.outcomes.length },
    { table: "notes", old: old("notes"), moved: ported.notes.length },
    { table: "studies", old: old("studies"), moved: ported.studies.length },
    { table: "deals", old: old("deals"), moved: ported.deals.length },
    { table: "deal_items", old: null, moved: ported.dealItems.length },
    { table: "deal_stage_events", old: null, moved: ported.dealStageEvents.length },
    { table: "wa_messages", old: old("wa_messages"), moved: ported.waMessages.length },
    { table: "share_links", old: old("share_links"), moved: 0 },
    { table: "sessions", old: legacy.left.sessions, moved: 0 },
    { table: "login_codes", old: legacy.left.login_codes, moved: 0 },
    { table: "audit_log", old: old("audit_log"), moved: ported.auditLog.length },
  ];
}

async function write(tx: Tx, ported: Ported, query: LegacyQuery, marks: Record<string, TableMark>, now: Date): Promise<void> {
  await insertAll(tx, t.users, ported.users);
  await insertAll(tx, t.passkeys, ported.passkeys);
  await insertAll(tx, t.lenders, ported.lenders);
  await insertAll(tx, t.products, ported.products);
  await insertAll(tx, t.lenderRules, ported.lenderRules);
  await insertAll(tx, t.clients, ported.clients);
  await insertAll(tx, t.obligations, ported.obligations);
  await insertAll(tx, t.documents, ported.documents);
  // Files go one at a time: a file's content is read from the old table, written, and let go of.
  for (const file of ported.files) {
    const bytes = await readBlob(query, file.from);
    if (!bytes || sha256(bytes) !== file.row.sha256) throw new Error(`file of old document ${file.from} changed while the move was running`);
    await tx.insert(t.documentFiles).values(file.row);
    await tx.insert(t.fileBlobs).values({ fileId: file.row.id, data: bytes });
  }
  await insertAll(tx, t.creditReports, ported.creditReports);
  await insertAll(tx, t.applications, ported.applications);
  await insertAll(tx, t.outcomes, ported.outcomes);
  await insertAll(tx, t.notes, ported.notes);
  await insertAll(tx, t.studies, ported.studies);
  await insertAll(tx, t.deals, ported.deals);
  await insertAll(tx, t.dealItems, ported.dealItems);
  await insertAll(tx, t.dealStageEvents, ported.dealStageEvents);
  await insertAll(tx, t.waMessages, ported.waMessages);
  await insertAll(tx, t.auditLog, ported.auditLog);

  // Every id came over as it was, so each table's counter still stands at its start. Move it past them.
  for (const table of COUNTED) {
    const name = `masar.${getTableName(table)}`;
    await tx.execute(sql.raw(`SELECT setval(pg_get_serial_sequence('${name}', 'id'), COALESCE((SELECT max(id) FROM ${name}), 0) + 1, false)`));
  }

  await tx.insert(t.auditLog).values({
    userId: null,
    action: "old.moved",
    details: { clients: ported.clients.length, deals: ported.deals.length, files: ported.files.length, events: ported.auditLog.length, marks },
    createdAt: now,
  });

  // What each table holds now has to be what was meant to go into it.
  const meant: [PgTable, number][] = [
    [t.users, ported.users.length],
    [t.passkeys, ported.passkeys.length],
    [t.lenders, ported.lenders.length],
    [t.products, ported.products.length],
    [t.lenderRules, ported.lenderRules.length],
    [t.clients, ported.clients.length],
    [t.obligations, ported.obligations.length],
    [t.documents, ported.documents.length],
    [t.documentFiles, ported.files.length],
    [t.fileBlobs, ported.files.length],
    [t.creditReports, ported.creditReports.length],
    [t.applications, ported.applications.length],
    [t.outcomes, ported.outcomes.length],
    [t.notes, ported.notes.length],
    [t.studies, ported.studies.length],
    [t.deals, ported.deals.length],
    [t.dealItems, ported.dealItems.length],
    [t.dealStageEvents, ported.dealStageEvents.length],
    [t.waMessages, ported.waMessages.length],
    [t.auditLog, ported.auditLog.length + 1],
  ];
  for (const [table, rows] of meant) {
    const held = await heldIn(tx, table);
    if (held !== rows) throw new Error(`masar.${getTableName(table)} holds ${held} rows after the move and ${rows} were meant to go in, so nothing was written`);
  }

  // The old system may have been in use while this ran. What it holds now has to be what was read.
  const after = (await readLegacy(query)).marks;
  const changed = differences(marks, after);
  if (changed.length) throw new Error(`the old data changed while the move was running, so nothing was written: ${changed.join("; ")}`);
}

const heldIn = async (db: Tx, table: PgTable): Promise<number> => Number((await queryOn(db)(`SELECT count(*) AS n FROM masar.${getTableName(table)}`))[0]?.n ?? 0);

/** Where two sets of marks part ways, table by table. */
function differences(then: Record<string, TableMark>, now: Record<string, TableMark>): string[] {
  const changed: string[] = [];
  for (const table of Object.keys(now)) {
    const before = then[table];
    const after = now[table]!;
    if (!before) changed.push(`${table}: it left no mark at the move`);
    else if (before.rows !== after.rows) changed.push(`${table}: ${before.rows} ${before.rows === 1 ? "row" : "rows"} then, ${after.rows} now`);
    else if (before.print !== after.print) changed.push(`${table}: rows were edited`);
  }
  return changed;
}

/** The marks an earlier move left in the log, read as found. */
function marksIn(details: unknown): Record<string, TableMark> {
  const held = details && typeof details === "object" ? (details as { marks?: unknown }).marks : null;
  const marks: Record<string, TableMark> = {};
  if (!held || typeof held !== "object") return marks;
  for (const [table, mark] of Object.entries(held as Record<string, unknown>)) {
    const { rows, print } = (mark ?? {}) as { rows?: unknown; print?: unknown };
    if (typeof rows === "number" && typeof print === "string") marks[table] = { rows, print };
  }
  return marks;
}

interface Seen {
  legacy: LegacyData;
  ported: Ported;
  result: PortResult;
}

/** Everything the move looks at before it writes. `old` and `fresh` are read-only transactions. */
async function inspect(old: Tx, fresh: Tx, args: PortArgs): Promise<Seen> {
  const legacy = await readLegacy(queryOn(old));
  const ported = convert(legacy, { now: args.now });
  const stop = (table: string, what: string) => ported.findings.push({ level: "stop", table, id: null, what });
  const note = (table: string, what: string) => ported.findings.push({ level: "note", table, id: null, what });

  for (const table of legacy.absent) note(table, "the old database has no such table; it is read as empty");
  for (const table of LEGACY_TABLES) {
    if (legacy.tables[table].some((row) => !Number.isInteger(Number(row.id)))) stop(table, "a row has no whole number for an id");
  }

  const fileBytes = await checkFiles(queryOn(old), ported);

  // The accounts' authenticator secrets are sealed with the application secret. With another secret they
  // stay shut, and everyone who uses an authenticator is locked out of it.
  let secrets: PortResult["secrets"] = null;
  const sealed = ported.users.flatMap((user) => (user.totpSecret ? [user.totpSecret] : []));
  if (args.opens) {
    secrets = { held: sealed.length, opened: sealed.filter((value) => args.opens!(value)).length };
    if (secrets.opened < secrets.held) stop("users", `${secrets.held - secrets.opened} of ${secrets.held} authenticator secrets do not open with MASAR_SECRET: it is not the secret the old system runs on`);
  } else if (sealed.length) {
    note("users", `${sealed.length} accounts use an authenticator and MASAR_SECRET was not given, so it was not checked that their secrets open`);
  }

  // The catalogue comes over as the office left it. What differs from this build's starting list is said.
  const live = new Set(ported.lenders.map((lender) => lender.name));
  const base = new Set(BASE_LENDERS.map((lender) => lender.name));
  const added = [...live].filter((name) => !base.has(name));
  const absent = [...base].filter((name) => !live.has(name));
  if (added.length) note("lenders", `lenders the office has that this build's starting list does not: ${added.join(", ")}`);
  if (absent.length) note("lenders", `lenders of this build's starting list that the office does not have: ${absent.join(", ")}`);

  const result: PortResult = { wrote: false, counts: countsOf(legacy, ported), findings: ported.findings, dealChecks: ported.dealChecks, fileBytes, secrets, moved: null };
  const seen = { legacy, ported, result };

  // A dry run asks nothing of the new database, not even that its tables exist. The move needs them.
  const [made] = await queryOn(fresh)("SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = 'masar' AND table_name = 'audit_log'");
  if (!Number(made?.n ?? 0)) {
    if (args.write) stop("masar", "the new tables are not there yet; run `npm run db:migrate` first");
    else note("masar", "the new tables are not there yet; `npm run db:migrate` makes them before the move");
    return seen;
  }

  // A move made earlier is not made again. What is left to say is whether the old tables stood still since.
  const [earlier] = await fresh.select({ id: t.auditLog.id, at: t.auditLog.createdAt, details: t.auditLog.details }).from(t.auditLog).where(eq(t.auditLog.action, "old.moved")).orderBy(desc(t.auditLog.id)).limit(1);
  if (earlier) {
    const [later] = await fresh.select({ id: t.auditLog.id }).from(t.auditLog).where(gt(t.auditLog.id, earlier.id)).limit(1);
    result.moved = { at: earlier.at, changed: differences(marksIn(earlier.details), legacy.marks), usedSince: later != null };
    return seen;
  }

  // Nothing is written over. The new tables have to be empty.
  for (const table of TARGET_TABLES) {
    const held = await heldIn(fresh, table);
    if (held > 0) stop(getTableName(table), `the new table already holds ${held} ${held === 1 ? "row" : "rows"}; the move only fills an empty database`);
  }
  return seen;
}

export async function portData(args: PortArgs): Promise<PortResult> {
  const { legacy, target, now } = args;
  const same = legacy === target;

  const seen = same
    ? await target.transaction((tx) => inspect(tx, tx, args), READING)
    : await legacy.transaction((old) => target.transaction((fresh) => inspect(old, fresh, args), READING), READING);
  const { result, ported } = seen;
  if (!args.write || result.moved || ported.findings.some((finding) => finding.level === "stop")) return result;

  // The move. On a database of its own the old data stays behind a read-only transaction here too.
  if (same) await target.transaction((tx) => write(tx, ported, queryOn(tx), seen.legacy.marks, now));
  else await legacy.transaction((old) => target.transaction((tx) => write(tx, ported, queryOn(old), seen.legacy.marks, now)), READING);
  return { ...result, wrote: true };
}

/** Whether the site may go live on this result: the data is in this system, and none of it was left behind. */
export function mayGoLive(result: PortResult): boolean {
  if (result.moved) return result.moved.changed.length === 0 || result.moved.usedSince;
  return result.wrote;
}

/**
 * An error in words fit for a log other people can read. The driver's own message repeats the failed
 * statement with every value in it, a client's name and number among them. The database's message
 * names the rule that was broken and the table, and that is what is kept.
 */
export function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
  if (!cause && !message.startsWith("Failed query")) return message;
  const table = /(?:insert into|from|update) "?(masar|public)"?\."?(\w+)"?/i.exec(message);
  return `the database refused a statement${table ? ` on ${table[1]}.${table[2]}` : ""}${cause ? `: ${cause}` : ""}`;
}

const amount = (value: number | null): string => (value == null ? "none" : Math.round(value).toLocaleString("en-US"));

/** The result in plain lines, for whoever runs the move. A rehearsal says so in its first line. */
export function reportLines(result: PortResult, as: { rehearsal?: boolean } = {}): string[] {
  const stops = result.findings.filter((finding) => finding.level === "stop");
  const notes = result.findings.filter((finding) => finding.level === "note");
  const where = (finding: Finding) => `${finding.table}${finding.id == null ? "" : ` ${finding.id}`}`;
  const lines: string[] = [];

  if (result.moved) {
    const { at, changed } = result.moved;
    lines.push(`ALREADY MOVED on ${at.toISOString().slice(0, 16).replace("T", " ")} UTC. Nothing was written.`, "");
    if (!changed.length) return [...lines, "Since the move, the old tables are as they were."];
    lines.push("Since the move, the old tables changed. What changed there is NOT in the new system:", ...changed.map((line) => `  ${line}`), "");
    lines.push(result.moved.usedSince ? "People have worked in the new system since the move, so this is someone still using the old one." : "Nobody has worked in the new system since the move. Empty its tables and move again before anyone does.");
    return lines;
  }

  const first = as.rehearsal
    ? result.wrote
      ? "REHEARSED. The whole move ran into a throwaway database. Nothing was written to a real one."
      : "REHEARSAL STOPPED. Nothing was written anywhere."
    : result.wrote
      ? "MOVED. Everything below was written."
      : stops.length
        ? "NOT READY. Nothing was written."
        : "READY. Nothing was written: this was a dry run.";
  lines.push(first, "");
  lines.push("Rows, old and moved:");
  for (const count of result.counts) lines.push(`  ${count.table.padEnd(18)} ${String(count.old ?? "").padStart(7)} ${String(count.moved).padStart(7)}`);
  lines.push(`  files hold ${(result.fileBytes / 1024 / 1024).toFixed(1)} MB`, "");

  if (result.secrets) lines.push(`Authenticator secrets: ${result.secrets.opened} of ${result.secrets.held} open with MASAR_SECRET.`, "");

  lines.push("Deals, the figures the old system stored beside this engine's on the same numbers:");
  if (!result.dealChecks.length) lines.push("  none");
  for (const check of result.dealChecks) {
    const near = (before: number | null, after: number) => before != null && Math.abs(before - after) < 1;
    const same = near(check.before.capital, check.now.capital) && near(check.before.fee, check.now.fee) && near(check.before.clientNet, check.now.clientNet) && check.before.verdict === check.now.verdict;
    lines.push(
      `  deal ${check.dealId} (client ${check.clientId}): ${same ? "the same" : "DIFFERS"}` +
        `  capital ${amount(check.before.capital)} / ${amount(check.now.capital)}` +
        `  fee ${amount(check.before.fee)} / ${amount(check.now.fee)}` +
        `  client keeps ${amount(check.before.clientNet)} / ${amount(check.now.clientNet)}` +
        `  verdict ${check.before.verdict ?? "none"} / ${check.now.verdict}`,
    );
  }
  lines.push("");

  lines.push(`In the way (${stops.length}):`);
  for (const finding of stops) lines.push(`  ${where(finding)}: ${finding.what}`);
  if (!stops.length) lines.push("  nothing");
  lines.push("", `Worth reading (${notes.length}):`);
  for (const finding of notes) lines.push(`  ${where(finding)}: ${finding.what}`);
  if (!notes.length) lines.push("  nothing");
  return lines;
}
