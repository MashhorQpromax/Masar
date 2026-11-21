// تهيئة قاعدة بيانات تجريبية: مستخدمون، جهات تمويل ومنتجات (معايير تقديرية)، وعملاء وهميون للعرض.
// الاستخدام: npm run seed   (يحذف قاعدة البيانات الحالية!)
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { SCHEMA } from "../lib/schema.ts";
import { requiredDocuments, study, type FinanceType, type Sector, type Product } from "../lib/engine.ts";

const dir = process.env.MASAR_DATA_DIR || path.join(process.cwd(), "data");
fs.mkdirSync(path.join(dir, "uploads"), { recursive: true });
for (const f of ["masar.db", "masar.db-wal", "masar.db-shm"]) fs.rmSync(path.join(dir, f), { force: true });
const db = new DatabaseSync(path.join(dir, "masar.db"));
db.exec("PRAGMA foreign_keys = ON;");
db.exec(SCHEMA);

const pw = process.env.MASAR_DEMO_PASSWORD || "Masar@2026";
const hash = bcrypt.hashSync(pw, 12);
const users = [
  ["مشهور (مدير)", "admin@masar.local", "admin"],
  ["نورة — محللة ائتمان", "analyst@masar.local", "analyst"],
  ["فهد — مسؤول علاقة", "officer@masar.local", "officer"],
  ["مطّلع", "viewer@masar.local", "viewer"],
];
const insUser = db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)");
for (const u of users) insUser.run(u[0], u[1], hash, u[2]);

const ALL_SALARIED = ["gov", "military", "semi_gov", "private_approved", "retired"];
const WIDE = [...ALL_SALARIED, "private"];
const lenders: [string, "bank" | "finance_company", string | null][] = [
  ["مصرف الراجحي", "bank", "rajhi"],
  ["البنك الأهلي السعودي", "bank", "snb"],
  ["بنك الرياض", "bank", "riyad"],
  ["مصرف الإنماء", "bank", "alinma"],
  ["بنك البلاد", "bank", "albilad"],
  ["إمكان للتمويل", "finance_company", null],
  ["النايفات للتمويل", "finance_company", null],
  ["دار التمليك", "finance_company", null],
  ["عبداللطيف جميل للتمويل", "finance_company", null],
];
const lid: Record<string, number> = {};
const insL = db.prepare("INSERT INTO lenders (name, type, bank_code) VALUES (?, ?, ?)");
for (const [n, t, c] of lenders) lid[n] = Number(insL.run(n, t, c).lastInsertRowid);

