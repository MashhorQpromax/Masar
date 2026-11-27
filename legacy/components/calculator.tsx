"use client";
import { useMemo, useState } from "react";
import { fmt, type Product, type Profile } from "@/lib/engine";
import { deepStudy } from "@/lib/advisor";
import { FINANCE_TYPE, SECTOR, SIMAH, ELIGIBILITY } from "@/lib/labels";
import { Icon } from "@/components/icon";
import { Fig, VerdictChip, Empty } from "@/components/ui";

export default function Calculator({ products }: { products: Product[] }) {
  const [f, setF] = useState({ salary: 12000, obligations: 0, mortgage: 0, age: 35, service: 36, sector: "gov", simah: "clean", type: "personal", amount: 0, housing: false, basic: 0, property: 0, co: 0, second: false, tenor: 0 });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.type === "number" || e.target.type === "range" ? Number(e.target.value) : e.target.value });
  const s = useMemo(() => {
    const p: Profile = {
      age: f.age, nationality: "saudi", sector: f.sector as Profile["sector"], serviceMonths: f.service, basicSalary: f.basic || f.salary * 0.7, totalSalary: f.salary, requestedTenor: f.tenor || null, propertyValue: f.property || null, coIncome: f.co || null, firstHome: !f.second, simah: f.simah as Profile["simah"],
      financeType: f.type as Profile["financeType"], requestedAmount: f.amount || null, housingSupport: f.housing, salaryBank: null,
      obligations: [...(f.obligations ? [{ kind: "personal" as const, monthly: f.obligations }] : []), ...(f.mortgage ? [{ kind: "mortgage" as const, monthly: f.mortgage }] : [])],
    };
    return deepStudy(p, products);
  }, [f, products]);
  const ok = s.matches.filter((m) => m.verdict !== "fail");
  const failed = s.matches.filter((m) => m.verdict === "fail");
  const top = ok[0] ? Math.max(...ok.map((m) => m.maxPrincipal)) : 0;
  const el = ELIGIBILITY[s.verdict];
  const alerts = s.alerts.filter((a) => a.id !== "inquiries").slice(0, 5);
  const N = (k: keyof typeof f, label: string, ph?: string) => <div><label className="label">{label}</label><input type="number" value={(f[k] as number) || ""} placeholder={ph ?? "0"} onChange={set(k)} className="input num" /></div>;

  return (
    <div className="grid lg:grid-cols-[340px_minmax(0,1fr)] gap-6 items-start">
      <div className="card p-5 space-y-4 lg:sticky lg:top-6">
        <div>
          <div className="flex items-baseline justify-between"><label className="label !mb-0">الراتب الإجمالي</label><span className="figure text-2xl font-semibold">{fmt(f.salary)}</span></div>
          <input type="range" min={3000} max={60000} step={500} value={f.salary} onChange={set("salary")} className="mt-2 w-full accent-brand-700" aria-label="الراتب الإجمالي" />
        </div>
        <div><label className="label">نوع التمويل</label><select value={f.type} onChange={set("type")} className="input">{Object.entries(FINANCE_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="grid grid-cols-2 gap-3">
          {N("obligations", "أقساط حالية")}
          {N("age", "العمر")}
          <div><label className="label">القطاع</label><select value={f.sector} onChange={set("sector")} className="input">{Object.entries(SECTOR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div><label className="label">سمة</label><select value={f.simah} onChange={set("simah")} className="input">{Object.entries(SIMAH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        </div>
        {f.type === "mortgage" && <div className="grid grid-cols-2 gap-3">{N("property", "قيمة العقار")}{N("co", "دخل المتضامن")}</div>}
        <details className="group">
          <summary className="cursor-pointer list-none text-[13px] font-semibold text-slate-500 hover:text-ink inline-flex items-center gap-1.5"><Icon name="chevron-down" className="size-4 transition-transform group-open:rotate-180" />حقول إضافية</summary>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {N("mortgage", "قسط عقاري حالي")}
            {N("service", "الخدمة (شهر)")}
            {N("basic", "الراتب الأساسي", fmt(f.salary * 0.7))}
            {N("amount", "المبلغ المطلوب")}
            {N("tenor", "المدة (شهر)", "الأقصى")}
            <label className="col-span-2 inline-flex items-center gap-2 text-[13px] text-slate-700"><input type="checkbox" checked={f.housing} onChange={set("housing")} className="size-4 accent-brand-700" />مستفيد من الدعم السكني</label>
            {f.type === "mortgage" && <label className="col-span-2 inline-flex items-center gap-2 text-[13px] text-slate-700"><input type="checkbox" checked={f.second} onChange={set("second")} className="size-4 accent-brand-700" />ليس المسكن الأول</label>}
          </div>
        </details>
      </div>

      <div className="space-y-4">
        <section className="card p-5 sm:p-7">
          <VerdictChip tone={el.tone} icon={el.icon}>{el.label}</VerdictChip>
          <h2 className="mt-4 text-[22px] font-bold leading-snug">{s.headline}</h2>
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-5">
            <Fig label="أعلى مبلغ" value={fmt(top)} tone="text-brand-700" />
            <Fig label="القسط المتاح" value={fmt(s.capacity.available)} hint="شهرياً" />
            <div className="col-span-2 sm:col-span-1"><div className="eyebrow">القاعدة الحاكمة</div><div className="text-[13px] font-medium mt-2 leading-6">{s.capacity.bindingRule}</div></div>
          </div>
        </section>

        <section className="card overflow-hidden">
          <div className="px-5 pt-5 pb-3 text-[15px] font-bold flex items-center gap-2">الجهات المناسبة<span className="num text-xs font-medium text-slate-400">{ok.length}</span></div>
          {ok.length === 0 ? <Empty art="search" title="لا جهة مناسبة بهذه الأرقام" /> : (
            <div>
              <div className="hidden sm:grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_1fr] gap-4 px-5 py-2.5 border-y border-slate-200/70 text-[11px] font-semibold text-slate-500"><div>الجهة</div><div>المبلغ</div><div>القسط</div><div>المدة</div><div>النسبة الفعلية</div></div>
              {ok.map((m) => (
                <div key={m.product.id} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_1fr] gap-4 items-center px-5 py-3.5 border-b border-slate-100 last:border-0">
                  <div className="min-w-0 flex items-center gap-2.5">
                    <span className={`size-1.5 shrink-0 rounded-full ${m.verdict === "pass" ? "bg-emerald-500" : "bg-amber-400"}`} title={m.verdict === "pass" ? "مؤهل" : "بشروط"} />
                    <div className="min-w-0"><div className="font-semibold text-sm truncate">{m.product.lenderName}</div><div className="text-xs text-slate-500 truncate">{m.product.name}</div></div>
                  </div>
                  <div className="num font-semibold text-sm">{fmt(m.maxPrincipal)}</div>
                  <div className="hidden sm:block num text-sm">{fmt(m.installment)}{m.retirement && m.retirement.after < m.installment ? <div className="text-[10px] text-amber-700">بعد التقاعد {fmt(m.retirement.after)}</div> : null}</div>
                  <div className="hidden sm:block num text-sm">{m.tenor}</div>
                  <div className="hidden sm:block num text-sm">{m.apr}%</div>
                </div>
              ))}
            </div>
          )}
          {failed.length > 0 && (
            <details className="group border-t border-slate-100">
              <summary className="cursor-pointer list-none px-5 py-3 text-[13px] font-semibold text-slate-500 hover:text-ink flex items-center gap-1.5"><Icon name="chevron-down" className="size-4 transition-transform group-open:rotate-180" />غير مناسبة <span className="num">{failed.length}</span></summary>
              <ul className="px-5 pb-4 text-[13px] space-y-2">{failed.map((m) => <li key={m.product.id} className="flex flex-wrap justify-between gap-x-4"><span className="font-medium">{m.product.lenderName}</span><span className="text-rose-700">{m.checks.find((c) => c.status === "fail")?.label ?? ""}</span></li>)}</ul>
            </details>
          )}
        </section>

        {(s.scenarios.length > 0 || alerts.length > 0) && (
          <div className="grid md:grid-cols-2 gap-4">
            {s.scenarios.length > 0 && (
              <div className="card p-5">
                <h3 className="text-[15px] font-bold mb-3 flex items-center gap-2"><Icon name="trend" className="size-4 text-slate-400" />مخارج لرفع المبلغ</h3>
                <ul className="space-y-2.5 text-[13px]">{s.scenarios.slice(0, 5).map((x) => <li key={x.key} className="flex justify-between gap-3"><span>{x.title}</span><span className="num font-semibold whitespace-nowrap">{fmt(x.amount)}{x.gain > 0 && <span className="text-emerald-700 text-xs font-medium"> +{fmt(x.gain)}</span>}</span></li>)}</ul>
              </div>
            )}
            {alerts.length > 0 && (
              <div className="card p-5">
                <h3 className="text-[15px] font-bold mb-3 flex items-center gap-2"><Icon name="shield" className="size-4 text-slate-400" />قد تطلب الجهة</h3>
                <ul className="space-y-2.5 text-[13px]">{alerts.map((a) => <li key={a.id} className="flex gap-2.5"><Icon name={a.level === "block" ? "ban" : a.level === "warn" ? "alert" : "info"} className={`size-4 mt-0.5 ${a.level === "block" ? "text-rose-600" : a.level === "warn" ? "text-amber-600" : "text-slate-400"}`} /><span>{a.title}</span></li>)}</ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
