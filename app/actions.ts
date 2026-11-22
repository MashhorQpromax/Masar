"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { WA, sendText, sendTemplate, windowOpen } from "@/lib/wa-cloud";
import { normalizePhone, clientGate, WA_TEMPLATES } from "@/lib/whatsapp";
import { revalidatePath } from "next/cache";
import crypto from "node:crypto";
import { z } from "zod";
import { all, get, run, tx } from "@/lib/db";
import { audit, can, hashPassword, login, logout, requireUser, passwordProblem, changeOwnPassword } from "@/lib/auth";
import { getClient, nextFileNo, studyFor, profileOf } from "@/lib/data";
import { requiredDocuments } from "@/lib/engine";
import { analyzeCredit } from "@/lib/simah";
import { parseSimahPages, type ParsedSimah } from "@/lib/simah-parse";
import { dealStudy, defaultInput, normFee, STAGE_LABEL, type DealInput, type Stage } from "@/lib/deal";
import { borrowerOf, latestCredit, waContextFor, dealFor } from "@/lib/data";

export type FormState = { error?: string; ok?: string } | undefined;

const num = (v: FormDataEntryValue | null) => {
  if (v == null || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/[,،\s]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))));
  return Number.isFinite(n) ? n : null;
};
const str = (v: FormDataEntryValue | null) => {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s.slice(0, 2000);
};

// ===== الدخول =====
export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  const r = await login(String(fd.get("email") || ""), String(fd.get("password") || ""), fd.get("remember") === "1");
  if (!r.ok) return { error: r.error };
  redirect("/");
}
export async function logoutAction() {
  const u = await requireUser();
  await audit(u, "logout");
  await logout();
  redirect("/login");
}

// ===== العملاء =====
const clientSchema = z.object({
  full_name: z.string().min(3, "الاسم مطلوب"),
  national_id: z.string().regex(/^[12]\d{9}$/, "رقم الهوية/الإقامة 10 أرقام يبدأ بـ 1 أو 2").nullable(),
  phone: z.string().regex(/^(05\d{8}|\+9665\d{8})$/, "رقم الجوال بصيغة 05XXXXXXXX").nullable(),
  sector: z.enum(["gov", "semi_gov", "private_approved", "private", "military", "retired", "self"]),
  finance_type: z.enum(["personal", "mortgage", "auto", "sme", "card", "project"]),
  nationality: z.enum(["saudi", "non_saudi"]),
  simah: z.enum(["clean", "late", "default", "unknown"]),
  birth_year: z.number().int().min(1930).max(new Date().getFullYear() - 18).nullable(),
});

function readClient(fd: FormData) {
  return {
    full_name: String(fd.get("full_name") || "").trim(),
    national_id: str(fd.get("national_id")),
    phone: str(fd.get("phone")),
    email: str(fd.get("email")),
    birth_year: num(fd.get("birth_year")),
    nationality: (str(fd.get("nationality")) || "saudi") as "saudi",
    marital_status: str(fd.get("marital_status")),
    dependents: num(fd.get("dependents")),
    city: str(fd.get("city")),
    employer: str(fd.get("employer")),
    sector: (str(fd.get("sector")) || "gov") as "gov",
    job_title: str(fd.get("job_title")),
    service_months: num(fd.get("service_months")),
    basic_salary: num(fd.get("basic_salary")),
    total_salary: num(fd.get("total_salary")),
    other_income: num(fd.get("other_income")),
    salary_bank: str(fd.get("salary_bank")),
    simah: (str(fd.get("simah")) || "unknown") as "unknown",
    owns_home: fd.get("owns_home") ? 1 : 0,
    housing_support: fd.get("housing_support") ? 1 : 0,
    property_value: num(fd.get("property_value")),
    co_income: num(fd.get("co_income")),
    finance_type: (str(fd.get("finance_type")) || "personal") as "personal",
    requested_amount: num(fd.get("requested_amount")),
    requested_tenor: num(fd.get("requested_tenor")),
    purpose: str(fd.get("purpose")),
    priority: str(fd.get("priority")),
    source: str(fd.get("source")),
    extra: readProject(fd),
  };
}

// بيانات مسار تمويل المشاريع (تُحفظ JSON في clients.extra)
const PJ_NUM = ["landArea", "landValue", "constructionCost", "gfa", "keys", "adr", "occupancy", "equityCash"];
const PJ_STR = ["borrowerType", "city", "district", "valuer", "valuationDate", "deed", "projectType", "purpose"];
const PJ_BOOL = ["nearHaram", "hasPermit", "hasFeasibility", "existingLien"];
function readProject(fd: FormData) {
  if (str(fd.get("finance_type")) !== "project") return null;
  const o: Record<string, unknown> = {};
  for (const k of PJ_NUM) o[k] = num(fd.get("pj_" + k));
  for (const k of PJ_STR) o[k] = str(fd.get("pj_" + k));
  for (const k of PJ_BOOL) o[k] = !!fd.get("pj_" + k);
  return JSON.stringify(o);
}

async function syncDocuments(clientId: number) {
  const c = (await getClient(clientId))!;
  const reqs = requiredDocuments(c.finance_type, c.sector, c.nationality);
  const existing = new Set((await all<{ code: string }>("SELECT code FROM documents WHERE client_id = ?", clientId)).map((r) => r.code));
  for (const d of reqs)
    if (!existing.has(d.code)) await run("INSERT INTO documents (client_id, code, label, category, required) VALUES (?,?,?,?,?)", clientId, d.code, d.label, d.category, d.required ? 1 : 0);
}

