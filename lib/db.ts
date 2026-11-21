import "server-only";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { SCHEMA, ADD_COLUMNS, pgSchema, toPg } from "./schema";
import { LENDERS, PRODUCTS, RULES } from "./base-data";

// طبقة بيانات موحّدة (غير متزامنة) بمحرّكين:
// - PostgreSQL (Supabase) عند وجود DATABASE_URL أو POSTGRES_URL — للإنتاج، بيانات دائمة.
// - SQLite المدمج في Node محلياً عند غياب الرابط — للتطوير.
// الاستعلامات تُكتب مرة واحدة بصيغة SQLite (?) وتُترجم آلياً لـ PostgreSQL.

type Row = Record<string, unknown>;
export interface RunResult { lastInsertRowid: number; changes: number }
export interface Q {
  all<T = Row>(sql: string, ...params: unknown[]): Promise<T[]>;
  get<T = Row>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  run(sql: string, ...params: unknown[]): Promise<RunResult>;
}
interface Driver extends Q { tx<T>(fn: (q: Q) => Promise<T>): Promise<T>; kind: "pg" | "sqlite" }

const PG_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
export const DB_KIND: "pg" | "sqlite" = PG_URL ? "pg" : "sqlite";

const g = globalThis as unknown as { __masarDriver?: Promise<Driver> };
function driver(): Promise<Driver> {
  if (!g.__masarDriver) g.__masarDriver = (DB_KIND === "pg" ? pgDriver(PG_URL) : sqliteDriver()).catch((e) => { g.__masarDriver = undefined; throw e; });
  return g.__masarDriver;
}

export const all = async <T = Row>(sql: string, ...p: unknown[]) => (await driver()).all<T>(sql, ...p);
export const get = async <T = Row>(sql: string, ...p: unknown[]) => (await driver()).get<T>(sql, ...p);
export const run = async (sql: string, ...p: unknown[]) => (await driver()).run(sql, ...p);
export const tx = async <T>(fn: (q: Q) => Promise<T>) => (await driver()).tx(fn);

// ===== PostgreSQL =====
const NO_ID = new Set(["sessions", "file_blobs"]);
function withReturning(sql: string) {
  const m = /^\s*INSERT\s+INTO\s+(\w+)/i.exec(sql);
  return m && !NO_ID.has(m[1]) && !/RETURNING/i.test(sql) ? `${sql} RETURNING id` : sql;
}
const num = (v: unknown) => (v == null ? v : Number(v));

async function pgDriver(url: string): Promise<Driver> {
  let exec: (sql: string, params: unknown[]) => Promise<{ rows: Row[]; count: number }>;
  let begin: <T>(fn: (e: typeof exec) => Promise<T>) => Promise<T>;
  if (url.startsWith("pglite:")) {
    // للاختبار المحلي على PostgreSQL حقيقي (مدمج) دون خادم
    const { PGlite } = await import("@electric-sql/pglite");
    const dir = url.slice(7);
    const pg = new PGlite(dir || undefined, { parsers: { 20: num, 1700: num } });
    const mk = (c: { query: typeof pg.query }) => async (sql: string, params: unknown[]) => {
      const r = await c.query<Row>(sql, params);
      return { rows: r.rows, count: r.affectedRows ?? 0 };
    };
    exec = mk(pg);
    begin = (fn) => pg.transaction((t) => fn(mk(t as unknown as { query: typeof pg.query })));
  } else {
    const { default: postgres } = await import("postgres");
    const sql = postgres(url, {
      prepare: false, // متوافق مع مُجمّع الاتصالات (Supavisor transaction mode)
      max: 3,
      idle_timeout: 20,
      ssl: /localhost|127\.0\.0\.1/.test(url) ? false : "require",
      types: {
        bigint: { to: 20, from: [20], parse: (x: string) => Number(x), serialize: (x: number) => String(x) },
        numeric: { to: 1700, from: [1700], parse: (x: string) => Number(x), serialize: (x: number) => String(x) },
      },
      transform: { undefined: null },
    });
    const mk = (c: typeof sql) => async (q: string, params: unknown[]) => {
      const r = await c.unsafe(q, params as never[]);
      return { rows: r as unknown as Row[], count: r.count ?? 0 };
    };
    exec = mk(sql);
    begin = (fn) => sql.begin((t) => fn(mk(t as unknown as typeof sql))) as never;
  }
  const q = (e: typeof exec): Q => ({
    async all<T>(s: string, ...p: unknown[]) { return (await e(toPg(s), p)).rows as T[]; },
    async get<T>(s: string, ...p: unknown[]) { return (await e(toPg(s), p)).rows[0] as T | undefined; },
    async run(s: string, ...p: unknown[]) {
      const r = await e(withReturning(toPg(s)), p);
      return { lastInsertRowid: Number(r.rows[0]?.id ?? 0), changes: r.count };
    },
  });
  // إنشاء/ترقية المخطط مرة لكل نسخة خادم (آمن للتكرار)
  const ddl = pgSchema(!url.startsWith("pglite:"));
  const ver = crypto.createHash("sha1").update(ddl).digest("hex").slice(0, 12);
  await exec("CREATE TABLE IF NOT EXISTS schema_meta (version TEXT PRIMARY KEY)", []);
  if (!(await exec("SELECT 1 FROM schema_meta WHERE version = $1", [ver])).rows.length) {
    for (const st of ddl.split(/;\s*\n/)) if (st.trim()) await exec(st, []);
    await exec("ALTER TABLE schema_meta ENABLE ROW LEVEL SECURITY", []);
    await exec("INSERT INTO schema_meta (version) VALUES ($1) ON CONFLICT DO NOTHING", [ver]);
  }
  const d: Driver = { kind: "pg", ...q(exec), tx: (fn) => begin((e) => fn(q(e))) };
  await seedBase(d);
  return d;
}
// ===== SQLite (محلي) =====
const ON_VERCEL = !!process.env.VERCEL;
const DATA_DIR = ON_VERCEL ? "/tmp/masar" : process.env.MASAR_DATA_DIR || path.join(process.cwd(), "data");

