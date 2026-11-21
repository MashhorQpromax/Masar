"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import crypto from "node:crypto";
import { z } from "zod";
import { all, get, run, tx } from "@/lib/db";
import { audit, can, hashPassword, login, logout, requireUser } from "@/lib/auth";
import { getClient, nextFileNo, studyFor, profileOf } from "@/lib/data";
import { requiredDocuments } from "@/lib/engine";

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
  const r = await login(String(fd.get("email") || ""), String(fd.get("password") || ""));
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
  finance_type: z.enum(["personal", "mortgage", "auto", "sme", "card"]),
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
  };
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
  if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return { error: "كلمة المرور 10 خانات على الأقل وتحتوي حروفاً وأرقاماً" };
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
  if (pw.length >= 10) await run("UPDATE users SET password_hash = ? WHERE id = ?", await hashPassword(pw), id);
  await audit(u, "user_update", "user", id, { role, active, passwordReset: pw.length >= 10 });
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