async function refreshEligibility(clientId: number) {
  const c = await getClient(clientId);
  if (!c) return;
  const s = await studyFor(c);
  await run("UPDATE clients SET eligibility = ?, updated_at = datetime('now') WHERE id = ?", s.verdict, clientId);
}

export async function createClient(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser("client.create");
  const data = readClient(fd);
  const v = clientSchema.safeParse(data);
  if (!v.success) return { error: v.error.issues[0].message };
  if (!fd.get("consent")) return { error: "يلزم تأكيد موافقة العميل على جمع بياناته ومعالجتها (نظام حماية البيانات الشخصية)." };
  if (data.national_id && await get("SELECT id FROM clients WHERE national_id = ?", data.national_id)) return { error: "يوجد ملف بنفس رقم الهوية." };
  const fileNo = await nextFileNo();
  const id = await tx(async (q) => {
    const cols = Object.keys(data);
    const r = await q.run(
      `INSERT INTO clients (file_no, ${cols.join(",")}, owner_id, consent_at) VALUES (?, ${cols.map(() => "?").join(",")}, ?, datetime('now'))`,
      fileNo,
      ...Object.values(data),
      u.id,
    );
    const id = Number(r.lastInsertRowid);
    const obls = String(fd.get("obligations_json") || "[]");
    for (const o of JSON.parse(obls) as { kind: string; lender: string; monthly: number; remaining: number }[])
      if (o.monthly > 0) await q.run("INSERT INTO obligations (client_id, kind, lender, monthly, remaining) VALUES (?,?,?,?,?)", id, o.kind, o.lender || null, o.monthly, o.remaining || null);
    return id;
  });
  await syncDocuments(id);
  await refreshEligibility(id);
  await audit(u, "client_create", "client", id, data.full_name);
  // ربط محادثات واتساب السابقة من نفس الرقم بالملف الجديد
  const waPhone = normalizePhone(typeof data.phone === "string" ? data.phone : null);
  if (waPhone) await run("UPDATE wa_messages SET client_id = ? WHERE client_id IS NULL AND phone = ?", id, waPhone);
  redirect(`/clients/${id}?tab=study`);
}

export async function updateClient(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser("client.edit");
  const before = await getClient(id);
  if (!before) return { error: "غير موجود" };
  const data = readClient(fd);
  const v = clientSchema.safeParse(data);
  if (!v.success) return { error: v.error.issues[0].message };
  const cols = Object.keys(data);
  await run(`UPDATE clients SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`, ...Object.values(data), id);
  const changed = cols.filter((k) => String((before as unknown as Record<string, unknown>)[k] ?? "") !== String((data as Record<string, unknown>)[k] ?? ""));
  await syncDocuments(id);
  await refreshEligibility(id);
  await audit(u, "client_update", "client", id, { changed });
  revalidatePath(`/clients/${id}`);
  return { ok: "تم حفظ التعديلات وتحديث الدراسة" };
}

export async function setStatus(id: number, fd: FormData) {
  const u = await requireUser("client.edit");
  const status = String(fd.get("status"));
  const prev = (await getClient(id))?.status;
  await run("UPDATE clients SET status = ?, updated_at = datetime('now') WHERE id = ?", status, id);
  await audit(u, "client_status", "client", id, { from: prev, to: status });
  revalidatePath("/");
  revalidatePath(`/clients/${id}`);
}

export async function setNextStep(id: number, fd: FormData) {
  const u = await requireUser("client.edit");
  await run("UPDATE clients SET next_step = ?, next_step_due = ?, updated_at = datetime('now') WHERE id = ?", str(fd.get("next_step")), str(fd.get("next_step_due")), id);
  await audit(u, "client_update", "client", id, { changed: ["next_step"] });
  revalidatePath(`/clients/${id}`);
}

export async function revealId(id: number) {
  const u = await requireUser("client.view_pii");
  await audit(u, "client_view_pii", "client", id);
  return (await getClient(id))?.national_id ?? null;
}

export async function deleteClient(id: number) {
  const u = await requireUser("client.delete");
  await run("DELETE FROM file_blobs WHERE doc_id IN (SELECT id FROM documents WHERE client_id = ?)", id);
  await run("DELETE FROM clients WHERE id = ?", id);
  await audit(u, "client_delete", "client", id);
  redirect("/clients");
}

// ===== الالتزامات =====
export async function addObligation(clientId: number, fd: FormData) {
  const u = await requireUser("client.edit");
  const monthly = num(fd.get("monthly"));
  if (!monthly || monthly <= 0) return;
  await run("INSERT INTO obligations (client_id, kind, lender, monthly, remaining) VALUES (?,?,?,?,?)", clientId, str(fd.get("kind")) || "other", str(fd.get("lender")), monthly, num(fd.get("remaining")));
  await refreshEligibility(clientId);
  await audit(u, "obligation_add", "client", clientId, { monthly });
  revalidatePath(`/clients/${clientId}`);
}
export async function deleteObligation(clientId: number, oid: number) {
  const u = await requireUser("client.edit");
  await run("DELETE FROM obligations WHERE id = ? AND client_id = ?", oid, clientId);
  await refreshEligibility(clientId);
  await audit(u, "obligation_delete", "client", clientId);
  revalidatePath(`/clients/${clientId}`);
}

