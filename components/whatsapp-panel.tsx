"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { buildMessage, clientGate, normalizePhone, waLink, WA_TEMPLATES, type WaContext, type WaTemplate } from "@/lib/whatsapp";
import { Icon } from "@/components/icon";
import { Callout, Empty } from "@/components/ui";

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
  const [view, setView] = useState<"edit" | "preview">("edit");
  const msg = useMemo(() => buildMessage(t, { ...ctx, showLender, link: withLink && WA_TEMPLATES[t].client ? link : null }), [t, ctx, link, withLink, showLender]);
  const clientBlocked = !gate.allowed.some((k) => WA_TEMPLATES[k].client);
  const [text, setText] = useState(msg);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => setText(msg), [msg]);
  const isClient = WA_TEMPLATES[t].client;
  const num = isClient ? normalizePhone(to) : null;
  const flash = (ok: string | null, e: string | null = null) => { setNote(ok); setErr(e); };

  const send = () => {
    window.open(waLink(num, text), "_blank", "noopener");
    start(async () => { await log(clientId, WA_TEMPLATES[t].label, text); flash("سُجلت الرسالة في الملف"); });
  };
  const direct = () => start(async () => { const r = await sendDirect(clientId, text); flash(r.ok ?? null, r.error ?? null); });

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
      <div className="space-y-3">
        <div className="seg overflow-x-auto max-w-full">
          {(Object.keys(WA_TEMPLATES) as WaTemplate[]).map((k) => {
            const off = !gate.allowed.includes(k);
            return (
              <button key={k} type="button" disabled={off} title={off ? "غير متاحة لهذا الملف" : WA_TEMPLATES[k].hint} onClick={() => { setT(k); flash(null); }}
                className={`seg-item ${t === k ? "seg-on" : ""} disabled:opacity-35 disabled:cursor-not-allowed`}>
                {!WA_TEMPLATES[k].client && <Icon name="lock" className="size-3.5" />}{WA_TEMPLATES[k].label}
              </button>
            );
          })}
        </div>
        {gate.reason && <Callout tone={gate.tone === "red" ? "red" : "amber"}>{gate.reason}</Callout>}
        {!isClient && <Callout tone="amber" icon="lock">فيها أتعابنا ورأس المال. لشريك أو ممول فقط، لا للعميل.</Callout>}

        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 border-b border-slate-100">
            {isClient && (
              <div className="relative">
                <Icon name="phone" className="size-4 text-slate-400 absolute start-3 top-3 pointer-events-none" />
                <input aria-label="جوال العميل" className={`input num pe-9 w-48 ${num ? "" : "!border-rose-300"}`} dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} placeholder="05xxxxxxxx" />
              </div>
            )}
            {isClient && <label className="inline-flex items-center gap-2 text-[13px] text-slate-600"><input type="checkbox" className="size-4 accent-brand-700" checked={withLink} onChange={(e) => setWithLink(e.target.checked)} />رابط الملف</label>}
            {isClient && ctx.offer && t === "study" && <label className="inline-flex items-center gap-2 text-[13px] text-slate-600"><input type="checkbox" className="size-4 accent-brand-700" checked={showLender} onChange={(e) => setShowLender(e.target.checked)} />اسم الجهة</label>}
            <div className="seg ms-auto !p-0.5">
              <button type="button" onClick={() => setView("edit")} className={`seg-item !h-7 !px-3 !text-xs ${view === "edit" ? "seg-on" : ""}`}>تحرير</button>
              <button type="button" onClick={() => setView("preview")} className={`seg-item !h-7 !px-3 !text-xs ${view === "preview" ? "seg-on" : ""}`}>معاينة</button>
            </div>
          </div>
          {view === "edit" ? (
            <textarea aria-label="نص الرسالة" className="block w-full min-h-[400px] resize-y bg-transparent px-5 py-4 text-[15px] leading-8 outline-none" value={text} onChange={(e) => setText(e.target.value)} />
          ) : (
            <div className="min-h-[400px] bg-sand/50 p-5"><Bubble out><WaRender text={text} /></Bubble></div>
          )}
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-slate-100">
            {isClient && api.configured && canEdit ? (
              <>
                <button type="button" className="btn-brand" onClick={direct} disabled={pending || !num}><Icon name="send" className="size-4" />{pending ? "جارٍ الإرسال" : "إرسال من رقم الشركة"}</button>
                <button type="button" className="btn-ghost" onClick={send} disabled={pending}>فتح في واتساب</button>
              </>
            ) : (
              <button type="button" className="btn-brand" onClick={send} disabled={pending}><Icon name="send" className="size-4" />إرسال عبر واتساب</button>
            )}
            <button type="button" className="btn-quiet" title="نسخ" onClick={() => { navigator.clipboard.writeText(text); flash("نُسخت الرسالة"); }}><Icon name="copy" className="size-4" />نسخ</button>
            {text !== msg && <button type="button" className="btn-quiet" onClick={() => setText(msg)}><Icon name="undo" className="size-4" />النص الأصلي</button>}
            {note && <span className="text-[13px] text-emerald-700 inline-flex items-center gap-1.5"><Icon name="check" className="size-4" />{note}</span>}
            {err && <span className="text-[13px] text-rose-700">{err}</span>}
          </div>
        </div>
        {isClient && api.configured && (
          <p className="text-xs text-slate-500 flex items-center gap-2">
            <span className={`size-2 rounded-full ${api.window.open ? "bg-emerald-500" : "bg-amber-400"}`} />
            {api.window.open ? "المحادثة مفتوحة، تُرسل الرسالة كما هي." : "لم يراسلنا العميل خلال 24 ساعة، فيُرسل له قالب المتابعة المعتمد أولاً."}
          </p>
        )}
      </div>

      <div className="space-y-4">
        {api.configured && <Thread items={api.thread} />}
        <div className="card p-5">
          <div className="flex items-center gap-2 font-bold text-sm"><Icon name="link" className="size-4 text-slate-400" />رابط ملف العميل</div>
          {link ? (
            <>
              <div className="mt-3 rounded-[10px] bg-slate-100 px-3 py-2 text-xs num break-all" dir="ltr">{link}</div>
              {linkInfo && <div className="mt-2 text-[11px] text-slate-500">ينتهي <span className="num">{linkInfo.expires.slice(0, 10)}</span> · فُتح <span className="num">{linkInfo.views}</span> مرة</div>}
              <div className="mt-3 flex gap-2">
                <a href={link} target="_blank" className="btn-ghost btn-sm"><Icon name="external" className="size-3.5" />فتح</a>
                <button type="button" className="btn-ghost btn-sm" onClick={() => { navigator.clipboard.writeText(link); flash("نُسخ الرابط"); }}><Icon name="copy" className="size-3.5" />نسخ</button>
                {canEdit && <button type="button" className="btn-quiet btn-sm !text-rose-700 ms-auto" onClick={() => start(async () => { await revokeLinks(clientId); setLink(null); })}>إلغاء</button>}
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-[13px] text-slate-500 leading-6">صفحة يتابع فيها العميل ملفه ويرفع مستنداته. لا تظهر فيها أتعابنا، وتنتهي بعد 14 يوماً.</p>
              {canEdit && !clientBlocked && <button type="button" className="btn-ghost btn-sm mt-3" disabled={pending} onClick={() => start(async () => { const r = await createLink(clientId); if (r.url) setLink(r.url); })}><Icon name="plus" className="size-3.5" />إنشاء رابط</button>}
            </>
          )}
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