type P = {
  l: string; t: FinanceType; n: string; minSal: number; maxAge: number; svc: number; sectors: string[]; tenor: number;
  max: number; rate: number; rt?: "flat" | "reducing"; transfer?: boolean; late?: boolean; ltv?: number; nat?: string[]; minAge?: number;
};
const prods: P[] = [
  { l: "مصرف الراجحي", t: "personal", n: "التمويل الشخصي", minSal: 4000, maxAge: 65, svc: 3, sectors: ALL_SALARIED, tenor: 60, max: 2_000_000, rate: 3.4 },
  { l: "البنك الأهلي السعودي", t: "personal", n: "التمويل الشخصي", minSal: 5000, maxAge: 65, svc: 3, sectors: ALL_SALARIED, tenor: 60, max: 2_500_000, rate: 3.2 },
  { l: "بنك الرياض", t: "personal", n: "التمويل الشخصي", minSal: 5000, maxAge: 65, svc: 6, sectors: ALL_SALARIED, tenor: 60, max: 1_500_000, rate: 3.6 },
  { l: "مصرف الإنماء", t: "personal", n: "التمويل الشخصي", minSal: 4000, maxAge: 65, svc: 3, sectors: ALL_SALARIED, tenor: 60, max: 1_500_000, rate: 3.5 },
  { l: "بنك البلاد", t: "personal", n: "تمويل البلاد الشخصي", minSal: 3000, maxAge: 65, svc: 3, sectors: WIDE, tenor: 60, max: 1_000_000, rate: 3.9 },
  { l: "إمكان للتمويل", t: "personal", n: "تمويل نقدي", minSal: 3000, maxAge: 65, svc: 3, sectors: WIDE, tenor: 60, max: 250_000, rate: 6.5, transfer: false, late: true },
  { l: "النايفات للتمويل", t: "personal", n: "تمويل شخصي", minSal: 3000, maxAge: 65, svc: 6, sectors: WIDE, tenor: 60, max: 300_000, rate: 7.5, transfer: false, late: true, nat: ["saudi", "non_saudi"] },
  { l: "مصرف الراجحي", t: "mortgage", n: "التمويل العقاري", minSal: 5000, maxAge: 70, svc: 3, sectors: ALL_SALARIED, tenor: 300, max: 5_000_000, rate: 5.2, rt: "reducing", ltv: 90 },
  { l: "البنك الأهلي السعودي", t: "mortgage", n: "التمويل العقاري", minSal: 6000, maxAge: 70, svc: 6, sectors: ALL_SALARIED, tenor: 300, max: 5_000_000, rate: 5.0, rt: "reducing", ltv: 90 },
  { l: "دار التمليك", t: "mortgage", n: "تمويل المسكن", minSal: 5000, maxAge: 70, svc: 6, sectors: WIDE, tenor: 300, max: 3_000_000, rate: 6.4, rt: "reducing", ltv: 85, transfer: false },
  { l: "مصرف الراجحي", t: "auto", n: "التأجير التمويلي للسيارات", minSal: 4000, maxAge: 65, svc: 3, sectors: ALL_SALARIED, tenor: 60, max: 400_000, rate: 4.2 },
  { l: "عبداللطيف جميل للتمويل", t: "auto", n: "تأجير السيارات", minSal: 3000, maxAge: 65, svc: 3, sectors: WIDE, tenor: 60, max: 400_000, rate: 5.5, transfer: false, late: true, nat: ["saudi", "non_saudi"] },
  { l: "بنك البلاد", t: "sme", n: "تمويل المنشآت الصغيرة", minSal: 0, maxAge: 70, svc: 24, sectors: ["self"], tenor: 60, max: 2_000_000, rate: 6.0, transfer: false },
];
const insP = db.prepare(`INSERT INTO products (lender_id, finance_type, name, min_salary, min_age, max_age_at_maturity, min_service_months, sectors, nationalities,
  max_tenor, max_amount, rate, rate_type, requires_salary_transfer, accepts_late_simah, max_ltv, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
for (const p of prods)
  insP.run(lid[p.l], p.t, p.n, p.minSal, p.minAge ?? 21, p.maxAge, p.svc, JSON.stringify(p.sectors), JSON.stringify(p.nat ?? ["saudi"]), p.tenor, p.max, p.rate,
    p.rt ?? "flat", p.transfer === false ? 0 : 1, p.late ? 1 : 0, p.ltv ?? null, "معايير تقديرية للعرض — يجب تحديثها من سياسة الجهة الفعلية");

// ===== عملاء تجريبيون (أسماء وهمية) =====
type C = { name: string; by: number; sector: Sector; svc: number; basic: number; total: number; bank: string; simah: string; ft: FinanceType; amt: number; tenor: number;
  status: string; employer: string; obligations: [string, string, number, number][]; housing?: number; next: string; owner: number; purpose: string };
const clients: C[] = [
  { name: "عميل تجريبي — أحمد س.", by: 1991, sector: "gov", svc: 96, basic: 11000, total: 14500, bank: "rajhi", simah: "clean", ft: "personal", amt: 200000, tenor: 60,
    status: "awaiting_docs", employer: "وزارة التعليم", obligations: [["card", "مصرف الراجحي", 500, 10000]], next: "استلام كشف الحساب وتقرير سمة", owner: 3, purpose: "ترميم المنزل" },
  { name: "عميلة تجريبية — سارة م.", by: 1985, sector: "private_approved", svc: 60, basic: 15000, total: 22000, bank: "snb", simah: "clean", ft: "mortgage", amt: 950000, tenor: 300,
    status: "study", employer: "شركة اتصالات كبرى", obligations: [["personal", "البنك الأهلي السعودي", 3000, 90000]], housing: 1, next: "تقييم عقاري للفيلا المختارة", owner: 2, purpose: "شراء مسكن أول" },
  { name: "عميل تجريبي — عبدالله ع.", by: 1962, sector: "retired", svc: 0, basic: 9000, total: 9000, bank: "riyad", simah: "late", ft: "personal", amt: 80000, tenor: 48,
    status: "submitted", employer: "متقاعد — المؤسسة العامة للتأمينات", obligations: [], next: "متابعة طلب إمكان", owner: 3, purpose: "زواج ابن" },
  { name: "عميل تجريبي — خالد ر.", by: 1996, sector: "private", svc: 14, basic: 5000, total: 6500, bank: "albilad", simah: "clean", ft: "auto", amt: 90000, tenor: 60,
    status: "study", employer: "مؤسسة مقاولات", obligations: [["other", "قرض من صاحب العمل", 400, 4000]], next: "طلب برنت التأمينات", owner: 3, purpose: "سيارة للعمل" },
  { name: "عميلة تجريبية — ريم ح.", by: 1988, sector: "semi_gov", svc: 120, basic: 18000, total: 26000, bank: "snb", simah: "clean", ft: "personal", amt: 400000, tenor: 60,
    status: "approved", employer: "شركة شبه حكومية", obligations: [], next: "تسليم الشيك للعميلة", owner: 2, purpose: "سداد مديونيات" },
];
const insC = db.prepare(`INSERT INTO clients (file_no, full_name, national_id, phone, birth_year, nationality, employer, sector, service_months, basic_salary, total_salary,
  salary_bank, simah, housing_support, finance_type, requested_amount, requested_tenor, purpose, status, next_step, next_step_due, owner_id, source, consent_at, created_at, updated_at)
  VALUES (?,?,?,?,?,'saudi',?,?,?,?,?,?,?,?,?,?,?,?,?,?,date('now', ?),?, 'إحالة', datetime('now','-20 days'), datetime('now', ?), datetime('now', ?))`);
const insO = db.prepare("INSERT INTO obligations (client_id, kind, lender, monthly, remaining) VALUES (?,?,?,?,?)");
const insD = db.prepare("INSERT INTO documents (client_id, code, label, category, required, status, uploaded_at) VALUES (?,?,?,?,?,?,?)");
const insN = db.prepare("INSERT INTO notes (client_id, kind, body, user_id, created_at) VALUES (?,?,?,?, datetime('now', ?))");
const insA = db.prepare("INSERT INTO applications (client_id, lender_id, product_name, amount, tenor, installment, ref_no, status, submitted_at, note, created_by) VALUES (?,?,?,?,?,?,?,?, date('now', ?),?,?)");
const insAudit = db.prepare("INSERT INTO audit_log (user_id, action, entity, entity_id, details, created_at) VALUES (?,?,?,?,?, datetime('now', ?))");

clients.forEach((c, i) => {
  const age = `-${(5 - i) * 3} days`;
  const id = Number(
    insC.run(`C-${String(i + 1).padStart(3, "0")}`, c.name, `10${String(23456789 + i * 1111111).slice(0, 8)}`, `05${String(51234567 + i * 7).slice(0, 8)}`, c.by,
      c.employer, c.sector, c.svc, c.basic, c.total, c.bank, c.simah, c.housing ?? 0, c.ft, c.amt, c.tenor, c.purpose, c.status, c.next, `+${i + 1} days`, c.owner, age, `-${i} days`).lastInsertRowid,
  );
  for (const o of c.obligations) insO.run(id, o[0], o[1], o[2], o[3]);
  const docs = requiredDocuments(c.ft, c.sector, "saudi");
  docs.forEach((d, j) => {
    const st = c.status === "approved" ? "verified" : j < Math.ceil(docs.length * (c.status === "submitted" ? 1 : 0.5)) ? (j % 2 ? "received" : "verified") : "missing";
    insD.run(id, d.code, d.label, d.category, d.required ? 1 : 0, st, st === "missing" ? null : new Date().toISOString());
  });
  insN.run(id, "call", `مكالمة أولى مع العميل: يرغب في ${c.purpose}. شُرحت له المستندات المطلوبة.`, c.owner, age);
  insAudit.run(c.owner, "client_create", "client", id, c.name, age);
  if (c.status === "submitted") insA.run(id, lid["إمكان للتمويل"], "تمويل نقدي", 70000, 48, 1840, "EMK-88213", "under_review", "-2 days", "قُدم بعد رفض مبدئي من البنك بسبب سمة", c.owner);
  if (c.status === "approved") {
    insA.run(id, lid["البنك الأهلي السعودي"], "التمويل الشخصي", 400000, 60, 7733, "SNB-55120", "disbursed", "-9 days", "موافقة نهائية وتم الصرف", c.owner);
    insN.run(id, "note", "تمت الموافقة بنسبة 3.2% ثابتة، وصُرف المبلغ.", c.owner, "-1 days");
  }
});

// حساب الأهلية الأولية لكل عميل بنفس المحرك
const prodObjs: Product[] = (db.prepare("SELECT p.*, l.name lender_name, l.type lender_type, l.bank_code FROM products p JOIN lenders l ON l.id = p.lender_id").all() as any[]).map((r) => ({
  id: String(r.id), lenderId: String(r.lender_id), lenderName: r.lender_name, lenderType: r.lender_type, bankCode: r.bank_code, financeType: r.finance_type, name: r.name,
  minSalary: r.min_salary, minAge: r.min_age, maxAgeAtMaturity: r.max_age_at_maturity, minServiceMonths: r.min_service_months, sectors: JSON.parse(r.sectors),
  nationalities: JSON.parse(r.nationalities), maxTenor: r.max_tenor, maxAmount: r.max_amount, rate: r.rate, rateType: r.rate_type,
  requiresSalaryTransfer: !!r.requires_salary_transfer, acceptsLateSimah: !!r.accepts_late_simah, maxLtv: r.max_ltv,
}));
for (const c of db.prepare("SELECT * FROM clients").all() as any[]) {
  const obl = db.prepare("SELECT kind, monthly FROM obligations WHERE client_id = ?").all(c.id) as any[];
  const s = study({ age: new Date().getFullYear() - c.birth_year, nationality: c.nationality, sector: c.sector, serviceMonths: c.service_months, basicSalary: c.basic_salary,
    totalSalary: c.total_salary, salaryBank: c.salary_bank, simah: c.simah, housingSupport: !!c.housing_support, financeType: c.finance_type, requestedAmount: c.requested_amount,
    requestedTenor: c.requested_tenor, obligations: obl }, prodObjs);
  db.prepare("UPDATE clients SET eligibility = ? WHERE id = ?").run(c.status === "approved" ? "eligible" : s.verdict, c.id);
}

console.log(`✓ تمت التهيئة: ${users.length} مستخدمين، ${lenders.length} جهات، ${prods.length} منتجاً، ${clients.length} عملاء تجريبيين.`);
console.log(`  الدخول: admin@masar.local / ${pw}`);