// ===== المستندات =====
const ALLOWED = new Map([
  ["application/pdf", ".pdf"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/heic", ".heic"],
]);
const MAX = 10 * 1024 * 1024;

function sniff(buf: Buffer, mime: string) {
  if (mime === "application/pdf") return buf.subarray(0, 5).toString() === "%PDF-";
  if (mime === "image/png") return buf[0] === 0x89 && buf[1] === 0x50;
  if (mime === "image/jpeg") return buf[0] === 0xff && buf[1] === 0xd8;
  return true;
}

export async function uploadDocument(clientId: number, docId: number, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser("doc.upload");
  const f = fd.get("file");
  if (!(f instanceof File) || f.size === 0) return { error: "اختر ملفاً" };
  if (f.size > MAX) return { error: "الحد الأقصى 10 ميجابايت" };
  const ext = ALLOWED.get(f.type);
  if (!ext) return { error: "الأنواع المسموحة: PDF وصور" };
  const buf = Buffer.from(await f.arrayBuffer());
  if (!sniff(buf, f.type)) return { error: "محتوى الملف لا يطابق نوعه" };
  const doc = await get<{ id: number; stored_name: string | null }>("SELECT id, stored_name FROM documents WHERE id = ? AND client_id = ?", docId, clientId);
  if (!doc) return { error: "غير موجود" };
  // الملفات تُحفظ داخل قاعدة البيانات (دائمة ومشمولة بالنسخ الاحتياطي)
  const stored = "db:" + crypto.randomUUID() + ext;
  await run("DELETE FROM file_blobs WHERE doc_id = ?", docId);
  await run("INSERT INTO file_blobs (doc_id, data) VALUES (?, ?)", docId, buf);
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  await run(
    "UPDATE documents SET status='received', file_name=?, stored_name=?, mime=?, size=?, sha256=?, uploaded_by=?, uploaded_at=datetime('now') WHERE id=?",
    f.name.slice(0, 200), stored, f.type, f.size, sha256, u.id, docId,
  );
  await maybeAdvance(clientId);
  await audit(u, "doc_upload", "client", clientId, { doc: docId, name: f.name, size: f.size });
  revalidatePath(`/clients/${clientId}`);
  return { ok: "تم الرفع" };
}

async function maybeAdvance(clientId: number) {
  const c = await getClient(clientId);
  const missing = (await get<{ n: number }>("SELECT COUNT(*) n FROM documents WHERE client_id = ? AND required = 1 AND status IN ('missing','rejected')", clientId))?.n ?? 0;
  if (c?.status === "awaiting_docs" && missing === 0) await run("UPDATE clients SET status = 'study' WHERE id = ?", clientId);
}

export async function setDocStatus(clientId: number, docId: number, status: string) {
  const u = await requireUser(status === "verified" || status === "rejected" ? "doc.verify" : "doc.upload");
  await run("UPDATE documents SET status = ? WHERE id = ? AND client_id = ?", status, docId, clientId);
  await maybeAdvance(clientId);
  await audit(u, "doc_status", "client", clientId, { doc: docId, status });
  revalidatePath(`/clients/${clientId}`);
}

export async function addCustomDoc(clientId: number, fd: FormData) {
  const u = await requireUser("doc.upload");
  const label = str(fd.get("label"));
  if (!label) return;
  await run("INSERT INTO documents (client_id, code, label, category, required) VALUES (?,?,?,?,0)", clientId, "custom:" + crypto.randomUUID().slice(0, 8), label, str(fd.get("category")) || "identity");
  await audit(u, "doc_status", "client", clientId, { added: label });
  revalidatePath(`/clients/${clientId}`);
}

// ===== الطلبات لدى الجهات =====
export async function createApplication(clientId: number, fd: FormData) {
  const u = await requireUser("app.manage");
  const status = str(fd.get("status")) || "draft";
  const r = await run(
    `INSERT INTO applications (client_id, lender_id, product_name, amount, tenor, installment, ref_no, status, submitted_at, note, created_by)
     VALUES (?,?,?,?,?,?,?,?, CASE WHEN ? != 'draft' THEN date('now') END, ?, ?)`,
    clientId, num(fd.get("lender_id")), str(fd.get("product_name")), num(fd.get("amount")), num(fd.get("tenor")), num(fd.get("installment")),
    str(fd.get("ref_no")), status, status, str(fd.get("note")), u.id,
  );
  if (status !== "draft") await run("UPDATE clients SET status = 'submitted', updated_at = datetime('now') WHERE id = ? AND status IN ('study','awaiting_docs')", clientId);
  await audit(u, "app_create", "client", clientId, { app: Number(r.lastInsertRowid) });
  revalidatePath(`/clients/${clientId}`);
}

export async function updateApplication(clientId: number, appId: number, fd: FormData) {
  const u = await requireUser("app.manage");
  const status = String(fd.get("status"));
  await run(
    `UPDATE applications SET status = ?, ref_no = COALESCE(?, ref_no), note = COALESCE(?, note), updated_at = datetime('now'),
       submitted_at = CASE WHEN submitted_at IS NULL AND ? != 'draft' THEN date('now') ELSE submitted_at END,
       decided_at = CASE WHEN ? IN ('approved','rejected','disbursed') THEN date('now') ELSE decided_at END
     WHERE id = ? AND client_id = ?`,
    status, str(fd.get("ref_no")), str(fd.get("note")), status, status, appId, clientId,
  );
  if (status === "approved" || status === "disbursed") await run("UPDATE clients SET status = 'approved', updated_at = datetime('now') WHERE id = ?", clientId);
  await audit(u, "app_update", "client", clientId, { app: appId, status });
  revalidatePath(`/clients/${clientId}`);
}

// ===== نتيجة الجهة الفعلية (التعلّم من الواقع) =====
export async function recordOutcome(clientId: number, appId: number, fd: FormData) {
  const u = await requireUser("app.manage");
  const c = await getClient(clientId);
  const app = await get<{ lender_id: number | null; amount: number | null }>("SELECT lender_id, amount FROM applications WHERE id = ? AND client_id = ?", appId, clientId);
  if (!c || !app?.lender_id) return;
  const decision = String(fd.get("decision"));
  if (!["approved", "approved_modified", "rejected"].includes(decision)) return;
  const s = await studyFor(c);
  const m = s.matches.filter((x) => x.product.lenderId === String(app.lender_id)).sort((a, b) => b.maxPrincipal - a.maxPrincipal)[0];
  const p = await profileOf(c);
  const conditions = fd.getAll("conditions").map(String).slice(0, 20);
  await run(
    `INSERT INTO outcomes (application_id, client_id, lender_id, finance_type, sector, salary, age, simah, decision, requested_amount, estimated_amount, approved_amount, approved_rate, approved_tenor, conditions, reason, note, user_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    appId, clientId, app.lender_id, c.finance_type, c.sector, c.total_salary ?? c.basic_salary, p.age, c.simah, decision,
    app.amount ?? c.requested_amount, m?.maxPrincipal ?? null, decision === "rejected" ? null : num(fd.get("approved_amount")) ?? app.amount,
    num(fd.get("approved_rate")), num(fd.get("approved_tenor")), JSON.stringify(conditions), str(fd.get("reason")), str(fd.get("note")), u.id,
  );
  const st = decision === "rejected" ? "rejected" : "approved";
  await run("UPDATE applications SET status = ?, decided_at = date('now'), updated_at = datetime('now') WHERE id = ?", st, appId);
  if (st === "approved") await run("UPDATE clients SET status = 'approved', updated_at = datetime('now') WHERE id = ?", clientId);
  await audit(u, "outcome_record", "client", clientId, { app: appId, decision, conditions });
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/lenders");
}

// ===== خبرة الجهات: اشتراطات واستثناءات يضيفها الفريق =====
export async function addLenderRule(fd: FormData) {
  const u = await requireUser("client.edit");
  const title = str(fd.get("title"));
  const kind = String(fd.get("kind"));
  if (!title || !["condition", "exception", "tip", "warning"].includes(kind)) return;
  await run("INSERT INTO lender_rules (lender_id, finance_type, kind, title, body, user_id) VALUES (?,?,?,?,?,?)", num(fd.get("lender_id")), str(fd.get("finance_type")), kind, title, str(fd.get("body")), u.id);
  await audit(u, "rule_add", "lender", num(fd.get("lender_id")), title);
  revalidatePath("/lenders");
  revalidatePath("/knowledge");
}
export async function archiveLenderRule(id: number) {
  const u = await requireUser("lender.manage");
  await run("UPDATE lender_rules SET active = 0 WHERE id = ?", id);
  await audit(u, "rule_archive", "lender", null, { id });
  revalidatePath("/knowledge");
}

// ===== الملاحظات =====
export async function addNote(clientId: number, fd: FormData) {
  const u = await requireUser("client.edit");
  const body = str(fd.get("body"));
  if (!body) return;
  await run("INSERT INTO notes (client_id, kind, body, user_id) VALUES (?,?,?,?)", clientId, str(fd.get("kind")) || "note", body, u.id);
  await audit(u, "note_add", "client", clientId);
  revalidatePath(`/clients/${clientId}`);
}

// ===== اعتماد الدراسة =====
export async function saveStudy(clientId: number, fd: FormData) {
  const u = await requireUser("study.approve");
  const c = await getClient(clientId);
  if (!c) return;
  const s = await studyFor(c);
  const verdict = str(fd.get("verdict")) || s.verdict;
  await run("INSERT INTO studies (client_id, verdict, snapshot, analyst_opinion, user_id) VALUES (?,?,?,?,?)", clientId, verdict, JSON.stringify(s), str(fd.get("opinion")), u.id);
  await run("UPDATE clients SET eligibility = ?, updated_at = datetime('now') WHERE id = ?", verdict, clientId);
  await audit(u, "study_save", "client", clientId, { verdict });
  revalidatePath(`/clients/${clientId}`);
}

// ===== المستخدمون =====
export async function createUser(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser("user.manage");
  const email = String(fd.get("email") || "").trim().toLowerCase();
  const password = String(fd.get("password") || "");
  const name = String(fd.get("name") || "").trim();
  const role = String(fd.get("role") || "officer");
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) return { error: "الاسم والبريد مطلوبان" };
  const bad = passwordProblem(password);
  if (bad) return { error: bad };
  if (await get("SELECT id FROM users WHERE email = ?", email)) return { error: "البريد مستخدم" };
  const r = await run("INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)", name, email, await hashPassword(password), role);
  await audit(u, "user_create", "user", r.lastInsertRowid, { email, role });
  revalidatePath("/users");
  return { ok: "تمت إضافة المستخدم" };
}

export async function updateUser(id: number, fd: FormData) {
  const u = await requireUser("user.manage");
  const role = str(fd.get("role"));
  const active = fd.get("active") === "1" ? 1 : 0;
  if (id === u.id && (active === 0 || role !== "admin")) return; // لا يعطل المدير نفسه
  await run("UPDATE users SET role = COALESCE(?, role), active = ? WHERE id = ?", role, active, id);
  if (!active) await run("DELETE FROM sessions WHERE user_id = ?", id);
  const pw = String(fd.get("password") || "");
  const reset = pw !== "" && !passwordProblem(pw);
  if (reset) await run("UPDATE users SET password_hash = ? WHERE id = ?", await hashPassword(pw), id);
  await audit(u, "user_update", "user", id, { role, active, passwordReset: reset });
  revalidatePath("/users");
}

// ===== المنتجات =====
export async function saveProduct(fd: FormData) {
  const u = await requireUser("lender.manage");
  const id = num(fd.get("id"));
  const sectors = fd.getAll("sectors").map(String);
  const nats = fd.getAll("nationalities").map(String);
  const vals = [
    str(fd.get("name")), num(fd.get("min_salary")) ?? 0, num(fd.get("min_age")) ?? 21, num(fd.get("max_age_at_maturity")) ?? 60,
    num(fd.get("min_service_months")) ?? 0, JSON.stringify(sectors), JSON.stringify(nats.length ? nats : ["saudi"]), num(fd.get("max_tenor")) ?? 60,
    num(fd.get("max_amount")) ?? 0, num(fd.get("rate")) ?? 0, str(fd.get("rate_type")) || "flat", fd.get("requires_salary_transfer") ? 1 : 0,
    fd.get("accepts_late_simah") ? 1 : 0, num(fd.get("max_ltv")), str(fd.get("notes")), fd.get("active") ? 1 : 0,
  ];
  if (id) {
    await run(
      `UPDATE products SET name=?, min_salary=?, min_age=?, max_age_at_maturity=?, min_service_months=?, sectors=?, nationalities=?, max_tenor=?, max_amount=?, rate=?,
       rate_type=?, requires_salary_transfer=?, accepts_late_simah=?, max_ltv=?, notes=?, active=?, verified_at = CASE WHEN ? THEN datetime('now') ELSE verified_at END WHERE id=?`,
      ...vals, fd.get("verified") ? 1 : 0, id,
    );
    await audit(u, "product_update", "product", id);
  } else {
    let lenderId = num(fd.get("lender_id"));
    const newLender = str(fd.get("new_lender"));
    if (newLender) lenderId = (await run("INSERT INTO lenders (name, type) VALUES (?, ?)", newLender, str(fd.get("lender_type")) || "bank")).lastInsertRowid;
    const r = await run(
      `INSERT INTO products (name, min_salary, min_age, max_age_at_maturity, min_service_months, sectors, nationalities, max_tenor, max_amount, rate, rate_type,
       requires_salary_transfer, accepts_late_simah, max_ltv, notes, active, lender_id, finance_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ...vals, lenderId, str(fd.get("finance_type")) || "personal",
    );
    await audit(u, "product_create", "product", r.lastInsertRowid);
  }
  for (const c of await all<{ id: number }>("SELECT id FROM clients WHERE status NOT IN ('approved','rejected')")) await refreshEligibility(c.id);
  revalidatePath("/lenders");
  redirect("/lenders");
}

export async function canDo(perm: Parameters<typeof can>[1]) {
  return can(await requireUser(), perm);
}

// ===== تقرير سمة =====
const OBL_KIND: [RegExp, string][] = [[/منزلي|عقاري/, "mortgage"], [/شخصي/, "personal"], [/بطاقة/, "card"], [/سيارة|تأجير/, "auto"]];

export async function uploadSimah(clientId: number, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser("doc.upload");
  const c = await getClient(clientId);
  if (!c) return { error: "غير موجود" };
  const f = fd.get("file");
  if (!(f instanceof File) || f.size === 0) return { error: "اختر ملف تقرير سمة (PDF)" };
  if (f.type !== "application/pdf") return { error: "تقرير سمة يُرفع بصيغة PDF كما نزل من سمة" };
  if (f.size > MAX) return { error: "الحد الأقصى 10 ميجابايت" };
  const buf = Buffer.from(await f.arrayBuffer());
  if (!sniff(buf, f.type)) return { error: "الملف ليس PDF صالحاً" };

  let parsed: ParsedSimah;
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: false });
    parsed = parseSimahPages(text as string[]);
  } catch (e) {
    console.error("simah parse", e);
    return { error: "تعذرت قراءة الملف. تأكد أنه تقرير سمة الأصلي (PDF نصي وليس صورة)." };
  }
  if (!parsed.report.facilities.length && !parsed.report.judgments.length && parsed.summary.activeCount == null)
    return { error: "لم نجد بيانات سمة في الملف. هل هو تقرير سمة الأساسي؟ يمكنك إدخال البيانات يدوياً." };

  // حفظ الملف في مستندات العميل (خانة تقرير سمة)
  let doc = await get<{ id: number }>("SELECT id FROM documents WHERE client_id = ? AND code = 'simah'", clientId);
  if (!doc) doc = { id: (await run("INSERT INTO documents (client_id, code, label, category, required) VALUES (?, 'simah', 'تقرير سمة حديث', 'obligations', 1)", clientId)).lastInsertRowid };
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  await run("DELETE FROM file_blobs WHERE doc_id = ?", doc.id);
  await run("INSERT INTO file_blobs (doc_id, data) VALUES (?, ?)", doc.id, buf);
  await run(
    "UPDATE documents SET status='received', file_name=?, stored_name=?, mime=?, size=?, sha256=?, uploaded_by=?, uploaded_at=datetime('now') WHERE id=?",
    f.name.slice(0, 200), "db:simah.pdf", f.type, f.size, sha256, u.id, doc.id,
  );

  const analysis = analyzeCredit(parsed.report);
  const stored = { ...parsed.report, warnings: parsed.warnings, confidence: parsed.confidence };
  await run("INSERT INTO credit_reports (client_id, report, grade, derived_simah, doc_id, user_id) VALUES (?,?,?,?,?,?)", clientId, JSON.stringify(stored), analysis.grade, analysis.derivedSimah, doc.id, u.id);
  await run("UPDATE clients SET simah = ?, updated_at = datetime('now') WHERE id = ?", analysis.derivedSimah, clientId);

  // الالتزامات: نستوردها من سمة إن لم تُدخل يدوياً
  const existing = await get<{ n: number }>("SELECT COUNT(*) n FROM obligations WHERE client_id = ?", clientId);
  let imported = 0;
  if (!existing?.n)
    for (const x of parsed.report.facilities)
      if ((x.status === "current" || x.status === "late") && (x.installment ?? 0) > 0) {
        const kind = OBL_KIND.find(([re]) => re.test(x.product))?.[1] ?? "other";
        await run("INSERT INTO obligations (client_id, kind, lender, monthly, remaining) VALUES (?,?,?,?,?)", clientId, kind, x.lender, x.installment, x.balance ?? null);
        imported++;
      }
  await refreshEligibility(clientId);
  await audit(u, "simah_upload", "client", clientId, { grade: analysis.grade, facilities: parsed.report.facilities.length, judgments: parsed.report.judgments.length, imported });
  revalidatePath(`/clients/${clientId}`);
  return { ok: `تمت قراءة التقرير: ${parsed.report.facilities.length} منتجاً، ${parsed.report.judgments.length} قرار تنفيذ${imported ? `، واستُورد ${imported} التزاماً` : ""}.` };
}

