import "server-only";
import crypto from "node:crypto";
import { all, get, run } from "./db";
import { normalizePhone } from "./whatsapp";

// واتساب للأعمال — Meta Cloud API. يعمل فقط عند ضبط متغيرات البيئة في Vercel:
// WA_TOKEN (رمز دائم لمستخدم نظام)، WA_PHONE_ID (معرّف رقم الهاتف)، WA_APP_SECRET (سر التطبيق للتحقق من التوقيع)،
// WA_VERIFY_TOKEN (كلمة تختارها لتأكيد الـ webhook)، واختيارياً WA_TEMPLATE (اسم قالب المتابعة) و WA_TEMPLATE_LANG (ar)
// و WA_OTP_TEMPLATE (اسم قالب رمز الدخول من فئة Authentication، الافتراضي masar_login_code).

const V = process.env.WA_API_VERSION || "v21.0";
export const WA = {
  configured: !!(process.env.WA_TOKEN && process.env.WA_PHONE_ID),
  template: process.env.WA_TEMPLATE || "masar_file_update",
  templateLang: process.env.WA_TEMPLATE_LANG || "ar",
  otpTemplate: process.env.WA_OTP_TEMPLATE || "masar_login_code",
};

type SendResult = { ok: true; id: string } | { ok: false; error: string };

async function graph(path: string, body?: unknown): Promise<Response> {
  return fetch(`https://graph.facebook.com/${V}/${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${process.env.WA_TOKEN}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
}

async function send(payload: Record<string, unknown>): Promise<SendResult> {
  if (!WA.configured) return { ok: false, error: "ربط واتساب للأعمال غير مفعّل بعد" };
  let r: Response;
  try { r = await graph(`${process.env.WA_PHONE_ID}/messages`, { messaging_product: "whatsapp", recipient_type: "individual", ...payload }); }
  catch (e) { return { ok: false, error: `تعذر الاتصال بواتساب: ${(e as Error).message}` }; }
  const j = (await r.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
  if (!r.ok || !j.messages?.[0]?.id) return { ok: false, error: j.error?.message ? `${j.error.message}${j.error.code ? ` (${j.error.code})` : ""}` : `HTTP ${r.status}` };
  return { ok: true, id: j.messages[0].id };
}

export const sendText = (to: string, body: string) => send({ to, type: "text", text: { preview_url: true, body: body.slice(0, 4096) } });
export const sendTemplate = (to: string, params: string[]) =>
  send({ to, type: "template", template: { name: WA.template, language: { code: WA.templateLang }, components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text: text.replace(/\s*\n+\s*/g, " ").slice(0, 900) })) }] } });

/** رمز الدخول: قالب من فئة Authentication معتمد من Meta (نص الرمز + زر نسخ الرمز) */
export const sendLoginCodeMessage = (to: string, code: string) =>
  send({ to, type: "template", template: { name: WA.otpTemplate, language: { code: WA.templateLang }, components: [
    { type: "body", parameters: [{ type: "text", text: code }] },
    { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
  ] } });

/** هل نافذة الـ 24 ساعة مفتوحة (آخر رسالة واردة من العميل خلال 24 ساعة)؟ */
export async function windowOpen(clientId: number) {
  const r = await get<{ at: string }>("SELECT MAX(created_at) at FROM wa_messages WHERE client_id = ? AND direction = 'in'", clientId);
  if (!r?.at) return { open: false, lastIn: null as string | null };
  return { open: Date.now() - new Date(r.at.replace(" ", "T") + "Z").getTime() < 24 * 3600_000, lastIn: r.at };
}

export function verifySignature(raw: string, header: string | null) {
  const secret = process.env.WA_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const want = Buffer.from("sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex"));
  const got = Buffer.from(header);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

export async function clientByPhone(waPhone: string) {
  const rows = await all<{ id: number; phone: string | null }>("SELECT id, phone FROM clients WHERE phone IS NOT NULL");
  return rows.find((r) => normalizePhone(r.phone) === waPhone)?.id ?? null;
}

const MEDIA_EXT: Record<string, string> = { "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
/** تنزيل مرفق من واتساب وحفظه مستنداً في ملف العميل */
export async function saveMedia(clientId: number, mediaId: string, label: string, fileName?: string | null) {
  if (!WA.configured) return null;
  const meta = (await (await graph(mediaId)).json().catch(() => ({}))) as { url?: string; mime_type?: string; file_size?: number };
  const mime = (meta.mime_type || "").split(";")[0];
  if (!meta.url || !MEDIA_EXT[mime] || (meta.file_size ?? 0) > 10 * 1024 * 1024) return null;
  const r = await fetch(meta.url, { headers: { Authorization: `Bearer ${process.env.WA_TOKEN}` }, cache: "no-store" });
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  const doc = await run(
    "INSERT INTO documents (client_id, code, label, category, required, status, file_name, stored_name, mime, size, sha256, uploaded_at, note) VALUES (?,?,?,?,0,'received',?,?,?,?,?,datetime('now'),?)",
    clientId, "wa:" + crypto.randomUUID().slice(0, 8), label.slice(0, 200), "identity", (fileName || `whatsapp${MEDIA_EXT[mime]}`).slice(0, 200),
    "db:" + crypto.randomUUID() + MEDIA_EXT[mime], mime, buf.length, crypto.createHash("sha256").update(buf).digest("hex"), "وصل من العميل عبر واتساب",
  );
  await run("INSERT INTO file_blobs (doc_id, data) VALUES (?, ?)", doc.lastInsertRowid, buf);
  return doc.lastInsertRowid;
}
