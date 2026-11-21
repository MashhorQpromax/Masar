"use client";
import { useActionState, useMemo, useState } from "react";
import { fmt, type Product, type Profile, type Obligation } from "@/lib/engine";
import { deepStudy } from "@/lib/advisor";
import { BANKS, FINANCE_TYPE, SECTOR, SIMAH, OBLIGATION_KIND, ELIGIBILITY } from "@/lib/labels";
import type { FormState } from "@/app/actions";

type Values = Record<string, string | number | null | undefined>;

export default function ClientForm({
  action, products, initial = {}, obligations: initialObl = [], isNew,
}: {
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  products: Product[];
  initial?: Values;
  obligations?: Obligation[];
  isNew?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [v, setV] = useState<Values>({ nationality: "saudi", sector: "gov", simah: "unknown", finance_type: "personal", ...initial });
  const [obl, setObl] = useState<{ kind: Obligation["kind"]; lender: string; monthly: number; remaining: number }[]>([]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setV((p) => ({ ...p, [k]: e.target.type === "checkbox" ? ((e.target as HTMLInputElement).checked ? 1 : 0) : e.target.value }));
  const n = (k: string) => (v[k] === "" || v[k] == null ? null : Number(String(v[k]).replace(/,/g, "")));

  const s = useMemo(() => {
    const p: Profile = {
      age: n("birth_year") ? new Date().getFullYear() - n("birth_year")! : null,
      nationality: v.nationality as Profile["nationality"],
      sector: v.sector as Profile["sector"],
      serviceMonths: n("service_months"),
      basicSalary: n("basic_salary"),
      totalSalary: n("total_salary"),
      otherIncome: n("other_income"),
      salaryBank: (v.salary_bank as string) || null,
      simah: v.simah as Profile["simah"],
      housingSupport: !!Number(v.housing_support),
      financeType: v.finance_type as Profile["financeType"],
      requestedAmount: n("requested_amount"),
      requestedTenor: n("requested_tenor"),
      obligations: [...initialObl, ...obl.filter((o) => o.monthly > 0)],
      firstHome: v.owns_home === "" || v.owns_home == null ? null : !Number(v.owns_home),
      propertyValue: n("property_value"),
      coIncome: n("co_income"),
    };
    return deepStudy(p, products);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, obl, products, initialObl]);

  const F = ({ k, label, type = "text", ph, ltr, req }: { k: string; label: string; type?: string; ph?: string; ltr?: boolean; req?: boolean }) => (
    <div>
      <label className="label">{label}{req && <span className="text-rose-500"> *</span>}</label>
      <input name={k} type={type} value={(v[k] as string) ?? ""} onChange={set(k)} placeholder={ph} dir={ltr ? "ltr" : undefined} className={`input ${ltr ? "text-left" : ""}`} inputMode={type === "number" ? "decimal" : undefined} required={req} />
    </div>
  );
  const S = ({ k, label, opts }: { k: string; label: string; opts: Record<string, string> }) => (
    <div>
      <label className="label">{label}</label>
      <select name={k} value={(v[k] as string) ?? ""} onChange={set(k)} className="input">
        {!(k in { sector: 1, finance_type: 1, simah: 1, nationality: 1 }) && <option value="">—</option>}
        {Object.entries(opts).map(([a, b]) => <option key={a} value={a}>{b}</option>)}
      </select>
    </div>
  );
  const el = ELIGIBILITY[s.verdict];

  return (
    <form action={formAction} className="grid xl:grid-cols-[1fr_380px] gap-6 items-start">
      <div className="space-y-5">
        <Section title="البيانات الشخصية" n="1">
          {F({ k: "full_name", label: "الاسم الكامل", req: true })}
          {F({ k: "national_id", label: "رقم الهوية / الإقامة", ltr: true, ph: "1XXXXXXXXX" })}
          {F({ k: "phone", label: "الجوال", ltr: true, ph: "05XXXXXXXX" })}
          {F({ k: "email", label: "البريد", type: "email", ltr: true })}
          {F({ k: "birth_year", label: "سنة الميلاد (ميلادي)", type: "number", ph: "1990" })}
          {S({ k: "nationality", label: "الجنسية", opts: { saudi: "سعودي", non_saudi: "غير سعودي" } })}
          {S({ k: "marital_status", label: "الحالة الاجتماعية", opts: { single: "أعزب", married: "متزوج", divorced: "مطلق", widowed: "أرمل" } })}
          {F({ k: "dependents", label: "عدد المعالين", type: "number" })}
          {F({ k: "city", label: "المدينة" })}
        </Section>

        <Section title="العمل والدخل" n="2">
          {F({ k: "employer", label: "جهة العمل" })}
          {S({ k: "sector", label: "تصنيف جهة العمل", opts: SECTOR })}
          {F({ k: "job_title", label: "المسمى الوظيفي" })}
          {F({ k: "service_months", label: "مدة الخدمة (بالأشهر)", type: "number" })}
          {F({ k: "basic_salary", label: "الراتب الأساسي", type: "number" })}
          {F({ k: "total_salary", label: "الراتب الإجمالي", type: "number" })}
          {F({ k: "other_income", label: "دخل آخر شهري موثق", type: "number", ph: "يحتسب نصفه" })}
          {S({ k: "salary_bank", label: "البنك المحول عليه الراتب", opts: BANKS })}
          {S({ k: "simah", label: "السجل الائتماني (سمة)", opts: SIMAH })}
        </Section>

        <Section title="التمويل المطلوب" n="3">
          {S({ k: "finance_type", label: "نوع التمويل", opts: FINANCE_TYPE })}
          {F({ k: "requested_amount", label: "المبلغ المطلوب (ريال)", type: "number" })}
          {F({ k: "requested_tenor", label: "المدة المرغوبة (شهر)", type: "number" })}
          {(v.finance_type === "mortgage" || v.finance_type === "auto") && F({ k: "property_value", label: v.finance_type === "mortgage" ? "قيمة العقار (إن عُرفت)" : "قيمة السيارة", type: "number" })}
          {v.finance_type === "mortgage" && F({ k: "co_income", label: "دخل المتضامن (الزوج/الزوجة)", type: "number", ph: "اختياري" })}
          {S({ k: "priority", label: "أولوية العميل", opts: { low_installment: "أقل قسط", max_amount: "أكبر مبلغ", fast: "أسرع صرف", specific: "جهة معينة" } })}
          {F({ k: "purpose", label: "الغرض" })}
          {F({ k: "source", label: "مصدر العميل", ph: "إحالة، إعلان، …" })}
          <label className="flex items-center gap-2 text-sm mt-6"><input type="checkbox" name="owns_home" checked={!!Number(v.owns_home)} onChange={set("owns_home")} className="size-4 accent-brand-600" /> يملك مسكناً</label>
          <label className="flex items-center gap-2 text-sm mt-6"><input type="checkbox" name="housing_support" checked={!!Number(v.housing_support)} onChange={set("housing_support")} className="size-4 accent-brand-600" /> مستفيد من سكني / الصندوق العقاري</label>
        </Section>

        {isNew && (
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold flex items-center gap-2"><span className="size-6 rounded-lg bg-brand-50 text-brand-700 grid place-items-center text-xs">4</span>الالتزامات الحالية</h3>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setObl([...obl, { kind: "personal", lender: "", monthly: 0, remaining: 0 }])}>+ إضافة التزام</button>
            </div>
            {obl.length === 0 && <p className="text-sm text-slate-500">لا توجد التزامات (أضف القروض والبطاقات وأي قسط شهري، بما فيها قروض صاحب العمل أو الأقارب)</p>}
            <div className="space-y-2">
              {obl.map((o, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2">
                  <select className="input" value={o.kind} onChange={(e) => setObl(obl.map((x, j) => (j === i ? { ...x, kind: e.target.value as Obligation["kind"] } : x)))}>{Object.entries(OBLIGATION_KIND).map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select>
                  <input className="input" placeholder="الجهة" value={o.lender} onChange={(e) => setObl(obl.map((x, j) => (j === i ? { ...x, lender: e.target.value } : x)))} />
                  <input className="input" placeholder="القسط الشهري" inputMode="decimal" value={o.monthly || ""} onChange={(e) => setObl(obl.map((x, j) => (j === i ? { ...x, monthly: Number(e.target.value) || 0 } : x)))} />
                  <input className="input" placeholder="المتبقي" inputMode="decimal" value={o.remaining || ""} onChange={(e) => setObl(obl.map((x, j) => (j === i ? { ...x, remaining: Number(e.target.value) || 0 } : x)))} />
                  <button type="button" className="btn-ghost btn-sm h-10" onClick={() => setObl(obl.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
            </div>
            <input type="hidden" name="obligations_json" value={JSON.stringify(obl)} />
          </div>
        )}

        {isNew && (
          <label className="card p-4 flex items-start gap-3 text-sm leading-6">
            <input type="checkbox" name="consent" className="size-4 mt-1 accent-brand-600" required />
            <span>أقر بأن العميل وافق على جمع بياناته الشخصية والمالية ومعالجتها لغرض دراسة التمويل والتقديم لجهات التمويل، وفق نظام حماية البيانات الشخصية.</span>
          </label>
        )}

        {state?.error && <div className="text-sm text-rose-700 bg-rose-50 rounded-xl px-4 py-3">{state.error}</div>}
        {state?.ok && <div className="text-sm text-emerald-700 bg-emerald-50 rounded-xl px-4 py-3">{state.ok}</div>}
        <div className="flex gap-2"><button className="btn-primary h-11 px-6" disabled={pending}>{pending ? "جارٍ الحفظ…" : isNew ? "فتح الملف وتشغيل الدراسة" : "حفظ التعديلات"}</button></div>
      </div>

      <aside className="xl:sticky xl:top-6 card overflow-hidden">
        <div className="bg-brand-900 text-white p-5">
          <div className="text-xs text-brand-100/70">الدراسة المبدئية — مباشرة</div>
          <div className="mt-1 text-xl font-bold">{el.emoji} {s.headline}</div>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <Mini label="الدخل المعتمد" v={fmt(s.capacity.income)} />
            <Mini label="الالتزامات الحالية" v={fmt(s.capacity.existingTotal)} />
            <Mini label="القسط المتاح" v={fmt(s.capacity.available)} strong />
            <Mini label="نسبة الاستقطاع الحالية" v={`${s.capacity.currentDbr}%`} />
          </div>
          <div className="text-xs text-slate-500">القاعدة الحاكمة: {s.capacity.bindingRule}</div>
          <div>
            <div className="text-xs font-bold text-slate-500 mb-2">أفضل الجهات</div>
            <ul className="space-y-2">
              {s.matches.slice(0, 4).map((m) => (
                <li key={m.product.id} className="flex items-center gap-2">
                  <span className={`size-2 rounded-full ${m.verdict === "pass" ? "bg-emerald-500" : m.verdict === "warn" ? "bg-amber-400" : "bg-rose-400"}`} />
                  <span className="flex-1 truncate">{m.product.lenderName}</span>
                  <span className="num text-xs text-slate-600">{m.verdict === "fail" ? "—" : fmt(m.offerPrincipal)}</span>
                </li>
              ))}
              {s.matches.length === 0 && <li className="text-slate-500">لا توجد منتجات معرّفة لهذا النوع</li>}
            </ul>
          </div>
          {s.alerts.filter((a) => a.level !== "info").length > 0 && (
            <div>
              <div className="text-xs font-bold text-slate-500 mb-2">انتبه</div>
              <ul className="space-y-1.5 text-xs">{s.alerts.filter((a) => a.level !== "info").slice(0, 4).map((a) => <li key={a.id} className="flex gap-1.5"><span>{a.level === "block" ? "⛔" : "⚠️"}</span>{a.title}</li>)}</ul>
            </div>
          )}
          {s.scenarios[0] && s.scenarios[0].gain > 0 && <div className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-900 leading-6">💡 مخرج: {s.scenarios[0].title} ← <span className="num font-bold">{fmt(s.scenarios[0].amount)}</span> ريال</div>}
          {s.missingData.length > 0 && <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 leading-6">ناقص: {s.missingData.join("، ")}</div>}
        </div>
      </aside>
    </form>
  );
}

function Section({ title, n, children }: { title: string; n: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <h3 className="font-bold mb-4 flex items-center gap-2"><span className="size-6 rounded-lg bg-brand-50 text-brand-700 grid place-items-center text-xs">{n}</span>{title}</h3>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">{children}</div>
    </div>
  );
}
function Mini({ label, v, strong }: { label: string; v: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl p-3 ${strong ? "bg-brand-50" : "bg-slate-50"}`}>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`num text-start font-bold ${strong ? "text-brand-800 text-lg" : ""}`}>{v}</div>
    </div>
  );
}
