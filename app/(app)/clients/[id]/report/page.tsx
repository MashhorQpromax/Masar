import { notFound } from "next/navigation";
import { all } from "@/lib/db";
import { requireUser, audit, maskId } from "@/lib/auth";
import { getClient, getObligations, studyFor } from "@/lib/data";
import { fmt, SAMA } from "@/lib/engine";
import { FINANCE_TYPE, SECTOR, SIMAH, BANKS, ELIGIBILITY, OBLIGATION_KIND, DOC_STATUS } from "@/lib/labels";
import { Logo } from "@/components/logo";
import PrintButton from "@/components/print-button";

export const dynamic = "force-dynamic";

export default async function Report({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const id = Number((await params).id);
  const c = getClient(id);
  if (!c) notFound();
  const s = studyFor(c);
  const obl = getObligations(id);
  const docs = all<{ label: string; status: keyof typeof DOC_STATUS; required: number }>("SELECT label, status, required FROM documents WHERE client_id = ? ORDER BY required DESC, id", id);
  const approved = all<{ verdict: string; analyst_opinion: string | null; name: string; created_at: string }>("SELECT s.*, u.name FROM studies s JOIN users u ON u.id = s.user_id WHERE client_id = ? ORDER BY s.id DESC LIMIT 1", id)[0];
  await audit(u, "export", "client", id, "تقرير الدراسة");
  const top = s.matches.filter((m) => m.verdict !== "fail").slice(0, 5);
  const verdict = (approved?.verdict ?? s.verdict) as keyof typeof ELIGIBILITY;

  return (
    <div className="max-w-[900px] mx-auto">
      <div className="no-print flex justify-between mb-4"><a href={`/clients/${id}?tab=study`} className="btn-ghost">→ رجوع للملف</a><PrintButton /></div>
      <article className="card p-10 print:p-0 print:border-0 text-[13px] leading-7">
        <header className="flex items-start justify-between border-b-2 border-brand-700 pb-5 mb-6">
          <Logo />
          <div className="text-left text-xs text-slate-500 leading-5"><div className="font-bold text-ink text-sm">تقرير دراسة تمويل</div><div className="num">{c.file_no}</div><div>{new Date().toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { dateStyle: "long" })}</div><div>سري — للاستخدام الداخلي</div></div>
        </header>

        <section className="grid grid-cols-[1fr_auto] gap-6 items-start mb-6">
          <div>
            <h1 className="text-2xl font-bold">{c.full_name}</h1>
            <div className="text-slate-600">{FINANCE_TYPE[c.finance_type]} بمبلغ <b className="num">{fmt(c.requested_amount)}</b> ريال{c.requested_tenor ? <> لمدة <b className="num">{c.requested_tenor}</b> شهراً</> : null}{c.purpose ? ` — ${c.purpose}` : ""}</div>
          </div>
          <div className={`rounded-2xl px-5 py-3 text-center ${verdict === "eligible" ? "bg-emerald-50 text-emerald-800" : verdict === "conditional" ? "bg-amber-50 text-amber-800" : verdict === "pending" ? "bg-slate-100" : "bg-rose-50 text-rose-800"}`}>
            <div className="text-[11px]">الحكم</div><div className="text-lg font-bold">{ELIGIBILITY[verdict].emoji} {ELIGIBILITY[verdict].label}</div>
          </div>
        </section>

        <H>1. بيانات العميل</H>
        <table className="w-full mb-6 text-[12.5px]"><tbody>
          {[
            ["رقم الهوية", maskId(c.national_id), "العمر", c.birth_year ? `${new Date().getFullYear() - c.birth_year} سنة` : "—"],
            ["جهة العمل", c.employer ?? "—", "التصنيف", SECTOR[c.sector]],
            ["مدة الخدمة", c.service_months != null ? `${c.service_months} شهر` : "—", "بنك الراتب", c.salary_bank ? BANKS[c.salary_bank] : "—"],
            ["الراتب الأساسي", fmt(c.basic_salary), "الراتب الإجمالي", fmt(c.total_salary)],
            ["السجل الائتماني", SIMAH[c.simah], "مستفيد سكني", c.housing_support ? "نعم" : "لا"],
          ].map((r, i) => <tr key={i} className="border-b border-slate-100">{r.map((x, j) => <td key={j} className={`py-1.5 ${j % 2 === 0 ? "text-slate-500 w-32" : "font-semibold"}`}>{x}</td>)}</tr>)}
        </tbody></table>

        <H>2. القدرة التمويلية ونسبة الاستقطاع</H>
        <div className="grid grid-cols-4 gap-3 mb-3">
          {[["الدخل المعتمد", fmt(s.capacity.income)], ["الالتزامات الحالية", fmt(s.capacity.existingTotal)], ["نسبة الالتزامات", `${s.capacity.currentDbr}%`], ["القسط المتاح", fmt(s.capacity.available)]].map(([a, b]) => (
            <div key={a} className="rounded-xl bg-slate-50 p-3"><div className="text-[11px] text-slate-500">{a}</div><div className="text-lg font-bold num text-start">{b}</div></div>
          ))}
        </div>
        <p className="text-slate-600 mb-2">القاعدة الحاكمة: {s.capacity.bindingRule}. {s.capacity.warnings.join(" ")}</p>
        {obl.length > 0 && <p className="text-slate-600 mb-6">الالتزامات: {obl.map((o) => `${OBLIGATION_KIND[o.kind]}${o.lender ? ` (${o.lender})` : ""} ${fmt(o.monthly)} شهرياً`).join("، ")}.</p>}

        <H>3. الخيارات التمويلية المتاحة</H>
        {top.length === 0 ? <p className="mb-6">لا توجد جهة مطابقة حالياً.</p> : (
          <table className="w-full mb-6 text-[12px]">
            <thead><tr className="bg-slate-50">{["#", "الجهة / المنتج", "المبلغ", "المدة", "القسط", "النسبة", "ملاحظات"].map((h) => <th key={h} className="text-start p-2 font-semibold">{h}</th>)}</tr></thead>
            <tbody>{top.map((m, i) => (
              <tr key={m.product.id} className="border-b border-slate-100 align-top">
                <td className="p-2">{i + 1}</td><td className="p-2"><b>{m.product.lenderName}</b><br /><span className="text-slate-500">{m.product.name}</span></td>
                <td className="p-2 num">{fmt(m.offerPrincipal)}</td><td className="p-2 num">{m.tenor}</td><td className="p-2 num">{fmt(m.installment)}</td><td className="p-2 num">{m.product.rate}%</td>
                <td className="p-2 text-slate-600">{m.checks.filter((x) => x.status !== "pass").map((x) => x.detail).join("؛ ") || "مستوفٍ"}</td>
              </tr>
            ))}</tbody>
          </table>
        )}

        <div className="grid grid-cols-2 gap-6 mb-6">
          <div><H>4. نقاط القوة</H><ul className="list-disc ps-5">{s.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          <div><H>5. المخاطر</H><ul className="list-disc ps-5">{s.risks.length ? s.risks.map((x, i) => <li key={i}>{x}</li>) : <li>لا توجد مخاطر جوهرية</li>}</ul></div>
        </div>

        <H>6. التوصيات</H>
        <ol className="list-decimal ps-5 mb-6">{s.recommendations.map((x, i) => <li key={i}>{x}</li>)}</ol>

        {approved?.analyst_opinion && <><H>7. رأي المحلل الائتماني</H><p className="mb-6 rounded-xl bg-slate-50 p-3">{approved.analyst_opinion}<br /><span className="text-xs text-slate-500">— {approved.name}</span></p></>}

        <H>8. حالة المستندات</H>
        <div className="grid grid-cols-2 gap-x-6 mb-8">{docs.map((d, i) => <div key={i} className="flex justify-between border-b border-slate-100 py-1"><span>{d.label}{!d.required && " (اختياري)"}</span><span className={d.status === "verified" ? "text-emerald-700" : d.status === "missing" ? "text-rose-600" : "text-slate-600"}>{DOC_STATUS[d.status].label}</span></div>)}</div>

        <div className="grid grid-cols-2 gap-10 mt-10 mb-6 text-sm">
          <div className="border-t border-slate-300 pt-2">أعدّه: {u.name}</div>
          <div className="border-t border-slate-300 pt-2">اعتمده: {approved?.name ?? "…………………"}</div>
        </div>
        <footer className="text-[10.5px] text-slate-400 border-t border-slate-100 pt-3 leading-5">
          هذه دراسة مبدئية مبنية على البيانات المقدمة ومعايير تقديرية للجهات، وليست عرضاً أو موافقة من أي جهة تمويل. الحكم النهائي للجهة المموّلة بعد الاستعلام الائتماني. المرجع التنظيمي: {SAMA.source}.
        </footer>
      </article>
    </div>
  );
}
const H = ({ children }: { children: React.ReactNode }) => <h2 className="font-bold text-brand-800 text-[15px] mb-2">{children}</h2>;
