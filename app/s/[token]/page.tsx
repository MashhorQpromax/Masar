import type { Metadata } from "next";
import { get, all, run } from "@/lib/db";
import { getClient, waContextFor } from "@/lib/data";
import { CLIENT_STEPS, clientStepIndex, STAGE_NEXT } from "@/lib/whatsapp";
import { Logo } from "@/components/logo";
import PortalUpload from "@/components/portal-upload";
import { portalUpload } from "@/app/actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ملفك — مسار", robots: { index: false, follow: false } };

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
      <main className="min-h-screen grid place-items-center p-6 bg-slate-50">
        <div className="card p-8 max-w-sm text-center"><Logo /><p className="mt-6 font-bold">انتهت صلاحية هذا الرابط</p><p className="text-sm text-slate-500 mt-2">تواصل مع مسؤول ملفك لإرسال رابط جديد.</p></div>
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

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="bg-brand-900 text-white">
        <div className="max-w-2xl mx-auto px-5 pt-6 pb-10">
          <Logo light />
          <h1 className="text-2xl font-bold mt-8">أهلاً {ctx.firstName} 🌿</h1>
          <p className="text-brand-100/80 mt-1 text-sm">هذه صفحة ملفك لدى مسار للحلول التمويلية — ملف رقم <span className="num">{c.file_no}</span></p>
        </div>
      </div>
      <div className="max-w-2xl mx-auto px-5 -mt-6 pb-12 space-y-4">
        <section className="card p-5">
          <h2 className="font-bold mb-4">أين وصل ملفك</h2>
          <ol className="space-y-3">
            {CLIENT_STEPS.map((s, i) => (
              <li key={s.title} className="flex items-center gap-3">
                <span className={`size-7 shrink-0 rounded-full grid place-items-center text-xs font-bold ${i < step ? "bg-emerald-500 text-white" : i === step ? "bg-brand-600 text-white ring-4 ring-brand-100" : "bg-slate-100 text-slate-400"}`}>{i < step ? "✓" : i + 1}</span>
                <span className={`text-sm ${i === step ? "font-bold" : i < step ? "text-slate-600" : "text-slate-400"}`}>{s.title}</span>
              </li>
            ))}
          </ol>
          {d && STAGE_NEXT[d.stage] && <p className="mt-4 rounded-xl bg-brand-50 text-brand-900 p-3 text-sm">{STAGE_NEXT[d.stage]}</p>}
        </section>

        {d && (
          <section className="card p-5">
            <h2 className="font-bold mb-3">الحل المقترح لك</h2>
            <ol className="list-decimal pr-5 space-y-1.5 text-sm text-slate-700">
              {d.settleTotal > 0 && <li>نسدد عنك قرارات التنفيذ والمتعثرات ونرفع الإيقاف.</li>}
              {d.payoffTotal > 0 && <li>نُنهي مخالصة تمويلك الحالي{d.payoffLenders.length ? ` لدى ${d.payoffLenders.join(" و")}` : ""}.</li>}
              <li>نحدّث سجلك في سمة بعد التسوية.</li>
              <li>نتقدم لك{d.bankName ? ` على ${d.bankName}` : ""} بتمويل عقاري{d.personal > 0 ? " وشخصي" : ""} جديد.</li>
            </ol>
            {(d.verdict === "go" || d.verdict === "tight") && (
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">تمويل عقاري تقريباً</div><div className="text-lg font-bold num">{n(d.mortgage)}</div></div>
                {d.personal > 0 && <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">تمويل شخصي تقريباً</div><div className="text-lg font-bold num">{n(d.personal)}</div></div>}
                {d.clientNet > 0 && <div className="rounded-xl bg-emerald-50 p-3 col-span-2"><div className="text-xs text-emerald-700">يبقى لك نقداً بعد إنهاء الالتزامات تقريباً</div><div className="text-xl font-bold num text-emerald-800">{n(d.clientNet)} ريال</div></div>}
              </div>
            )}
            <p className="text-[11px] text-slate-400 mt-3">الأرقام تقديرية وتعتمد على موافقة البنك والتقييم الرسمي.</p>
          </section>
        )}
        {!d && ctx.projectHeadline && <section className="card p-5"><h2 className="font-bold mb-2">نتيجة الدراسة</h2><p className="text-sm text-slate-700">{ctx.projectHeadline}</p></section>}

        <section className="card p-5">
          <h2 className="font-bold mb-1">المستندات المطلوبة منك</h2>
          {need.length === 0 ? <p className="text-sm text-emerald-700 mt-2">✅ وصلتنا كل المستندات المطلوبة، شكراً لك.</p> : (
            <>
              <p className="text-xs text-slate-500 mb-4">صوّر المستند بوضوح أو ارفعه PDF (حتى 10 ميجابايت).</p>
              <ul className="space-y-3">{need.map((x) => <li key={x.id}><PortalUpload label={x.label} rejected={x.status === "rejected"} action={portalUpload.bind(null, token, x.id)} /></li>)}</ul>
            </>
          )}
          {done.length > 0 && (
            <ul className="mt-3 space-y-2">{done.map((x) => <li key={x.id} className="rounded-xl bg-emerald-50 ring-1 ring-emerald-200 px-3 py-2 text-sm text-emerald-800">✅ {x.label} — <span className="text-xs">{x.status === "verified" ? "تم التحقق" : "وصلنا، شكراً لك"}</span></li>)}</ul>
          )}
        </section>

        <p className="text-center text-[11px] text-slate-400 leading-5 px-4">هذه الصفحة خاصة بك فلا تشاركها. صالحة حتى <span className="num">{link.expires_at.slice(0, 10)}</span>. بياناتك محمية وفق نظام حماية البيانات الشخصية.</p>
      </div>
    </main>
  );
}