/** تأكيد/نفي الإيقاف بعد التحقق من أبشر/ناجز + ملاحظة المحلل */
export async function confirmCredit(clientId: number, reportId: number, fd: FormData) {
  const u = await requireUser("client.edit");
  const r = await get<{ report: string }>("SELECT report FROM credit_reports WHERE id = ? AND client_id = ?", reportId, clientId);
  if (!r) return;
  const rep = JSON.parse(r.report);
  const susp = str(fd.get("suspension"));
  if (susp === "yes" || susp === "no") { rep.serviceSuspension = susp === "yes"; rep.suspensionAssumed = false; }
  rep.travelBan = fd.get("travel_ban") ? true : rep.travelBan ?? false;
  const note = str(fd.get("note"));
  if (note) rep.notes = note;
  const a = analyzeCredit(rep);
  await run("UPDATE credit_reports SET report = ?, grade = ?, derived_simah = ? WHERE id = ?", JSON.stringify(rep), a.grade, a.derivedSimah, reportId);
  await run("UPDATE clients SET simah = ?, updated_at = datetime('now') WHERE id = ?", a.derivedSimah, clientId);
  await refreshEligibility(clientId);
  await audit(u, "simah_confirm", "client", clientId, { suspension: susp, note: !!note });
  revalidatePath(`/clients/${clientId}`);
}

