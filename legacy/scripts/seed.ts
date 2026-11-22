// تهيئة قاعدة بيانات محلية (SQLite) نظيفة: الجهات والمنتجات وقواعد السوق + حساب مدير واحد. بلا عملاء وهميين.
// الاستخدام: npm run seed   (يحذف قاعدة البيانات المحلية الحالية!)
// كلمة المرور: MASAR_ADMIN_PASSWORD أو تُولّد عشوائياً وتُطبع مرة واحدة.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { SCHEMA } from "../lib/schema.ts";
import { LENDERS, PRODUCTS, RULES } from "../lib/base-data.ts";

const dir = process.env.MASAR_DATA_DIR || path.join(process.cwd(), "data");
fs.mkdirSync(dir, { recursive: true });
for (const f of ["masar.db", "masar.db-wal", "masar.db-shm"]) fs.rmSync(path.join(dir, f), { force: true });
const db = new DatabaseSync(path.join(dir, "masar.db"));
db.exec("PRAGMA foreign_keys = ON;");
db.exec(SCHEMA);

const email = (process.env.MASAR_ADMIN_EMAIL || "admin@masar.local").toLowerCase();
const pw = process.env.MASAR_ADMIN_PASSWORD || crypto.randomBytes(9).toString("base64url");
db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')").run(process.env.MASAR_ADMIN_NAME || "مدير النظام", email, bcrypt.hashSync(pw, 12));

const lid: Record<string, number> = {};
const insL = db.prepare("INSERT INTO lenders (name, type, bank_code) VALUES (?, ?, ?)");
for (const [n, t, c] of LENDERS) lid[n] = Number(insL.run(n, t, c).lastInsertRowid);
const insP = db.prepare(`INSERT INTO products (lender_id, finance_type, name, min_salary, min_age, max_age_at_maturity, min_service_months, sectors, nationalities,
  max_tenor, max_amount, rate, rate_type, requires_salary_transfer, accepts_late_simah, max_ltv, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
for (const p of PRODUCTS)
  insP.run(lid[p.l], p.t, p.n, p.minSal, p.minAge ?? 21, p.maxAge, p.svc, JSON.stringify(p.sectors), JSON.stringify(p.nat ?? ["saudi"]), p.tenor, p.max, p.rate,
    p.rt ?? "flat", p.transfer === false ? 0 : 1, p.late ? 1 : 0, p.ltv ?? null, "معايير تقديرية من المصادر العامة — حدّثها من سياسة الجهة الفعلية");
const insR = db.prepare("INSERT INTO lender_rules (lender_id, finance_type, kind, title, body, user_id) VALUES (?,?,?,?,?,1)");
for (const r of RULES) if (!r[0] || lid[r[0]]) insR.run(r[0] ? lid[r[0]] : null, r[1], r[2], r[3], r[4]);

console.log(`قاعدة نظيفة: ${LENDERS.length} جهات، ${PRODUCTS.length} منتجاً، ${RULES.length} قاعدة سوق. بلا عملاء.`);
if (!process.env.VERCEL) console.log(`  الدخول: ${email} / ${pw}`);
