import type { Metadata } from "next";
import { get, all, run } from "@/lib/db";
import { getClient, waContextFor } from "@/lib/data";
import { CLIENT_STEPS, clientStepIndex, STAGE_NEXT } from "@/lib/whatsapp";
import { Logo } from "@/components/logo";
import { Icon } from "@/components/icon";
import { Spot } from "@/components/art";
import PortalUpload from "@/components/portal-upload";
import { portalUpload } from "@/app/actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ملفك · مسار", robots: { index: false, follow: false } };

const n = (v: number) => Math.round(v).toLocaleString("en-US");

export default async function ClientPortal({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = /^[A-Za-z0-9_-]{20,40}$/.test(token)
    ? await get<{ client_id: number; expires_at: string; user_name: string | null }>(
        "SELECT s.client_id, s.expires_at, u.name user_name FROM share_links s LEFT JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.revoked = 0 AND s.expires_at > datetime('now')", token)
    : undefined;
  const c = link ? await getClient(link.client_id) : null;
  if (!link || !c) {
    return (
      <main className="min-h-dvh grid place-items-center p-6 bg-canvas">
        <div className="card p-8 max-w-sm w-full text-center animate-rise">
          <div className="flex justify-center"><Logo /></div>
          <Spot kind="lost" className="w-40 mx-auto mt-6" />
          <p className="mt-4 font-bold text-lg font-display">انتهت صلاحية الرابط</p>
          <p className="text-sm text-slate-500 mt-1.5">اطلب رابطاً جديداً من مسؤول ملفك.</p>
        </div>
      </main>
    );
  }
  await run("UPDATE share_links SET views = views + 1, last_view_at = datetime('now') WHERE token = ?", token);
  const ctx = await waContextFor(c, link.user_name ?? "فريق مسار", null);
  const docs = await all<{ id: number; label: string; status: string; required: number }>("SELECT id, label, status, required FROM documents WHERE client_id = ? ORDER BY required DESC, id", c.id);
  const need = docs.filter((d) => d.required && (d.status === "missing" || d.status === "rejected"));
  const done = docs.filter((d) => d.status === "received" || d.status === "verified");
  const d = ctx.deal;
  const step = clientStepIndex(d?.stage ?? "study");
  const pct = Math.round((step / (CLIENT_STEPS.length - 1)) * 100);

  return (
    <main className="min-h-dvh bg-canvas">
      <header className="relative overflow-hidden bg-brand-900 text-white">
        <svg viewBox="0 0 400 120" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-28 w-full" aria-hidden>
          <path d="M-10 120 V44 C 60 44, 70 12, 140 12 S 220 44, 290 40 S 360 14, 410 18 V120z" fill="#0a4a3b" />
          <path d="M-10 44 C 60 44, 70 12, 140 12 S 220 44, 290 40 S 360 14, 410 18" fill="none" stroke="#c29a4b" strokeWidth="2" strokeLinecap="round" pathLength={1} className="draw" style={{ ["--draw" as string]: "2.2s", ["--delay" as string]: ".2s" }} vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="relative max-w-xl mx-auto px-5 pt-6 pb-28">
          <Logo light />
          <div className="mt-9 text-[11px] font-semibold tracking-wide text-white/60">ملف <span className="num">{c.file_no}</span></div>
          <h1 className="text-[28px] font-bold mt-1 text-white">{ctx.firstName ? `أهلاً ${ctx.firstName}` : "أهلاً بك"}</h1>
        </div>
      </header>

      <div className="max-w-xl mx-auto px-4 -mt-12 pb-14 space-y-4 stagger relative">
        <section className="card p-5 sm:p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-bold text-[15px]">أين وصل ملفك</h2>
            <span className="text-xs text-slate-500">الخطوة <span className="num">{step + 1}</span> من <span className="num">{CLIENT_STEPS.length}</span></span>
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-gold origin-right grow-x" style={{ width: `${Math.max(6, pct)}%` }} /></div>
          <ol className="mt-5">
            {CLIENT_STEPS.map((s, i) => (
              <li key={s.title} className="relative flex gap-3 pb-4 last:pb-0">
                {i < CLIENT_STEPS.length - 1 && <span className={`absolute top-7 bottom-0 start-[13px] w-px ${i < step ? "bg-brand-600" : "bg-slate-200"}`} />}
                <span className={`relative size-7 shrink-0 rounded-full grid place-items-center text-xs font-bold ${i < step ? "bg-brand-700 text-white" : i === step ? "bg-gold text-white" : "bg-slate-100 text-slate-400"}`}>
                  {i === step && <span className="absolute inset-0 rounded-full bg-gold/40 ring-pulse" />}
                  {i < step ? <Icon name="check" className="size-3.5" strokeWidth={2.4} /> : <span className="num relative">{i + 1}</span>}
                </span>
                <div className="pt-0.5 min-w-0">
                  <div className={`text-sm ${i === step ? "font-bold" : i < step ? "text-slate-600" : "text-slate-400"}`}>{s.title}</div>
                  {i === step && d && STAGE_NEXT[d.stage] && <p className="text-[13px] text-slate-600 mt-1 leading-6">{STAGE_NEXT[d.stage]}</p>}
                </div>
              </li>
            ))}
          </ol>
        </section>

        {d && (
          <section className="card p-5 sm:p-6">
            <h2 className="font-bold text-[15px] mb-3">الحل المقترح لك</h2>
            {(d.verdict === "go" || d.verdict === "tight") && (
              <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-4">
                {d.clientNet > 0 && <div className="col-span-2 rounded-xl bg-brand-50 px-4 py-3.5"><div className="text-xs text-brand-800">يبقى لك نقداً تقريباً</div><div className="figure text-[30px] font-semibold text-brand-800 mt-0.5">{n(d.clientNet)} <span className="text-sm font-sans font-medium">ريال</span></div></div>}
                {d.mortgage > 0 && <div><div className="text-xs text-slate-500">تمويل عقاري</div><div className="figure text-xl font-semibold mt-0.5">{n(d.mortgage)}</div></div>}
                {d.personal > 0 && <div><div className="text-xs text-slate-500">تمويل شخصي</div><div className="figure text-xl font-semibold mt-0.5">{n(d.personal)}</div></div>}
              </div>
            )}
            <ol className="space-y-2.5 text-sm text-slate-700">
              {[
                d.settleTotal > 0 && "نسدد عنك قرارات التنفيذ والمتعثرات ونرفع الإيقاف.",
                d.payoffTotal > 0 && `نُنهي مخالصة تمويلك الحالي${d.payoffLenders.length ? ` لدى ${d.payoffLenders.join(" و")}` : ""}.`,
                "نحدّث سجلك في سمة بعد التسوية.",
                `نتقدم لك${d.bankName ? ` على ${d.bankName}` : ""} بتمويل ${d.mortgage > 0 ? "عقاري" : "شخصي"}${d.mortgage > 0 && d.personal > 0 ? " وشخصي" : ""} جديد.`,
              ].filter(Boolean).map((t, i) => <li key={i} className="flex gap-3"><span className="num size-5 shrink-0 mt-0.5 rounded-md bg-slate-100 text-[11px] font-bold text-slate-600 grid place-items-center">{i + 1}</span><span className="leading-6">{t}</span></li>)}
            </ol>
            <p className="text-[11px] text-slate-400 mt-4">أرقام تقديرية حتى موافقة الجهة والتقييم الرسمي.</p>
          </section>
        )}
        {!d && ctx.projectHeadline && <section className="card p-5 sm:p-6"><h2 className="font-bold text-[15px] mb-2">نتيجة الدراسة</h2><p className="text-sm text-slate-700 leading-7">{ctx.projectHeadline}</p></section>}

        <section className="card p-5 sm:p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-bold text-[15px]">مستنداتك</h2>
            <span className="text-xs text-slate-500"><span className="num">{done.length}</span> من <span className="num">{done.length + need.length}</span></span>
          </div>
          {need.length === 0 ? (
            <div className="mt-3 flex flex-col items-center text-center py-2"><Spot kind="docs" className="w-32" /><p className="text-sm font-semibold mt-2">وصلتنا كل المستندات</p></div>
          ) : (
            <>
              <p className="text-xs text-slate-500 mt-1 mb-3">صورة واضحة أو PDF حتى 10MB.</p>
              <ul className="space-y-2.5">{need.map((x) => <li key={x.id}><PortalUpload label={x.label} rejected={x.status === "rejected"} action={portalUpload.bind(null, token, x.id)} /></li>)}</ul>
            </>
          )}
          {done.length > 0 && need.length > 0 && (
            <ul className="mt-4 pt-3 border-t border-slate-100 space-y-2">{done.map((x) => <li key={x.id} className="flex items-center gap-2.5 text-[13px] text-slate-600"><Icon name="check-circle" className="size-4 text-emerald-600" /><span className="flex-1">{x.label}</span><span className="text-xs text-slate-400">{x.status === "verified" ? "تم التحقق" : "وصلنا"}</span></li>)}</ul>
          )}
        </section>

        <p className="flex items-center justify-center gap-2 text-center text-[11px] text-slate-400 leading-5 px-4"><Icon name="lock" className="size-3.5" />صفحة خاصة بك، صالحة حتى <span className="num">{link.expires_at.slice(0, 10)}</span></p>
      </div>
    </main>
  );
}