// ===== صفقة السداد وإعادة التمويل =====
export async function saveDeal(clientId: number, json: string): Promise<FormState> {
  const u = await requireUser();
  if (!can(u, "client.edit")) return { error: "لا تملك صلاحية التعديل" };
  const c = await getClient(clientId);
  if (!c) return { error: "العميل غير موجود" };
  let x: DealInput;
  try {
    const raw = JSON.parse(json) as Partial<DealInput>;
    const d = defaultInput();
    const n = (v: unknown, def: number | null) => (v == null || v === "" || !Number.isFinite(Number(v)) ? def : Number(v));
    x = {
      ...d,
      items: (raw.items ?? []).slice(0, 60).map((i, k) => ({
        id: String(i.id ?? `i${k}`).slice(0, 20), kind: i.kind ?? "other", label: String(i.label ?? "").slice(0, 200),
        original: n(i.original, 0)!, pay: n(i.pay, 0)!, by: i.by === "bank" ? "bank" : "company", confirmed: !!i.confirmed,
      })),
      propertyValue: n(raw.propertyValue, null), transferTaxPct: n(raw.transferTaxPct, d.transferTaxPct)!, saleTaxPct: n(raw.saleTaxPct, d.saleTaxPct)!,
      fixedCosts: n(raw.fixedCosts, d.fixedCosts)!, fee: normFee(raw.fee),
      targetBank: raw.targetBank ? String(raw.targetBank).slice(0, 40) : null, mortgageApr: n(raw.mortgageApr, d.mortgageApr)!, personalFlat: n(raw.personalFlat, d.personalFlat)!,
      personalMonths: n(raw.personalMonths, d.personalMonths)!, mortgageMaxAge: n(raw.mortgageMaxAge, d.mortgageMaxAge)!, mortgageMaxMonths: n(raw.mortgageMaxMonths, d.mortgageMaxMonths)!,
      ltvPct: n(raw.ltvPct, d.ltvPct)!, bankMortgage: n(raw.bankMortgage, null), bankPersonal: n(raw.bankPersonal, null), notes: String(raw.notes ?? "").slice(0, 4000),
    };
  } catch {
    return { error: "بيانات غير صالحة" };
  }
  const cr = await latestCredit(clientId);
  const credit = cr ? { bankReopenMonths: cr.analysis.banks.reopenInMonths, suspension: !!cr.report.serviceSuspension, financeCoDefault: cr.analysis.stats.financeCoDefaults > 0 } : null;
  const st = dealStudy(x, borrowerOf(c), credit);
  const exists = await get("SELECT id FROM deals WHERE client_id = ?", clientId);
  if (exists)
    await run("UPDATE deals SET data = ?, capital = ?, fee = ?, client_net = ?, verdict = ?, updated_at = datetime('now') WHERE client_id = ?", JSON.stringify(x), st.capital, st.fee, st.clientNet, st.verdict, clientId);
  else
    await run("INSERT INTO deals (client_id, data, capital, fee, client_net, verdict, user_id, stage_log) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", clientId, JSON.stringify(x), st.capital, st.fee, st.clientNet, st.verdict, u.id,
      JSON.stringify([{ stage: "study", at: new Date().toISOString().slice(0, 16).replace("T", " "), by: u.name }]));
  if (x.propertyValue && x.propertyValue !== c.property_value) await run("UPDATE clients SET property_value = ?, updated_at = datetime('now') WHERE id = ?", x.propertyValue, clientId);
  await audit(u, "deal_save", "client", clientId, { capital: st.capital, fee: st.fee, verdict: st.verdict });
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/deals");
  return { ok: "حُفظت دراسة الصفقة" };
}

