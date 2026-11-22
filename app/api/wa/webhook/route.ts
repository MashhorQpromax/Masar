import { get, run } from "@/lib/db";
import { verifySignature, clientByPhone, saveMedia } from "@/lib/wa-cloud";

export const dynamic = "force-dynamic";

// تأكيد الاشتراك من Meta
export async function GET(req: Request) {
  const u = new URL(req.url);
  const ok = u.searchParams.get("hub.mode") === "subscribe" && !!process.env.WA_VERIFY_TOKEN && u.searchParams.get("hub.verify_token") === process.env.WA_VERIFY_TOKEN;
  return ok ? new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 }) : new Response("Forbidden", { status: 403 });
}

interface WaMsg { from: string; id: string; timestamp: string; type: string; text?: { body: string }; image?: { id: string; caption?: string }; document?: { id: string; caption?: string; filename?: string }; button?: { text: string }; interactive?: { button_reply?: { title: string } } }
interface WaStatus { id: string; status: string; errors?: { title?: string; message?: string }[] }

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) return new Response("Bad signature", { status: 401 });
  let body: { entry?: { changes?: { value?: { messages?: WaMsg[]; statuses?: WaStatus[]; contacts?: { wa_id: string; profile?: { name?: string } }[] } }[] }[] };
  try { body = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }
  for (const e of body.entry ?? []) for (const ch of e.changes ?? []) {
    const v = ch.value ?? {};
    for (const s of v.statuses ?? [])
      await run("UPDATE wa_messages SET status = ?, error = COALESCE(?, error), updated_at = datetime('now') WHERE wa_id = ?", s.status, s.errors?.[0]?.message ?? s.errors?.[0]?.title ?? null, s.id);
    for (const m of v.messages ?? []) {
      if (await get("SELECT id FROM wa_messages WHERE wa_id = ?", m.id)) continue; // مكرر
      const clientId = await clientByPhone(m.from);
      const name = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? null;
      const text = m.text?.body ?? m.image?.caption ?? m.document?.caption ?? m.button?.text ?? m.interactive?.button_reply?.title ?? (m.type === "image" ? "📷 صورة" : m.type === "document" ? "📄 مستند" : `[${m.type}]`);
      let docId: number | null = null;
      if (clientId && (m.image || m.document)) {
        const media = m.image ?? m.document!;
        docId = await saveMedia(clientId, media.id, `مستند من واتساب${media.caption ? ` — ${media.caption}` : ""}`, m.document?.filename).catch(() => null);
      }
      await run("INSERT INTO wa_messages (client_id, direction, wa_id, phone, name, type, body, doc_id, status) VALUES (?, 'in', ?, ?, ?, ?, ?, ?, 'received')",
        clientId, m.id, m.from, name, m.type, text.slice(0, 4000), docId);
      if (clientId) await run("INSERT INTO notes (client_id, kind, body) VALUES (?, 'whatsapp', ?)", clientId, `⬅️ من العميل: ${text.slice(0, 3000)}`);
    }
  }
  return new Response("OK", { status: 200 });
}
