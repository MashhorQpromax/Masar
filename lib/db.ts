import "server-only";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { SCHEMA, ADD_COLUMNS } from "./schema";

// طبقة بيانات بسيطة فوق SQLite المدمج في Node.
// المخطط مكتوب بـ SQL قياسي قريب من PostgreSQL ليسهل الانتقال إلى Supabase لاحقاً.

// على Vercel: نظام الملفات للقراءة فقط عدا /tmp — ننسخ قاعدة البيانات التجريبية المضمّنة عند أول تشغيل.
// تنبيه: بيانات /tmp مؤقتة وتعود للحالة التجريبية عند إعادة تشغيل الخادم (نسخة عرض فقط).
const ON_VERCEL = !!process.env.VERCEL;
const DATA_DIR = ON_VERCEL ? "/tmp/masar" : process.env.MASAR_DATA_DIR || path.join(process.cwd(), "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

const g = globalThis as unknown as { __masarDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (!g.__masarDb) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const file = path.join(DATA_DIR, "masar.db");
    if (ON_VERCEL && !fs.existsSync(file)) fs.copyFileSync(path.join(process.cwd(), "seed", "masar.db"), file);
    const d = new DatabaseSync(path.join(DATA_DIR, "masar.db"));
    d.exec(`PRAGMA journal_mode = ${ON_VERCEL ? "DELETE" : "WAL"}; PRAGMA foreign_keys = ON;`);
    migrate(d);
    g.__masarDb = d;
  }
  return g.__masarDb;
}


function migrate(d: DatabaseSync) {
  for (const [t, c, type] of ADD_COLUMNS) {
    const cols = d.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[];
    if (cols.length && !cols.some((x) => x.name === c)) d.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${type}`);
  }
  d.exec(SCHEMA);
}

type Row = Record<string, unknown>;
export function all<T = Row>(sql: string, ...params: unknown[]): T[] {
  return db().prepare(sql).all(...(params as never[])) as T[];
}
export function get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
  return db().prepare(sql).get(...(params as never[])) as T | undefined;
}
export function run(sql: string, ...params: unknown[]) {
  return db().prepare(sql).run(...(params as never[]));
}
export function tx<T>(fn: () => T): T {
  const d = db();
  d.exec("BEGIN");
  try {
    const r = fn();
    d.exec("COMMIT");
    return r;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}