export async function setDealStage(clientId: number, fd: FormData) {
  const u = await requireUser();
  if (!can(u, "client.edit")) return;
  const stage = String(fd.get("stage") ?? "") as Stage;
  if (!(stage in STAGE_LABEL)) return;
  const note = str(fd.get("note"));
  const row = await get<{ stage_log: string }>("SELECT stage_log FROM deals WHERE client_id = ?", clientId);
  if (!row) return;
  const log = JSON.parse(row.stage_log) as unknown[];
  log.push({ stage, at: new Date().toISOString().slice(0, 16).replace("T", " "), by: u.name, note });
  await run("UPDATE deals SET stage = ?, stage_log = ?, updated_at = datetime('now') WHERE client_id = ?", stage, JSON.stringify(log.slice(-100)), clientId);
  await audit(u, "deal_stage", "client", clientId, { stage: STAGE_LABEL[stage], note });
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/deals");
}

/** اعتماد رفض الملف: الصفقة لا تقفل — نوقفها ولا نراسل العميل */
export async function rejectDeal(clientId: number, fd: FormData) {
  const u = await requireUser("client.edit");
  const c = await getClient(clientId);
  if (!c) return;
  const d = await dealFor(c);
  const reason = str(fd.get("reason")) ?? (d.study.verdict === "short" ? `الصفقة لا تقفل — عجز ${Math.round(Math.max(0, -d.study.clientNet)).toLocaleString("en-US")} ريال` : "رفض");
  const row = await get<{ stage_log: string }>("SELECT stage_log FROM deals WHERE client_id = ?", clientId);
  if (row) {
    const log = JSON.parse(row.stage_log) as unknown[];
    log.push({ stage: "lost", at: new Date().toISOString().slice(0, 16).replace("T", " "), by: u.name, note: reason });
    await run("UPDATE deals SET stage = 'lost', stage_log = ?, updated_at = datetime('now') WHERE client_id = ?", JSON.stringify(log.slice(-100)), clientId);
  }
  await run("UPDATE clients SET status = 'rejected', next_step = NULL, updated_at = datetime('now') WHERE id = ?", clientId);
  await run("UPDATE share_links SET revoked = 1 WHERE client_id = ? AND revoked = 0", clientId);
  await run("INSERT INTO notes (client_id, kind, body, user_id) VALUES (?, 'note', ?, ?)", clientId, `🔴 رُفض الملف: ${reason}`, u.id);
  await audit(u, "client_status", "client", clientId, { from: c.status, to: "rejected", reason });
  revalidatePath(`/clients/${clientId}`); revalidatePath("/deals"); revalidatePath("/");
}