async function sqliteDriver(): Promise<Driver> {
  const { DatabaseSync } = await import("node:sqlite");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, "masar.db");
  if (ON_VERCEL && !fs.existsSync(file)) fs.copyFileSync(path.join(process.cwd(), "seed", "masar.db"), file);
  const d = new DatabaseSync(file);
  d.exec(`PRAGMA journal_mode = ${ON_VERCEL ? "DELETE" : "WAL"}; PRAGMA foreign_keys = ON;`);
  for (const [t, c, type] of ADD_COLUMNS) {
    const cols = d.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[];
    if (cols.length && !cols.some((x) => x.name === c)) d.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${type}`);
  }
  d.exec(SCHEMA);
  const q: Q = {
    async all<T>(s: string, ...p: unknown[]) { return d.prepare(s).all(...(p as never[])) as T[]; },
    async get<T>(s: string, ...p: unknown[]) { return d.prepare(s).get(...(p as never[])) as T | undefined; },
    async run(s: string, ...p: unknown[]) {
      const r = d.prepare(s).run(...(p as never[]));
      return { lastInsertRowid: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
  };
  let chain: Promise<unknown> = Promise.resolve();
  const drv: Driver = {
    kind: "sqlite",
    ...q,
    tx<T>(fn: (q: Q) => Promise<T>) {
      // اتصال واحد: نسلسل المعاملات
      const p = chain.then(async () => {
        d.exec("BEGIN");
        try { const r = await fn(q); d.exec("COMMIT"); return r; } catch (e) { d.exec("ROLLBACK"); throw e; }
      });
      chain = p.catch(() => {});
      return p;
    },
  };
  await seedBase(drv);
  return drv;
}

/** قاعدة جديدة فارغة: نضيف الجهات والمنتجات وقواعد السوق الأساسية فقط (بلا عملاء ولا مستخدمين) */
async function seedBase(d: Driver) {
  // أول مدير: من متغيرات البيئة (البصمة فقط، لا كلمة مرور صريحة) عند خلو جدول المستخدمين
  const adminEmail = process.env.MASAR_ADMIN_EMAIL, adminHash = process.env.MASAR_ADMIN_HASH;
  if (adminEmail && adminHash && !(await d.get("SELECT id FROM users LIMIT 1")))
    await d.run("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')", process.env.MASAR_ADMIN_NAME || "مدير النظام", adminEmail.toLowerCase(), adminHash);
  const n = await d.get<{ n: number }>("SELECT COUNT(*) n FROM lenders");
  if (n && n.n > 0) return;
  await d.tx(async (q) => {
    const lid: Record<string, number> = {};
    for (const [name, type, code] of LENDERS) lid[name] = (await q.run("INSERT INTO lenders (name, type, bank_code) VALUES (?, ?, ?)", name, type, code)).lastInsertRowid;
    for (const p of PRODUCTS)
      await q.run(
        `INSERT INTO products (lender_id, finance_type, name, min_salary, min_age, max_age_at_maturity, min_service_months, sectors, nationalities,
         max_tenor, max_amount, rate, rate_type, requires_salary_transfer, accepts_late_simah, max_ltv, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        lid[p.l], p.t, p.n, p.minSal, p.minAge ?? 21, p.maxAge, p.svc, JSON.stringify(p.sectors), JSON.stringify(p.nat ?? ["saudi"]), p.tenor, p.max, p.rate,
        p.rt ?? "flat", p.transfer === false ? 0 : 1, p.late ? 1 : 0, p.ltv ?? null, "معايير تقديرية من المصادر العامة — حدّثها من سياسة الجهة الفعلية",
      );
    for (const r of RULES)
      if (!r[0] || lid[r[0]]) await q.run("INSERT INTO lender_rules (lender_id, finance_type, kind, title, body) VALUES (?,?,?,?,?)", r[0] ? lid[r[0]] : null, r[1], r[2], r[3], r[4]);
  });
}
