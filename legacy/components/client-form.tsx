"use client";
import { useActionState, useMemo, useState } from "react";
import { fmt, type Product, type Profile, type Obligation } from "@/lib/engine";
import { deepStudy } from "@/lib/advisor";
import { projectStudy } from "@/lib/project";
import { BANKS, FINANCE_TYPE, SECTOR, SIMAH, OBLIGATION_KIND, ELIGIBILITY } from "@/lib/labels";
import type { FormState } from "@/app/actions";
import { Icon } from "@/components/icon";
import { Callout } from "@/components/ui";

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
  const [v, setV] = useState<Values>(() => {
    const pj: Values = {};
    try { for (const [k, x] of Object.entries(JSON.parse(String(initial.extra || "{}")) as Record<string, unknown>)) pj["pj_" + k] = typeof x === "boolean" ? (x ? 1 : 0) : (x as string | number | null); } catch {}
    return { nationality: "saudi", sector: "gov", simah: "unknown", finance_type: "personal", ...initial, ...pj };
  });
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

  const pj = useMemo(() => {
    if (v.finance_type !== "project") return null;
    const g = (k: string) => n("pj_" + k);
    const t = (k: string) => (v["pj_" + k] ? String(v["pj_" + k]) : null);
    return projectStudy({
      borrowerType: t("borrowerType") as never, projectType: t("projectType") as never, purpose: t("purpose") as never, deed: t("deed") as never,
      city: t("city"), district: t("district"), valuer: t("valuer"), valuationDate: t("valuationDate"),
      landArea: g("landArea"), landValue: g("landValue"), constructionCost: g("constructionCost"), gfa: g("gfa"), keys: g("keys"), adr: g("adr"), occupancy: g("occupancy"), equityCash: g("equityCash"),
      nearHaram: !!Number(v.pj_nearHaram), hasPermit: !!Number(v.pj_hasPermit), hasFeasibility: !!Number(v.pj_hasFeasibility), existingLien: !!Number(v.pj_existingLien),
    }, n("requested_amount") ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);

  const F = ({ k, label, type = "text", ph, ltr, req }: { k: string; label: string; type?: string; ph?: string; ltr?: boolean; req?: boolean }) => (
    <div>
      <label className="label">{label}{req && <span className="text-rose-600"> *</span>}</label>
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
  const C = (k: string, label: string) => (
    <label key={k} className="flex items-center gap-2.5 text-sm h-10 mt-[22px]"><input type="checkbox" name={k} checked={!!Number(v[k])} onChange={set(k)} className="size-4 accent-brand-700" />{label}</label>
  );
  const CHIP: Record<string, string> = { eligible: "bg-emerald-50 text-emerald-800", conditional: "bg-amber-50 text-amber-800", pending: "bg-slate-100 text-slate-600", not_eligible: "bg-rose-50 text-rose-800" };

  return (
    <form action={formAction} className="grid xl:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
      <div className="space-y-4">
        <Section title="العميل" more={<>
          {F({ k: "email", label: "البريد", type: "email", ltr: true })}
          {S({ k: "nationality", label: "الجنسية", opts: { saudi: "سعودي", non_saudi: "غير سعودي" } })}
          {S({ k: "marital_status", label: "الحالة الاجتماعية", opts: { single: "أعزب", married: "متزوج", divorced: "مطلق", widowed: "أرمل" } })}
          {F({ k: "dependents", label: "عدد المعالين", type: "number" })}
          {F({ k: "city", label: "المدينة" })}
        </>}>
          {F({ k: "full_name", label: "الاسم الكامل", req: true })}
          {F({ k: "phone", label: "الجوال", ltr: true, ph: "05XXXXXXXX" })}
          {F({ k: "national_id", label: "رقم الهوية أو الإقامة", ltr: true, ph: "1XXXXXXXXX" })}
          {F({ k: "birth_year", label: "سنة الميلاد (ميلادي)", type: "number", ph: "1990" })}
        </Section>

        <Section title="العمل والدخل" more={<>
          {F({ k: "job_title", label: "المسمى الوظيفي" })}
          {F({ k: "other_income", label: "دخل آخر شهري موثق", type: "number", ph: "يُحتسب نصفه" })}
          {S({ k: "salary_bank", label: "بنك الراتب", opts: BANKS })}
        </>}>
          {F({ k: "employer", label: "جهة العمل" })}
          {S({ k: "sector", label: "تصنيف جهة العمل", opts: SECTOR })}
          {F({ k: "service_months", label: "مدة الخدمة (أشهر)", type: "number" })}
          {F({ k: "basic_salary", label: "الراتب الأساسي", type: "number" })}
          {F({ k: "total_salary", label: "الراتب الإجمالي", type: "number" })}
          {S({ k: "simah", label: "سمة", opts: SIMAH })}
        </Section>

        <Section title="التمويل المطلوب" more={<>
          {S({ k: "priority", label: "أولوية العميل", opts: { low_installment: "أقل قسط", max_amount: "أكبر مبلغ", fast: "أسرع صرف", specific: "جهة معينة" } })}
          {F({ k: "purpose", label: "الغرض" })}
          {F({ k: "source", label: "مصدر العميل", ph: "إحالة، إعلان" })}
          {C("owns_home", "يملك مسكناً")}
          {C("housing_support", "مستفيد من سكني")}
        </>}>
          {S({ k: "finance_type", label: "نوع التمويل", opts: FINANCE_TYPE })}
          {F({ k: "requested_amount", label: "المبلغ المطلوب", type: "number" })}
          {F({ k: "requested_tenor", label: "المدة (شهر)", type: "number" })}
          {(v.finance_type === "mortgage" || v.finance_type === "auto") && F({ k: "property_value", label: v.finance_type === "mortgage" ? "قيمة العقار" : "قيمة السيارة", type: "number" })}
          {v.finance_type === "mortgage" && F({ k: "co_income", label: "دخل المتضامن", type: "number", ph: "اختياري" })}
        </Section>

        {v.finance_type === "project" && (
          <Section title="المشروع والضمان" more={<>
            {F({ k: "pj_district", label: "الحي" })}
            {F({ k: "pj_valuer", label: "المقيّم" })}
            {F({ k: "pj_valuationDate", label: "تاريخ التقييم", ph: "2026-11" })}
            {F({ k: "pj_gfa", label: "مسطحات البناء (م²)", type: "number" })}
            {F({ k: "pj_keys", label: "عدد الغرف", type: "number" })}
            {F({ k: "pj_adr", label: "متوسط سعر الليلة", type: "number" })}
            {F({ k: "pj_occupancy", label: "الإشغال المتوقع %", type: "number" })}
            {F({ k: "pj_equityCash", label: "سيولة يضخها المالك", type: "number" })}
            {C("pj_nearHaram", "قرب الحرم")}
            {C("pj_hasPermit", "توجد رخصة بناء")}
            {C("pj_hasFeasibility", "توجد دراسة جدوى")}
            {C("pj_existingLien", "على الأرض رهن قائم")}
          </>}>
            {S({ k: "pj_borrowerType", label: "المقترض", opts: { individual: "فرد", company: "شركة أو منشأة" } })}
            {S({ k: "pj_projectType", label: "نوع المشروع", opts: { hotel: "فندق", residential: "سكني", commercial: "تجاري", mixed: "متعدد الاستخدام" } })}
            {S({ k: "pj_purpose", label: "الغرض", opts: { build: "بناء المشروع", cashout: "سيولة بضمان الأرض", build_cashout: "بناء وسيولة" } })}
            {F({ k: "pj_city", label: "المدينة" })}
            {F({ k: "pj_landArea", label: "مساحة الأرض (م²)", type: "number" })}
            {F({ k: "pj_landValue", label: "قيمة الأرض بالتقييم", type: "number" })}
            {S({ k: "pj_deed", label: "حالة الصك", opts: { registered: "مسجل بهوية عقارية", electronic: "إلكتروني بلا هوية عقارية", paper: "ورقي" } })}
            {F({ k: "pj_constructionCost", label: "تكلفة البناء التقديرية", type: "number" })}
          </Section>
        )}

        {isNew && (
          <div className="card p-5 sm:p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-[15px]">الالتزامات الحالية</h3>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setObl([...obl, { kind: "personal", lender: "", monthly: 0, remaining: 0 }])}><Icon name="plus" className="size-3.5" />التزام</button>
            </div>
            {obl.length === 0 && <p className="text-[13px] text-slate-500">لا التزامات. أضف القروض والبطاقات وأي قسط شهري.</p>}
            <div className="space-y-2">
              {obl.map((o, i) => (
                <div key={i} className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2">
                  <select className="input" value={o.kind} onChange={(e) => setObl(obl.map((x, j) => (j === i ? { ...x, kind: e.target.value as Obligation["kind"] } : x)))}>{Object.entries(OBLIGATION_KIND).map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select>
                  <input className="input" placeholder="الجهة" value={o.lender} onChange={(e) => setObl(obl.map((x, j) => (j === i ? { ...x, lender: e.target.value } : x)))} />
                  <input className="input num" placeholder="القسط الشهري" inputMode="decimal" value={o.monthly || ""} onChange={(e) => setObl(obl.map((x, j) => (j === i ? { ...x, monthly: Number(e.target.value) || 0 } : x)))} />
                  <input className="input num" placeholder="المتبقي" inputMode="decimal" value={o.remaining || ""} onChange={(e) => setObl(obl.map((x, j) => (j === i ? { ...x, remaining: Number(e.target.value) || 0 } : x)))} />
                  <button type="button" aria-label="حذف" className="size-10 grid place-items-center rounded-[11px] text-slate-400 hover:bg-rose-50 hover:text-rose-700 cursor-pointer" onClick={() => setObl(obl.filter((_, j) => j !== i))}><Icon name="x" className="size-4" /></button>
                </div>
              ))}
            </div>
            <input type="hidden" name="obligations_json" value={JSON.stringify(obl)} />
          </div>
        )}

        {isNew && (
          <label className="flex items-start gap-3 text-[13px] leading-6 text-slate-600 px-1">
            <input type="checkbox" name="consent" className="size-4 mt-1 accent-brand-700" required />
            <span>وافق العميل على جمع بياناته ومعالجتها لدراسة التمويل والتقديم للجهات، وفق نظام حماية البيانات الشخصية.</span>
          </label>
        )}

        {state?.error && <Callout tone="red">{state.error}</Callout>}
        {state?.ok && <Callout tone="green">{state.ok}</Callout>}
        <button className="btn-primary h-11 px-6" disabled={pending}>{pending ? "جارٍ الحفظ" : isNew ? "فتح الملف" : "حفظ التعديلات"}</button>
      </div>

      <aside className="xl:sticky xl:top-6 card p-5">
        <div className="eyebrow">دراسة مبدئية مباشرة</div>
        {pj ? (
          <>
            <div className="mt-2 font-bold leading-7">{pj.headline}</div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
              <Mini label="الطلب إلى قيمة الأرض" v={pj.ltv != null ? `${pj.ltv}%` : "—"} />
              <Mini label="الطلب إلى التكلفة" v={pj.ltc != null ? `${pj.ltc}%` : "—"} />
              <Mini label="سعر المتر" v={pj.pricePerM2 ? fmt(pj.pricePerM2) : "—"} />
              <Mini label="نواقص أساسية" v={String(pj.missing.filter((m) => m.critical).length)} strong />
            </dl>
            <ul className="mt-4 space-y-2 text-[13px]">{pj.alerts.slice(0, 5).map((a, i) => <li key={i} className="flex gap-2 leading-5"><Icon name={a.level === "block" ? "ban" : a.level === "warn" ? "alert" : "info"} className={`size-4 mt-0.5 ${a.level === "block" ? "text-rose-600" : a.level === "warn" ? "text-amber-600" : "text-slate-400"}`} />{a.title}</li>)}</ul>
          </>
        ) : (
          <>
            <div className="mt-2.5"><span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 h-7 text-xs font-bold ${CHIP[s.verdict]}`}><Icon name={el.icon} className="size-4" strokeWidth={2} />{el.label}</span></div>
            <div className="mt-3 font-bold leading-7">{s.headline}</div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
              <Mini label="القسط المتاح" v={fmt(s.capacity.available)} strong />
              <Mini label="الاستقطاع الحالي" v={`${s.capacity.currentDbr}%`} />
              <Mini label="الدخل المعتمد" v={fmt(s.capacity.income)} />
              <Mini label="الالتزامات" v={fmt(s.capacity.existingTotal)} />
            </dl>
            {s.matches.length > 0 && (
              <ul className="mt-5 pt-4 border-t border-slate-100 space-y-2.5 text-[13px]">
                {s.matches.slice(0, 4).map((m) => (
                  <li key={m.product.id} className="flex items-center gap-2.5">
                    <span className={`size-2 rounded-full ${m.verdict === "pass" ? "bg-emerald-500" : m.verdict === "warn" ? "bg-amber-400" : "bg-rose-400"}`} />
                    <span className="flex-1 truncate">{m.product.lenderName}</span>
                    <span className="num font-semibold">{m.verdict === "fail" ? "—" : fmt(m.offerPrincipal)}</span>
                  </li>
                ))}
              </ul>
            )}
            {s.alerts.filter((a) => a.level !== "info").length > 0 && (
              <ul className="mt-4 pt-4 border-t border-slate-100 space-y-2 text-[13px]">{s.alerts.filter((a) => a.level !== "info").slice(0, 4).map((a) => <li key={a.id} className="flex gap-2 leading-5"><Icon name={a.level === "block" ? "ban" : "alert"} className={`size-4 mt-0.5 ${a.level === "block" ? "text-rose-600" : "text-amber-600"}`} />{a.title}</li>)}</ul>
            )}
            {s.scenarios[0] && s.scenarios[0].gain > 0 && <div className="mt-4 rounded-xl bg-emerald-50 text-emerald-900 p-3 text-xs leading-6 flex gap-2"><Icon name="trend" className="size-4 mt-1" /><span>{s.scenarios[0].title}: <span className="num font-bold">{fmt(s.scenarios[0].amount)}</span></span></div>}
            {s.missingData.length > 0 && <div className="mt-3 text-xs text-slate-500 leading-6">ينقص: {s.missingData.join("، ")}</div>}
          </>
        )}
      </aside>
    </form>
  );
}

function Section({ title, children, more }: { title: string; children: React.ReactNode; more?: React.ReactNode }) {
  return (
    <div className="card p-5 sm:p-6">
      <h3 className="font-bold text-[15px] mb-4">{title}</h3>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">{children}</div>
      {more && (
        <details className="group mt-4">
          <summary className="cursor-pointer list-none inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-ink"><Icon name="chevron-down" className="size-3.5 transition-transform group-open:rotate-180" />حقول إضافية</summary>
          <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">{more}</div>
        </details>
      )}
    </div>
  );
}
function Mini({ label, v, strong }: { label: string; v: string; strong?: boolean }) {
  return <div><dt className="text-[11px] text-slate-500">{label}</dt><dd className={`figure font-semibold mt-0.5 ${strong ? "text-xl text-brand-700" : "text-lg"}`}>{v}</dd></div>;
}
