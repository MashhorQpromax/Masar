import "server-only";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Schema = typeof schema;

/** The database handle every repository receives. Works the same on Postgres and on PGlite. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

/** A handle that is either the database or an open transaction on it. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0] | Db;

const MIGRATIONS = {
  migrationsFolder: path.join(process.cwd(), "db/migrations"),
  migrationsSchema: "masar",
  migrationsTable: "schema_migrations",
};

export interface Connection {
  db: Db;
  migrate: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Opens a connection.
 *
 * - `postgres://...` connects to a Postgres server.
 * - `pglite:` opens an in-process Postgres in memory, and `pglite:<dir>` one stored in a folder.
 *   Used by tests and local development, so neither needs a server.
 */
export async function connect(url: string): Promise<Connection> {
  if (url.startsWith("pglite:")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const dir = url.slice("pglite:".length);
    const client = new PGlite(dir || undefined);
    const db = drizzle({ client, schema, casing: "snake_case" });
    return { db: db as unknown as Db, migrate: () => migrate(db, MIGRATIONS), close: () => client.close() };
  }
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  // `prepare: false` is required behind a transaction pooler such as Supabase's.
  // A server that is not on this machine is only ever spoken to over TLS, whatever the address says.
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
  const client = postgres(url, { prepare: false, max: 5, idle_timeout: 20, ssl: local ? false : "require", onnotice: () => {} });
  const db = drizzle({ client, schema, casing: "snake_case" });
  return { db: db as unknown as Db, migrate: () => migrate(db, MIGRATIONS), close: () => client.end({ timeout: 5 }) };
}

/**
 * Where the running app gets its data.
 *
 * - `live`: the Postgres database named by MASAR_DATABASE_URL.
 * - `demo`: no database is configured, so the app runs on an in-memory Postgres filled with
 *   fictional deals. Nothing is stored and nothing real is shown. Never allowed in production.
 *
 * The rebuild reads its own variable on purpose. It never falls back to DATABASE_URL or POSTGRES_URL,
 * so a preview deployment cannot attach itself to the live database by accident.
 */
export type DataMode = "live" | "demo";

export function dataMode(): DataMode {
  if (process.env.MASAR_DATABASE_URL) return "live";
  if (process.env.VERCEL_ENV === "production") throw new Error("MASAR_DATABASE_URL is not set");
  return "demo";
}

/** The configured database. Used by the migration script, which must never run on demo data. */
export function databaseUrl(): string {
  const url = process.env.MASAR_DATABASE_URL;
  if (!url) throw new Error("MASAR_DATABASE_URL is not set");
  return url;
}

async function open(): Promise<Connection> {
  if (dataMode() === "live") {
    // Real accounts need the application secret. Refuse to start without it, instead of failing at the first sign-in that uses it.
    if ((process.env.MASAR_SECRET ?? "").length < 16) throw new Error("MASAR_SECRET is not set");
    return connect(databaseUrl());
  }
  const connection = await connect("pglite:");
  await connection.migrate();
  const { seedDemo } = await import("../demo/seed");
  const { seedDemoLenders, seedDemoReplies } = await import("../demo/lenders");
  const { seedDemoApprovals, seedDemoPlans } = await import("../demo/approvals");
  const { seedDemoContacts, seedDemoRequests } = await import("../demo/requests");
  const now = new Date();
  await seedDemo(connection.db, now);
  await seedDemoLenders(connection.db, now);
  await seedDemoContacts(connection.db, now);
  // The request goes out from an approved file, and the bank's answer is written on it.
  await seedDemoApprovals(connection.db, now);
  await seedDemoRequests(connection.db, now);
  await seedDemoReplies(connection.db, now);
  await seedDemoPlans(connection.db, now);
  return connection;
}

const globalForDb = globalThis as unknown as { masarConnection?: Promise<Connection> };

/** The shared connection of the running app. */
export async function getDb(): Promise<Db> {
  globalForDb.masarConnection ??= open().catch((error) => {
    globalForDb.masarConnection = undefined;
    throw error;
  });
  return (await globalForDb.masarConnection).db;
}
