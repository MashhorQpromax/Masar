"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { buildMessage, clientGate, normalizePhone, waLink, WA_TEMPLATES, type WaContext, type WaTemplate } from "@/lib/whatsapp";

export default function WhatsAppPanel({
  clientId, phone, ctx, initialLink, linkInfo, createLink, revokeLinks, log, canEdit, api, sendDirect,
}: {
  clientId: number;
  phone: string | null;
  ctx: WaContext;
  initialLink: string | null;
  linkInfo: { expires: string; views: number; lastView: string | null } | null;
  createLink: (id: number) => Promise<{ url?: string; error?: string }>;
  revokeLinks: (id: number) => Promise<void>;
  log: (id: number, template: string, body: string) => Promise<void>;
  canEdit: boolean;
  api: WaApi;
  sendDirect: (id: number, body: string) => Promise<{ ok?: string; error?: string }>;
}) {
  const gate = useMemo(() => clientGate(ctx), [ctx]);
  const [t, setT] = useState<WaTemplate>(gate.allowed[0]);
  const [showLender, setShowLender] = useState(false);
  const [link, setLink] = useState<string | null>(initialLink);
  const [withLink, setWithLink] = useState(true);
  const [to, setTo] = useState(phone ?? "");
  const msg = useMemo(() => buildMessage(t, { ...ctx, showLender, link: withLink && WA_TEMPLATES[t].client ? link : null }), [t, ctx, link, withLink, showLender]);
  const clientBlocked = !gate.allowed.some((k) => WA_TEMPLATES[k].client);
  const [text, setText] = useState(msg);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => setText(msg), [msg]);
  const num = WA_TEMPLATES[t].client ? normalizePhone(to) : null;

  const send = () => {
    window.open(waLink(num, text), "_blank", "noopener");
    start(async () => { await log(clientId, WA_TEMPLATES[t].label, text); setNote("فُتح واتساب وسُجلت الرسالة في ملف العميل ✓"); });
  };

  const direct = () => start(async () => {
    const r = await sendDirect(clientId, text);
    setNote(r.ok ?? null); setErr(r.error ?? null);
  });
  const isClient = WA_TEMPLATES[t].client;

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-5">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(WA_TEMPLATES) as WaTemplate[]).map((k) => {
            const off = !gate.allowed.includes(k);
            return (
              <button key={k} type="button" disabled={off} title={off ? "غير متاحة لهذا الملف" : undefined} onClick={() => { setT(k); setNote(null); setErr(null); }}
                className={`rounded-xl px-4 py-2 text-sm font-semibold ring-1 ${off ? "bg-slate-50 text-slate-300 ring-slate-100 line-through cursor-not-allowed" : t === k ? (WA_TEMPLATES[k].client ? "bg-emerald-600 text-white ring-emerald-600" : "bg-slate-800 text-white ring-slate-800") : "bg-white text-slate-600 ring-slate-200 hover:ring-slate-300"}`}>
                {WA_TEMPLATES[k].client ? "" : "🔒 "}{WA_TEMPLATES[k].label}
              </button>
            );
          })}
        </div>
        {gate.reason && (
          <div className={`rounded-xl p-3 text-sm ring-1 ${gate.tone === "red" ? "bg-rose-50 ring-rose-200 text-rose-900" : "bg-amber-50 ring-amber-200 text-amber-900"}`}>
            {gate.tone === "red" ? "🔴 " : "🟡 "}{gate.reason}
          </div>
        )}
        <p className="text-xs text-slate-500">{WA_TEMPLATES[t].hint}</p>
        {!WA_TEMPLATES[t].client && <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 p-3 text-sm text-amber-900">هذه الرسالة فيها أتعابنا ورأس المال — أرسلها لشريك أو ممول فقط، لا للعميل. ستفتح واتساب لتختار جهة الاتصال.</div>}

        <div className="card p-4 space-y-3">
          {WA_TEMPLATES[t].client && (
            <div className="flex flex-wrap items-end gap-3">
              <label className="block flex-1 min-w-48">
                <span className="text-xs font-semibold text-slate-500">جوال العميل</span>
                <input className="input mt-1 num" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} placeholder="05xxxxxxxx" />
              </label>
              {!num && <span className="text-xs text-rose-600 pb-2">رقم غير صالح — سيفتح واتساب لتختار جهة الاتصال</span>}
              <label className="flex items-center gap-2 text-sm text-slate-600 pb-2"><input type="checkbox" checked={withLink} onChange={(e) => setWithLink(e.target.checked)} /> إرفاق رابط الملف</label>
              {ctx.offer && t === "study" && (
                <label className="flex items-center gap-2 text-sm text-slate-600 pb-2" title="مخفي افتراضياً حتى لا يتواصل العميل مع الجهة مباشرة">
                  <input type="checkbox" checked={showLender} onChange={(e) => setShowLender(e.target.checked)} /> إظهار اسم الجهة ({ctx.offer.lender})
                </label>
              )}
            </div>
          )}
          <textarea className="input min-h-[420px] font-[inherit] leading-7 text-[15px]" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2">
            {isClient && api.configured && canEdit && (
              <button type="button" className="btn-primary !bg-emerald-700 hover:!bg-emerald-800" onClick={direct} disabled={pending || !num}>
                {pending ? "جارٍ الإرسال…" : "📤 إرسال من رقم الشركة"}
              </button>
            )}
            <button type="button" className={api.configured && isClient ? "btn-ghost" : "btn-primary !bg-emerald-600 hover:!bg-emerald-700"} onClick={send} disabled={pending}>💬 {api.configured && isClient ? "فتح في واتساب" : "إرسال عبر واتساب"}</button>
            <button type="button" className="btn-ghost" onClick={() => { navigator.clipboard.writeText(text); setNote("نُسخت الرسالة ✓"); }}>نسخ</button>
            <button type="button" className="btn-ghost" onClick={() => setText(msg)}>استرجاع النص الأصلي</button>
            {note && <span className="text-sm text-emerald-700">{note}</span>}
            {err && <span className="text-sm text-rose-600">{err}</span>}
          </div>
          {isClient && api.configured && (
            <p className={`text-xs ${api.window.open ? "text-emerald-700" : "text-amber-700"}`}>
              {api.window.open
                ? "● المحادثة مفتوحة (راسلنا العميل خلال 24 ساعة) — تُرسل الرسالة كما هي."
                : "● العميل لم يراسلنا خلال 24 ساعة — حسب سياسة واتساب يُرسل له قالب متابعة معتمد مع رابط ملفه، وبعد ما يرد تقدر ترسل النص الكامل."}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {api.configured ? <Thread items={api.thread} /> : (
          <div className="card p-4 text-xs text-slate-500 leading-5">
            <b className="text-slate-700">واتساب للأعمال غير مفعّل بعد.</b> حالياً الإرسال يفتح واتساب من جوالك. بعد ربط رقم الشركة تُرسل الرسائل مباشرة، وتظهر ردود العميل ومستنداته هنا وفي ملفه تلقائياً.
          </div>
        )}
        <div className="card p-4">
          <div className="text-xs font-semibold text-slate-500 mb-2">معاينة</div>
          <div className="rounded-2xl bg-[#efeae2] p-3">
            <div className="ms-auto max-w-[95%] rounded-xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-[13.5px] leading-6 shadow-sm whitespace-pre-wrap break-words" dir="rtl">
              <WaRender text={text} />
            </div>
          </div>
        </div>
        <div className="card p-4 space-y-2">
          <h3 className="font-bold text-sm">🔗 رابط ملف العميل</h3>
          <p className="text-xs text-slate-500 leading-5">صفحة خاصة بالعميل يتابع فيها مراحل ملفه ويرفع مستنداته الناقصة بنفسه. لا تظهر فيها أتعابنا ولا رقم الهوية، وتنتهي بعد 14 يوماً.</p>
          {link ? (
            <>
              <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-xs num break-all" dir="ltr">{link}</div>
              {linkInfo && <div className="text-[11px] text-slate-400">ينتهي {linkInfo.expires.slice(0, 10)} · فُتح {linkInfo.views} مرة{linkInfo.lastView ? ` · آخرها ${linkInfo.lastView}` : ""}</div>}
              <div className="flex gap-2">
                <a href={link} target="_blank" className="btn-ghost btn-sm">فتح</a>
                {canEdit && <button type="button" className="btn-ghost btn-sm text-rose-600" onClick={() => start(async () => { await revokeLinks(clientId); setLink(null); })}>إلغاء الرابط</button>}
              </div>
            </>
          ) : canEdit && !clientBlocked ? (
            <button type="button" className="btn-primary btn-sm" disabled={pending} onClick={() => start(async () => { const r = await createLink(clientId); if (r.url) setLink(r.url); })}>إنشاء رابط</button>
          ) : <p className="text-xs text-slate-400">لا يوجد رابط فعّال</p>}
        </div>
      </div>
    </div>
  );
}