export async function reopenDeal(clientId: number) {
  const u = await requireUser("client.edit");
  const c = await getClient(clientId);
  if (!c) return;
  const row = await get<{ stage_log: string }>("SELECT stage_log FROM deals WHERE client_id = ?", clientId);
  if (row) {
    const log = JSON.parse(row.stage_log) as unknown[];
    log.push({ stage: "study", at: new Date().toISOString().slice(0, 16).replace("T", " "), by: u.name, note: "أُعيد فتح الملف" });
    await run("UPDATE deals SET stage = 'study', stage_log = ?, updated_at = datetime('now') WHERE client_id = ?", JSON.stringify(log.slice(-100)), clientId);
  }
  await run("UPDATE clients SET status = 'study', updated_at = datetime('now') WHERE id = ?", clientId);
  await run("INSERT INTO notes (client_id, kind, body, user_id) VALUES (?, 'note', ?, ?)", clientId, "🔄 أُعيد فتح الملف للدراسة", u.id);
  await audit(u, "client_status", "client", clientId, { from: c.status, to: "study" });
  revalidatePath(`/clients/${clientId}`); revalidatePath("/deals"); revalidatePath("/");
}

// ===== حسابي =====
export async function changePasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser();
  const next = String(fd.get("next") || "");
  if (next !== String(fd.get("confirm") || "")) return { error: "كلمتا المرور غير متطابقتين" };
  const err = await changeOwnPassword(u.id, String(fd.get("current") || ""), next);
  if (err) return { error: err };
  await audit(u, "password_change", "user", u.id);
  return { ok: "تم تغيير كلمة المرور" };
}

// ===== واتساب ورابط العميل =====
const LINK_DAYS = 14;
async function baseUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "masarfin.com";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
/** يمنع مراسلة العميل إذا الملف مرفوض أو الصفقة فيها عجز */
async function clientMessagingBlock(clientId: number): Promise<string | null> {
  const c = await getClient(clientId);
  if (!c) return "العميل غير موجود";
  const g = clientGate(await waContextFor(c, "", null));
  return g.allowed.some((k) => WA_TEMPLATES[k].client) ? null : g.reason;
}

