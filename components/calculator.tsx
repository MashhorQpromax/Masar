"use client";
import { useMemo, useState } from "react";
import { study, fmt, type Product, type Profile } from "@/lib/engine";
import { FINANCE_TYPE, SECTOR, SIMAH, ELIGIBILITY } from "@/lib/labels";

export default function Calculator({ products }: { products: Product[] }) {
  const [f, setF] = useState({ salary: 12000, obligations: 0, mortgage: 0, age: 35, service: 36, sector: "gov", simah: "clean", type: "personal", amount: 0, housing: false });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.type === "number" || e.target.type === "range" ? Number(e.target.value) : e.target.value });
  const s = useMemo(() => {
    const p: Profile = {
      age: f.age, nationality: "saudi", sector: f.sector as Profile["sector"], serviceMonths: f.service, basicSalary: f.salary, totalSalary: f.salary, simah: f.simah as Profile["simah"],
      financeType: f.type as Profile["financeType"], requestedAmount: f.amount || null, housingSupport: f.housing, salaryBank: "x",
      obligations: [...(f.obligations ? [{ kind: "personal" as const, monthly: f.obligations }] : []), ...(f.mortgage ? [{ kind: "mortgage" as const, monthly: f.mortgage }] : [])],
    };
    return study(p, products);
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
            <thead><tr>{["الجهة", "الحكم", "المبلغ الممكن", "المدة", "القسط", "النسبة"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>{s.matches.map((m) => (
              <tr key={m.product.id} className={m.verdict === "fail" ? "opacity-50" : ""}>
                <td className="td"><b>{m.product.lenderName}</b><div className="text-xs text-slate-500">{m.product.name}</div></td>
                <td className="td text-xs">{m.verdict === "pass" ? "✅ مؤهل" : m.verdict === "warn" ? "⚠️ بشروط" : "❌ " + (m.checks.find((c) => c.status === "fail")?.label ?? "")}</td>
                <td className="td num font-semibold">{m.verdict === "fail" ? "—" : fmt(m.maxPrincipal)}</td><td className="td num">{m.tenor}</td>
                <td className="td num">{m.verdict === "fail" ? "—" : fmt(m.installment)}</td><td className="td num text-xs">{m.product.rate}%</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