const STATUS_MARK: Record<string, string> = { sent: "أُرسلت", delivered: "وصلت", read: "قُرئت", failed: "فشلت" };

function Bubble({ out, children }: { out?: boolean; children: React.ReactNode }) {
  return <div className={`max-w-[92%] w-fit rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-7 whitespace-pre-wrap break-words ${out ? "ms-auto bg-brand-800 text-white rounded-ee-md [&_i]:text-white/70" : "me-auto bg-white border border-slate-200/70 rounded-es-md"}`} dir="rtl">{children}</div>;
}

function Thread({ items }: { items: WaApi["thread"] }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-5 pt-4 pb-3 font-bold text-sm">المحادثة</div>
      {items.length === 0 ? <Empty art="chat" title="لا رسائل بعد" /> : (
        <div className="bg-sand/50 p-3 space-y-2 max-h-[440px] overflow-y-auto flex flex-col-reverse">
          {items.map((m) => (
            <Bubble key={m.id} out={m.direction === "out"}>
              {m.doc_id ? <span className="flex items-center gap-1.5 text-xs font-semibold opacity-80"><Icon name="clip" className="size-3.5" />مستند حُفظ في الملف</span> : null}
              <WaRender text={(m.body ?? "").slice(0, 600)} />
              <span className="mt-1 block text-[10px] opacity-60 num" dir="ltr">{m.created_at.slice(5, 16)}{m.direction === "out" ? ` · ${m.who ?? ""} ${STATUS_MARK[m.status ?? ""] ?? ""}` : ""}</span>
              {m.error && <span className="block text-[11px] text-rose-300">{m.error}</span>}
            </Bubble>
          ))}
        </div>
      )}
    </div>
  );
}

/** عرض تنسيق واتساب: *عريض* و _مائل_ */
function WaRender({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*|_[^_\n]+_)/g);
  return <>{parts.map((p, i) => p.startsWith("*") && p.endsWith("*") && p.length > 2 ? <b key={i}>{p.slice(1, -1)}</b> : p.startsWith("_") && p.endsWith("_") && p.length > 2 ? <i key={i} className="text-slate-500">{p.slice(1, -1)}</i> : <span key={i}>{p}</span>)}</>;
}