export async function createShareLink(clientId: number): Promise<{ url?: string; error?: string }> {
  const u = await requireUser();
  if (!can(u, "client.edit")) return { error: "لا تملك صلاحية" };
  const blocked = await clientMessagingBlock(clientId);
  if (blocked) return { error: blocked };
  const existing = await get<{ token: string }>("SELECT token FROM share_links WHERE client_id = ? AND revoked = 0 AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1", clientId);
  let token = existing?.token;
  if (!token) {
    token = crypto.randomBytes(18).toString("base64url");
    await run(`INSERT INTO share_links (token, client_id, user_id, expires_at) VALUES (?, ?, ?, datetime('now','+${LINK_DAYS} days'))`, token, clientId, u.id);
    await audit(u, "share_link", "client", clientId, { days: LINK_DAYS });
  }
  revalidatePath(`/clients/${clientId}`);
  return { url: `${await baseUrl()}/s/${token}` };
}
export async function revokeShareLinks(clientId: number) {
  const u = await requireUser();
  if (!can(u, "client.edit")) return;
  await run("UPDATE share_links SET revoked = 1 WHERE client_id = ?", clientId);
  await audit(u, "share_revoke", "client", clientId);
  revalidatePath(`/clients/${clientId}`);
}
export async function logWhatsapp(clientId: number, template: string, body: string) {
  const u = await requireUser();
  await run("INSERT INTO notes (client_id, kind, body, user_id) VALUES (?, 'whatsapp', ?, ?)", clientId, `[${template}]\n${body.slice(0, 4000)}`, u.id);
  await audit(u, "wa_send", "client", clientId, { template });
  revalidatePath(`/clients/${clientId}`);
}

/** رفع العميل لمستند عبر رابطه الخاص — بلا تسجيل دخول، مقيّد بالرمز والصلاحية والحجم والنوع */
export async function portalUpload(token: string, docId: number, _: FormState, fd: FormData): Promise<FormState> {
  const link = await get<{ client_id: number }>("SELECT client_id FROM share_links WHERE token = ? AND revoked = 0 AND expires_at > datetime('now')", token);
  if (!link) return { error: "انتهت صلاحية الرابط — اطلب رابطاً جديداً" };
  const f = fd.get("file");
  if (!(f instanceof File) || f.size === 0) return { error: "اختر ملفاً" };
  if (f.size > MAX) return { error: "الحد الأقصى 10 ميجابايت" };
  const ext = ALLOWED.get(f.type);
  if (!ext) return { error: "الأنواع المسموحة: PDF وصور" };
  const buf = Buffer.from(await f.arrayBuffer());
  if (!sniff(buf, f.type)) return { error: "محتوى الملف لا يطابق نوعه" };
  const doc = await get<{ id: number; status: string }>("SELECT id, status FROM documents WHERE id = ? AND client_id = ?", docId, link.client_id);
  if (!doc) return { error: "غير موجود" };
  if (doc.status === "verified") return { error: "هذا المستند مستلم ومعتمد" };
  await run("DELETE FROM file_blobs WHERE doc_id = ?", docId);
  await run("INSERT INTO file_blobs (doc_id, data) VALUES (?, ?)", docId, buf);
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  await run(
    "UPDATE documents SET status='received', file_name=?, stored_name=?, mime=?, size=?, sha256=?, uploaded_by=NULL, uploaded_at=datetime('now'), note='رفعه العميل عبر رابطه الخاص' WHERE id=?",
    f.name.slice(0, 200), "db:" + crypto.randomUUID() + ext, f.type, f.size, sha256, docId,
  );
  await maybeAdvance(link.client_id);
  await run("INSERT INTO audit_log (action, entity, entity_id, details) VALUES ('portal_upload', 'client', ?, ?)", link.client_id, JSON.stringify({ doc: docId, size: f.size }));
  revalidatePath(`/clients/${link.client_id}`);
  return { ok: "تم الاستلام ✅ شكراً لك" };
}

// ===== واتساب للأعمال (من رقم الشركة) =====
export async function waSendDirect(clientId: number, body: string): Promise<{ ok?: string; error?: string }> {
  const u = await requireUser();
  if (!can(u, "client.edit")) return { error: "لا تملك صلاحية" };
  if (!WA.configured) return { error: "ربط واتساب للأعمال غير مفعّل بعد" };
  const blocked = await clientMessagingBlock(clientId);
  if (blocked) return { error: blocked };
  const c = await getClient(clientId);
  const to = normalizePhone(c?.phone);
  if (!c || !to) return { error: "رقم جوال العميل غير صالح" };
  const w = await windowOpen(clientId);
  let r, kind: string, text: string;
  if (w.open) { r = await sendText(to, body); kind = "text"; text = body; }
  else {
    // خارج نافذة الـ 24 ساعة: قالب معتمد يدعو العميل للرد، مع رابط ملفه
    const link = await createShareLink(clientId);
    r = await sendTemplate(to, [c.full_name.split(" ")[0], link.url ?? ""]);
    kind = "template"; text = `[قالب ${WA.template}] ${c.full_name.split(" ")[0]} — ${link.url ?? ""}`;
  }
  await run("INSERT INTO wa_messages (client_id, direction, wa_id, phone, type, body, status, error, user_id) VALUES (?, 'out', ?, ?, ?, ?, ?, ?, ?)",
    clientId, r.ok ? r.id : null, to, kind, text.slice(0, 4000), r.ok ? "sent" : "failed", r.ok ? null : r.error, u.id);
  await audit(u, "wa_send", "client", clientId, { via: "api", kind, ok: r.ok });
  revalidatePath(`/clients/${clientId}`);
  if (!r.ok) return { error: `لم تُرسل: ${r.error}` };
  return { ok: w.open ? "أُرسلت من رقم الشركة ✓" : "العميل لم يراسلنا خلال 24 ساعة، فأُرسل له قالب المتابعة المعتمد مع رابط ملفه ✓ — بعد ما يرد تقدر ترسل الرسالة الكاملة" };
}