export type WaApi = {
  configured: boolean;
  window: { open: boolean; lastIn: string | null };
  thread: { id: number; direction: "in" | "out"; type: string; body: string | null; status: string | null; error: string | null; created_at: string; doc_id: number | null; who: string | null }[];
};

const STATUS_MARK: Record<string, string> = { sent: "✓", delivered: "✓✓", read: "✓✓ قُرئت", failed: "✕ فشلت" };

function Thread({ items }: { items: WaApi["thread"] }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold text-slate-500 mb-2">محادثة واتساب مع العميل</div>
      {items.length === 0 ? <p className="text-xs text-slate-400">لا توجد رسائل بعد</p> : (
        <div className="rounded-2xl bg-[#efeae2] p-3 space-y-2 max-h-[420px] overflow-y-auto flex flex-col-reverse">
          {items.map((m) => (
            <div key={m.id} className={`max-w-[90%] rounded-xl px-3 py-2 text-[13px] leading-6 shadow-sm whitespace-pre-wrap break-words ${m.direction === "out" ? "ms-auto bg-[#d9fdd3] rounded-tr-sm" : "me-auto bg-white rounded-tl-sm"}`} dir="rtl">
              {m.doc_id ? <span className="block text-xs font-semibold text-emerald-800">📎 مستند حُفظ في ملف العميل</span> : null}
              <WaRender text={(m.body ?? "").slice(0, 600)} />
              <div className="mt-1 text-[10px] text-slate-500 num" dir="ltr">
                {m.created_at.slice(5, 16)}{m.direction === "out" ? ` · ${m.who ?? ""} ${STATUS_MARK[m.status ?? ""] ?? ""}` : ""}
              </div>
              {m.error && <div className="text-[11px] text-rose-600">{m.error}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** عرض تنسيق واتساب: *عريض* و _مائل_ */
function WaRender({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*|_[^_\n]+_)/g);
  return <>{parts.map((p, i) => p.startsWith("*") && p.endsWith("*") && p.length > 2 ? <b key={i}>{p.slice(1, -1)}</b> : p.startsWith("_") && p.endsWith("_") && p.length > 2 ? <i key={i} className="text-slate-600">{p.slice(1, -1)}</i> : <span key={i}>{p}</span>)}</>;
}
