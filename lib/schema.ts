// مخطط قاعدة البيانات (SQL قريب من PostgreSQL)
// أعمدة أضيفت بعد v0.1 — تُطبق على القواعد القديمة
export const ADD_COLUMNS: [string, string, string][] = [
  ["clients", "property_value", "REAL"],
  ["clients", "co_income", "REAL"],
  ["clients", "extra", "TEXT"],
];
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','analyst','officer','viewer')),
  active INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS lenders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('bank','finance_company')),
  bank_code TEXT,
  contact TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lender_id INTEGER NOT NULL REFERENCES lenders(id) ON DELETE CASCADE,
  finance_type TEXT NOT NULL,
  name TEXT NOT NULL,
  min_salary REAL NOT NULL DEFAULT 4000,
  min_age INTEGER NOT NULL DEFAULT 20,
  max_age_at_maturity INTEGER NOT NULL DEFAULT 60,
  min_service_months INTEGER NOT NULL DEFAULT 3,
  sectors TEXT NOT NULL,
  nationalities TEXT NOT NULL DEFAULT '["saudi"]',
  max_tenor INTEGER NOT NULL DEFAULT 60,
  max_amount REAL NOT NULL DEFAULT 500000,
  rate REAL NOT NULL,
  rate_type TEXT NOT NULL DEFAULT 'flat',
  requires_salary_transfer INTEGER NOT NULL DEFAULT 1,
  accepts_late_simah INTEGER NOT NULL DEFAULT 0,
  max_ltv REAL,
  notes TEXT,
  verified_at TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_no TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  national_id TEXT,
  phone TEXT,
  email TEXT,
  birth_year INTEGER,
  nationality TEXT NOT NULL DEFAULT 'saudi',
  marital_status TEXT,
  dependents INTEGER,
  city TEXT,
  employer TEXT,
  sector TEXT NOT NULL DEFAULT 'gov',
  job_title TEXT,
  service_months INTEGER,
  basic_salary REAL,
  total_salary REAL,
  other_income REAL,
  salary_bank TEXT,
  simah TEXT NOT NULL DEFAULT 'unknown',
  owns_home INTEGER,
  housing_support INTEGER NOT NULL DEFAULT 0,
  property_value REAL,
  co_income REAL,
  extra TEXT,
  finance_type TEXT NOT NULL DEFAULT 'personal',
  requested_amount REAL,
  requested_tenor INTEGER,
  purpose TEXT,
  priority TEXT,
  status TEXT NOT NULL DEFAULT 'study',
  eligibility TEXT NOT NULL DEFAULT 'pending',
  next_step TEXT,
  next_step_due TEXT,
  owner_id INTEGER REFERENCES users(id),
  source TEXT,
  consent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS obligations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  lender TEXT,
  monthly REAL NOT NULL,
  remaining REAL,
  end_date TEXT
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  category TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'missing' CHECK (status IN ('missing','received','verified','rejected')),
  file_name TEXT,
  stored_name TEXT,
  mime TEXT,
  size INTEGER,
  sha256 TEXT,
  note TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_at TEXT
);
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  lender_id INTEGER REFERENCES lenders(id),
  product_name TEXT,
  amount REAL,
  tenor INTEGER,
  installment REAL,
  ref_no TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  submitted_at TEXT,
  decided_at TEXT,
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'note',
  body TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS studies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  analyst_opinion TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  details TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER REFERENCES applications(id) ON DELETE SET NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  lender_id INTEGER NOT NULL REFERENCES lenders(id) ON DELETE CASCADE,
  finance_type TEXT NOT NULL,
  sector TEXT NOT NULL,
  salary REAL,
  age INTEGER,
  simah TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('approved','approved_modified','rejected')),
  requested_amount REAL,
  estimated_amount REAL,
  approved_amount REAL,
  approved_rate REAL,
  approved_tenor INTEGER,
  conditions TEXT NOT NULL DEFAULT '[]',
  reason TEXT,
  note TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS lender_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lender_id INTEGER REFERENCES lenders(id) ON DELETE CASCADE,
  finance_type TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('condition','exception','tip','warning')),
  title TEXT NOT NULL,
  body TEXT,
  user_id INTEGER REFERENCES users(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS file_blobs (
  doc_id INTEGER PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  data BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS credit_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  report TEXT NOT NULL,
  grade TEXT,
  derived_simah TEXT,
  doc_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_credit_client ON credit_reports(client_id);
CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'study',
  data TEXT NOT NULL,
  stage_log TEXT NOT NULL DEFAULT '[]',
  capital REAL,
  fee REAL,
  client_net REAL,
  verdict TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_outcomes_lender ON outcomes(lender_id, finance_type);
CREATE INDEX IF NOT EXISTS idx_docs_client ON documents(client_id);
CREATE INDEX IF NOT EXISTS idx_apps_client ON applications(client_id);
CREATE INDEX IF NOT EXISTS idx_notes_client ON notes(client_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);
`;

// ===== الترجمة إلى PostgreSQL =====
const PG_NOW = "to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')";
/** يحوّل استعلاماً مكتوباً بصيغة SQLite إلى PostgreSQL: ? → $n، دوال التاريخ، LIKE */
export function toPg(sql: string): string {
  let out = "";
  let n = 0;
  let q: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (q) { out += ch; if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"') { q = ch; out += ch; continue; }
    if (ch === "?") { out += `$${++n}`; continue; }
    out += ch;
  }
  return out
    .replace(/datetime\('now'\)/g, PG_NOW)
    .replace(/datetime\('now',\s*'([+-]\d+) (minutes|days|hours)'\)/g, (_, a, u) => `to_char(now() at time zone 'utc' + interval '${a} ${u}', 'YYYY-MM-DD HH24:MI:SS')`)
    .replace(/date\('now'\)/g, "to_char(now() at time zone 'utc', 'YYYY-MM-DD')")
    .replace(/\bLIKE\b/g, "ILIKE");
}

/** مخطط PostgreSQL مشتق من مخطط SQLite + حماية من واجهات Supabase العامة (RLS بلا سياسات = منع كامل) */
export function pgSchema(supabase = true): string {
  const base = SCHEMA
    .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, "INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY")
    .replace(/\bREAL\b/g, "DOUBLE PRECISION")
    .replace(/\bBLOB\b/g, "BYTEA")
    .replace(/DEFAULT \(datetime\('now'\)\)/g, `DEFAULT (${PG_NOW})`);
  const tables = [...SCHEMA.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
  const cols = ADD_COLUMNS.map(([t, c, type]) => `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS ${c} ${type === "REAL" ? "DOUBLE PRECISION" : type};`).join("\n");
  const rls = tables.map((t) => `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`).join("\n");
  const lock = tables.map((t) => `REVOKE ALL ON TABLE ${t} FROM anon, authenticated;`).join("\n");
  return `${base}\n${cols}\n${supabase ? `${rls}\n${lock}\n` : ""}`;
}
