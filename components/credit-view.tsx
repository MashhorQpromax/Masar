import type { CreditAnalysis, CreditReport, Access } from "@/lib/simah";
import { typeLabel } from "@/lib/simah";
import { Badge, sar } from "@/components/ui";
import { confirmCredit } from "@/app/actions";

const GRADE_BG: Record<string, string> = { A: "from-emerald-700 to-emerald-900", B: "from-teal-700 to-teal-900", C: "from-amber-600 to-amber-800", D: "from-orange-700 to-orange-900", E: "from-rose-700 to-rose-900" };
const ACCESS: Record<Access, [string, string]> = { open: ["مفتوح", "green"], conditional: ["مشروط", "amber"], closed: ["مغلق", "red"] };
const ST: Record<string, [string, string]> = { current: ["منتظم", "green"], late: ["متأخر", "amber"], default: ["متعثر", "red"], settled: ["متعثر سُدد", "slate"], closed: ["مغلق", "slate"] };
const LVL: Record<string, string> = { block: "bg-rose-50 ring-rose-200 text-rose-900", warn: "bg-amber-50 ring-amber-200 text-amber-900", info: "bg-sky-50 ring-sky-200 text-sky-900", good: "bg-emerald-50 ring-emerald-200 text-emerald-900" };

export default function CreditView({ clientId, reportId, r, a, createdAt, author, canEdit }: {
  clientId: number; reportId: number; r: CreditReport & { warnings?: string[]; confidence?: string }; a: CreditAnalysis; createdAt: string; author: string | null; canEdit: boolean;
}) {
  const live = r.facilities.filter((f) => f.status === "current" || f.status === "late");
  const defs = r.facilities.filter((f) => f.status === "default" || f.status === "settled");
  const closed = r.facilities.filter((f) => f.status === "closed");
  const j = r.judgments ?? [];
  const s = a.stats;
  return (
    <div className="space-y-5">
      <div className={`rounded-3xl bg-gradient-to-l ${GRADE_BG[a.grade]} text-white p-6 relative overflow-hidden`}>
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <div className="text-xs text-white/70">تقييم السجل الائتماني (سمة {r.reportDate ?? ""})</div>
            <div className="text-3xl font-bold mt-1">{a.grade} — {a.gradeLabel}</div>
            <div className="mt-2 text-sm text-white/85">حُلل {dateOnly(createdAt)}{author ? ` بواسطة ${author}` : ""} · دقة القراءة الآلية: {r.confidence === "high" ? "عالية" : r.confidence === "medium" ? "متوسطة — راجع" : "منخفضة — راجع يدوياً"}</div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1 max-w-3xl">
            <Hero label="إيقاف خدمات" v={r.serviceSuspension ? (r.suspensionAssumed ? "مرجّح" : "نعم") : "لا"} />
            <Hero label="قرارات تنفيذ قائمة" v={`${s.activeJudgments}`} u={s.activeJudgments ? `${sar(s.activeJudgmentsAmount)} ريال` : ""} />
            <Hero label="تعثرات قائمة" v={`${s.activeDefaults}`} u={s.activeDefaults ? `${sar(s.activeDefaultsAmount)} ريال` : ""} />
            <Hero label="المطلوب لتنظيف السجل" v={sar(s.totalToClear)} u="ريال تقريباً" />
          </div>
        </div>
      </div>

      {(r.warnings?.length ?? 0) > 0 && (
        <div className="card p-4 bg-amber-50/60 ring-amber-200 text-sm text-amber-900 space-y-1">
          <div className="font-bold">راجع قبل الاعتماد</div>
          {r.warnings!.map((w, i) => <div key={i}>• {w}</div>)}
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card p-5 lg:col-span-2">
          <h3 className="font-bold mb-3">الموانع والملاحظات</h3>
          <div className="space-y-2">
            {a.blockers.map((b, i) => <div key={"b" + i} className={`rounded-xl ring-1 p-3 text-sm ${LVL.block}`}>⛔ {b}</div>)}
            {a.findings.map((f, i) => <div key={"f" + i} className={`rounded-xl ring-1 p-3 text-sm ${LVL[f.level]}`}>{f.text}</div>)}
          </div>
        </div>
        <div className="space-y-4">
          <div className="card p-5">
            <h3 className="font-bold mb-3">من يقبل العميل الآن؟</h3>
            {([["البنوك", a.banks], ["شركات التمويل", a.financeCompanies]] as const).map(([l, x]) => (
              <div key={l} className="flex items-start justify-between gap-3 py-2 border-b last:border-0 border-slate-100">
                <div><div className="font-semibold text-sm">{l}</div><div className="text-xs text-slate-500">{x.reason}{x.reopenInMonths ? ` · تنفتح بعد ≈ ${x.reopenInMonths} شهراً` : ""}</div></div>
                <Badge tone={ACCESS[x.access][1]} dot>{ACCESS[x.access][0]}</Badge>
              </div>
            ))}
          </div>
          <div className="card p-5">
            <h3 className="font-bold mb-3">خطة العمل بالترتيب</h3>
            <ol className="space-y-2 text-sm list-decimal pr-5">{a.actions.map((x, i) => <li key={i}>{x}</li>)}</ol>
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Mini l="التزامات نشطة" v={`${live.length}`} h={`أقساط ${sar(s.monthlyInstallments)} / شهر`} />
        <Mini l="المتبقي على النشطة" v={sar(live.reduce((t, f) => t + (f.balance ?? 0), 0))} h="ريال" />
        <Mini l="تعثرات (كل السجل)" v={`${s.defaults}`} h={`بنك ${s.bankDefaults} · شركة تمويل ${s.financeCoDefaults} · اتصالات ${s.telecomDefaults}`} />
        <Mini l="استعلامات" v={`${s.inquiries6m} / ${s.inquiries12m}`} h="آخر 6 أشهر / آخر 12 شهراً" />
      </div>

      {j.length > 0 && (
        <Table title="قرارات محاكم التنفيذ" head={["تاريخ القرار", "المبلغ", "المتبقي", "الحالة", "على الأرجح لصالح"]}
          rows={j.map((x) => [x.date ?? "—", sar(x.amount), sar(x.remaining ?? x.amount), <Badge key="s" tone={x.active ? "red" : "slate"}>{x.state || (x.active ? "قائم" : "منتهٍ")}</Badge>, x.creditor ?? "—"])} />
      )}
      {defs.length > 0 && (
        <Table title="المنتجات المتعثرة" head={["الجهة", "النوع", "تصنيف الجهة", "تاريخ الإدراج", "مبلغ التعثر", "المتبقي الآن", "الحالة"]}
          rows={defs.map((f) => [f.lender, f.product, typeLabel(f.creditorType), f.defaultListedAt ?? "—", sar(f.defaultAmount), sar(f.defaultNow ?? (f.status === "settled" ? 0 : f.balance)), <Badge key="s" tone={f.status === "settled" ? "slate" : "red"}>{f.defaultState || ST[f.status][0]}</Badge>])} />
      )}
      {live.length > 0 && (
        <Table title="الالتزامات النشطة" head={["الجهة", "النوع", "الحد/المبلغ", "المتبقي", "القسط", "ينتهي", "الحالة"]}
          rows={live.map((f) => [f.lender, f.product, sar(f.limit), sar(f.balance), sar(f.installment), f.endAt ?? "—", <Badge key="s" tone={ST[f.status][1]}>{ST[f.status][0]}{f.overdue ? ` · متأخر ${sar(f.overdue)}` : ""}</Badge>])} />
      )}
      {closed.length > 0 && (
        <details className="card p-5"><summary className="font-bold cursor-pointer">منتجات مغلقة ({closed.length}) — تاريخ سداد جيد</summary>
          <div className="mt-3 text-sm text-slate-600 space-y-1">{closed.map((f, i) => <div key={i}>{f.lender} · {f.product} · {sar(f.limit)} · {f.openedAt ?? ""}</div>)}</div>
        </details>
      )}
      {(r.inquiries?.length ?? 0) > 0 && (
        <details className="card p-5"><summary className="font-bold cursor-pointer">سجل الاستعلامات ({r.inquiries!.length})</summary>
          <div className="mt-3 text-sm text-slate-600 space-y-1">{r.inquiries!.map((q, i) => <div key={i}><span className="num">{q.date}</span> · {q.lender} · {q.product}{q.amount ? ` · ${sar(q.amount)}` : ""}</div>)}</div>
        </details>
      )}

      {canEdit && (
        <form action={confirmCredit.bind(null, clientId, reportId)} className="card p-5 space-y-3">
          <h3 className="font-bold">تحقق المحلل (أبشر / ناجز)</h3>
          <p className="text-xs text-slate-500">سمة لا تُظهر إيقاف الخدمات مباشرة. تحقق من أبشر أو ناجز وأكّد هنا، فيُعاد الحساب فوراً.</p>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="suspension" value="yes" defaultChecked={r.serviceSuspension && !r.suspensionAssumed} /> يوجد إيقاف خدمات</label>
            <label className="flex items-center gap-2"><input type="radio" name="suspension" value="no" defaultChecked={!r.serviceSuspension} /> لا يوجد إيقاف</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="travel_ban" defaultChecked={!!r.travelBan} /> منع سفر</label>
          </div>
          <textarea name="note" className="input min-h-20" placeholder="ملاحظة (مثلاً: تواصلنا مع الدائن وقبل تسوية بخصم 20%)" defaultValue={r.notes ?? ""} />
          <button className="btn-primary">حفظ وإعادة الحساب</button>
        </form>
      )}
    </div>
  );
}

const dateOnly = (s: string) => s.slice(0, 10);
function Hero({ label, v, u }: { label: string; v: string; u?: string }) {
  return <div className="rounded-2xl bg-white/10 ring-1 ring-white/15 p-3"><div className="text-[11px] text-white/70">{label}</div><div className="text-xl font-bold num text-start mt-1">{v}</div>{u ? <div className="text-[11px] text-white/60 mt-0.5">{u}</div> : null}</div>;
}
function Mini({ l, v, h }: { l: string; v: string; h: string }) {
  return <div className="card p-4"><div className="text-xs text-slate-500">{l}</div><div className="text-xl font-bold num text-start mt-1">{v}</div><div className="text-xs text-slate-400 mt-1">{h}</div></div>;
}
function Table({ title, head, rows }: { title: string; head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="card overflow-x-auto">
      <div className="px-5 pt-4 font-bold">{title}</div>
      <table className="w-full min-w-[700px] mt-2"><thead><tr>{head.map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, k) => <td key={k} className="td">{c}</td>)}</tr>)}</tbody></table>
    </div>
  );
}
