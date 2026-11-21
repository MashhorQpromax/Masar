"use client";
import { useMemo, useState } from "react";
import { fmt, type Product, type Profile } from "@/lib/engine";
import { deepStudy } from "@/lib/advisor";
import { FINANCE_TYPE, SECTOR, SIMAH, ELIGIBILITY } from "@/lib/labels";

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
  const best = s.matches.filter((m) => m.verdict !== "fail");
  return (
    <div className="grid lg:grid-cols-[360px_1fr] gap-6 items-start">
      <div className="card p-5 space-y-4">
        <div><label className="label">الراتب الإجمالي: <b className="num text-ink">{fmt(f.salary)}</b></label><input type="range" min={3000} max={60000} step={500} value={f.salary} onChange={set("salary")} className="w-full accent-brand-600" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">أقساط استهلاكية حالية</label><input type="number" value={f.obligations} onChange={set("obligations")} className="input" /></div>
          <div><label className="label">قسط عقاري حالي</label><input type="number" value={f.mortgage} onChange={set("mortgage")} className="input" /></div>
          <div><label className="label">العمر</label><input type="number" value={f.age} onChange={set("age")} className="input" /></div>
          <div><label className="label">الخدمة (شهر)</label><input type="number" value={f.service} onChange={set("service")} className="input" /></div>
        </div>
        <div><label className="label">القطاع</label><select value={f.sector} onChange={set("sector")} className="input">{Object.entries(SECTOR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label className="label">سمة</label><select value={f.simah} onChange={set("simah")} className="input">{Object.entries(SIMAH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label className="label">نوع التمويل</label><select value={f.type} onChange={set("type")} className="input">{Object.entries(FINANCE_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label className="label">المبلغ المطلوب (اختياري)</label><input type="number" value={f.amount || ""} onChange={set("amount")} className="input" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">الراتب الأساسي</label><input type="number" value={f.basic || ""} placeholder={fmt(f.salary * 0.7)} onChange={set("basic")} className="input" /></div>
          <div><label className="label">المدة (شهر)</label><input type="number" value={f.tenor || ""} placeholder="الأقصى" onChange={set("tenor")} className="input" /></div>
        </div>
        {f.type === "mortgage" && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">قيمة العقار</label><input type="number" value={f.property || ""} onChange={set("property")} className="input" /></div>
            <div><label className="label">دخل المتضامن</label><input type="number" value={f.co || ""} onChange={set("co")} className="input" /></div>
            <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.second} onChange={set("second")} className="accent-brand-600" />ليس المسكن الأول (تمويل 70%)</label>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.housing} onChange={set("housing")} className="accent-brand-600" />مستفيد سكني / الصندوق</label>
      </div>
      <div className="space-y-4">
        <div className="card p-6 bg-gradient-to-l from-brand-900 to-brand-700 text-white border-0">
          <div className="text-sm text-brand-100/80">{ELIGIBILITY[s.verdict].emoji} {s.headline}</div>
          <div className="grid sm:grid-cols-3 gap-6 mt-4">
            <div><div className="text-xs text-brand-100/70">القسط الشهري المتاح</div><div className="text-4xl font-bold num text-start mt-1">{fmt(s.capacity.available)}</div></div>
            <div><div className="text-xs text-brand-100/70">أعلى مبلغ تقريبي</div><div className="text-4xl font-bold num text-start mt-1 text-gold">{fmt(best[0] ? Math.max(...best.map((m) => m.maxPrincipal)) : 0)}</div></div>
            <div><div className="text-xs text-brand-100/70">القاعدة الحاكمة</div><div className="text-sm font-semibold mt-2 leading-6">{s.capacity.bindingRule}</div></div>
          </div>
        </div>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead><tr>{["الجهة", "الحكم", "المبلغ الممكن", "المدة", "القسط", "النسبة الفعلية", "إجمالي الأرباح"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>{s.matches.map((m) => (
              <tr key={m.product.id} className={m.verdict === "fail" ? "opacity-50" : ""}>
                <td className="td"><b>{m.product.lenderName}</b><div className="text-xs text-slate-500">{m.product.name}</div></td>
                <td className="td text-xs">{m.verdict === "pass" ? "✅ مؤهل" : m.verdict === "warn" ? "⚠️ بشروط" : "❌ " + (m.checks.find((c) => c.status === "fail")?.label ?? "")}</td>
                <td className="td num font-semibold">{m.verdict === "fail" ? "—" : fmt(m.maxPrincipal)}</td><td className="td num">{m.tenor}</td>
                <td className="td num">{m.verdict === "fail" ? "—" : fmt(m.installment)}</td><td className="td num text-xs">{m.verdict === "fail" ? `${m.product.rate}%` : `${m.apr}%`}<div className="text-[10px] text-slate-400">{m.product.rate}% {m.product.rateType === "flat" ? "ثابتة" : "متناقصة"}</div></td>
                <td className="td num text-xs">{m.verdict === "fail" ? "—" : fmt(m.totalProfit)}{m.retirement && m.retirement.after < m.installment ? <div className="text-[10px] text-amber-700">قسط بعد التقاعد {fmt(m.retirement.after)}</div> : null}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="card p-5">
            <h3 className="font-bold mb-3 text-sm">💡 المخارج</h3>
            {s.scenarios.length === 0 ? <p className="text-sm text-slate-500">لا توجد مخارج ترفع المبلغ بهذه المعطيات.</p> : (
              <ul className="space-y-2 text-sm">{s.scenarios.slice(0, 5).map((x) => <li key={x.key} className="flex justify-between gap-3"><span>{x.title}</span><span className="num font-bold text-brand-700 whitespace-nowrap">{fmt(x.amount)}{x.gain > 0 && <span className="text-emerald-600 text-xs"> +{fmt(x.gain)}</span>}</span></li>)}</ul>
            )}
          </div>
          {s.alerts.some((a) => a.id !== "inquiries") && <div className="card p-5">
            <h3 className="font-bold mb-3 text-sm">⚠️ قد تطلب الجهة</h3>
            <ul className="space-y-2 text-sm">{s.alerts.filter((a) => a.id !== "inquiries").slice(0, 6).map((a) => <li key={a.id} className="flex gap-2"><span>{a.level === "block" ? "⛔" : a.level === "warn" ? "⚠️" : "ℹ️"}</span><span>{a.title}</span></li>)}</ul>
          </div>}
        </div>
      </div>
    </div>
  );
}
