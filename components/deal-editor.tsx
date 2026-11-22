"use client";
import { useMemo, useState, useTransition } from "react";
import { dealStudy, compareStructures, dealAlternatives, splitItems, STRUCTURES, STRUCTURE_KEYS, ITEM_KIND, FINANCE_BASE, FEE_MIN, FEE_MAX, type DealInput, type DealItem, type Borrower, type ItemKind, type FinanceBase } from "@/lib/deal";
import type { FormState } from "@/app/actions";

const f0 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : Math.round(n).toLocaleString("en-US"));
const BG: Record<string, string> = { go: "from-emerald-700 to-emerald-900", tight: "from-amber-600 to-amber-800", short: "from-rose-700 to-rose-900", needs_info: "from-slate-600 to-slate-800" };
const LVL: Record<string, string> = { block: "bg-rose-50 ring-rose-200 text-rose-900", warn: "bg-amber-50 ring-amber-200 text-amber-900", info: "bg-sky-50 ring-sky-200 text-sky-900" };

export default function DealEditor({
  clientId, initial, borrower, credit, canEdit, save, banks,
}: {
  clientId: number;
  initial: DealInput;
  borrower: Borrower;
  credit: { bankReopenMonths: number | null; suspension: boolean; financeCoDefault: boolean } | null;
  canEdit: boolean;
  save: (clientId: number, json: string) => Promise<FormState>;
  banks: Record<string, string>;
}) {
  const [x, setX] = useState<DealInput>(initial);
  const [msg, setMsg] = useState<FormState>(undefined);
  const [pending, start] = useTransition();
  const s = useMemo(() => dealStudy(x, borrower, credit), [x, borrower, credit]);
  const cmp = useMemo(() => compareStructures(x, borrower, credit), [x, borrower, credit]);
  const alts = useMemo(() => dealAlternatives(x, borrower, credit), [x, borrower, credit]);
  const st = STRUCTURES[s.structure];
  const keptIds = useMemo(() => new Set(splitItems(x).kept.map((i) => i.id)), [x]);
  const upd = (p: Partial<DealInput>) => { setX((o) => ({ ...o, ...p })); setMsg(undefined); };
  const updItem = (id: string, p: Partial<DealItem>) => upd({ items: x.items.map((i) => (i.id === id ? { ...i, ...p } : i)) });

  return (
    <div className="space-y-5">
      <div className="card p-4">
        <div className="text-xs font-semibold text-slate-500 mb-2">هيكل الصفقة (حسب رغبة العميل)</div>
        <div className="flex flex-wrap gap-2">
          {STRUCTURE_KEYS.map((k) => (
            <button key={k} type="button" disabled={!canEdit && k !== s.structure} onClick={() => upd({ structure: k })}
              className={`rounded-xl px-4 py-2 text-sm font-semibold ring-1 ${k === s.structure ? "bg-brand-700 text-white ring-brand-700" : "bg-white text-slate-600 ring-slate-200 hover:ring-slate-300"}`}>
              {STRUCTURES[k].label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-2">{st.hint}</p>
      </div>

      <div className={`rounded-3xl bg-gradient-to-l ${BG[s.verdict]} text-white p-6`}>
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-60">
            <div className="text-xs text-white/70">{st.label}</div>
            <div className="text-2xl font-bold mt-1">💼 {s.headline}</div>
            <div className="mt-2 text-sm text-white/85">التمويل الجديد: {st.mortgage && <>عقاري <b className="num">{f0(s.financing.mortgage)}</b></>}{st.mortgage && st.personal && " + "}{st.personal && <>شخصي <b className="num">{f0(s.financing.personal)}</b></>} {s.financing.source === "bank" ? "(أرقام البنك)" : "(تقدير)"}{s.keptMonthly > 0 && <span className="text-white/70"> · أقساط تبقى قائمة <span className="num">{f0(s.keptMonthly)}</span>/شهر</span>}</div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 flex-1 max-w-3xl">
            <Hero l="رأس المال المطلوب منا" v={f0(s.capital)} u="ريال — أقصى انكشاف" />
            <Hero l="أتعابنا" v={f0(s.fee)} u={`سداد ${f0(s.feeSettle)} + تمويل ${f0(s.feeFinance)}`} />
            <Hero l="العائد" v={s.roi != null ? `${s.roi}%` : "—"} u={s.annualized != null ? `≈ ${s.annualized}% سنوياً خلال ${s.days} يوماً` : ""} />
            <Hero l="يبقى للعميل نقداً" v={f0(s.clientNet)} u={s.clientNet < 0 ? "عجز — الصفقة لا تُغلق" : "بعد سداد كل شيء"} />
            <Hero l="تغطية الضمان" v={s.cover != null ? `${s.cover}x` : "—"} u={st.mortgage ? "قيمة العقار ÷ رأس المال" : "لا يوجد ضمان عقاري"} />
            <Hero l="خصم التسوية المطلوب" v={s.breakEvenDiscount != null ? `${s.breakEvenDiscount}%` : "—"} u={s.breakEvenDiscount != null ? "على التنفيذ والتعثرات لسد العجز" : "لا يلزم"} />
          </div>
        </div>
      </div>

      {alts.length > 0 && (
        <div className="card p-5">
          <h3 className="font-bold mb-1">💡 حلول بديلة</h3>
          <p className="text-xs text-slate-500 mb-3">تُحسب تلقائياً من أرقام هذا الملف. «تطبيق» يغيّر الأرقام هنا فقط حتى تحفظ.</p>
          <div className="grid md:grid-cols-2 gap-3">
            {alts.map((a, i) => (
              <div key={i} className={`rounded-xl ring-1 p-3 text-sm leading-6 ${a.tone === "good" ? "bg-emerald-50 ring-emerald-200" : a.tone === "maybe" ? "bg-amber-50 ring-amber-200" : "bg-slate-50 ring-slate-200 text-slate-600"}`}>
                <div className="font-semibold">{a.tone === "good" ? "✅ " : a.tone === "maybe" ? "🟡 " : "✖️ "}{a.title}</div>
                <div className="text-xs mt-0.5">{a.detail}</div>
                {a.patch && canEdit && <button type="button" className="btn-ghost btn-sm mt-2" onClick={() => upd(a.patch!)}>تطبيق</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card p-5">
        <h3 className="font-bold mb-3">مقارنة الهياكل</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead><tr className="text-xs text-slate-500"><th className="text-start py-2" />{cmp.map(({ structure }) => <th key={structure} className={`text-start ${structure === s.structure ? "text-brand-800" : ""}`}>{STRUCTURES[structure].short}{structure === s.structure ? " ●" : ""}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              <CmpRow l="الحكم" cells={cmp.map(({ s: y }) => <span className={y.verdict === "go" ? "text-emerald-700 font-bold" : y.verdict === "tight" ? "text-amber-700 font-bold" : y.verdict === "short" ? "text-rose-700 font-bold" : "text-slate-500"}>{VERDICT[y.verdict]}</span>)} />
              <CmpRow l="يبقى للعميل" cells={cmp.map(({ s: y }) => <b className={`num ${y.clientNet < 0 ? "text-rose-700" : "text-emerald-700"}`}>{f0(y.clientNet)}</b>)} />
              <CmpRow l="التمويل الجديد" cells={cmp.map(({ structure, s: y }) => <span className="num text-xs">{[STRUCTURES[structure].mortgage && `عقاري ${f0(y.financing.mortgage)}`, STRUCTURES[structure].personal && `شخصي ${f0(y.financing.personal)}`].filter(Boolean).join(" + ")}</span>)} />
              <CmpRow l="رأس المال منا" cells={cmp.map(({ s: y }) => <span className="num">{f0(y.capital)}</span>)} />
              <CmpRow l="أتعابنا" cells={cmp.map(({ s: y }) => <span className="num">{f0(y.fee)}</span>)} />
              <CmpRow l="العائد / المدة" cells={cmp.map(({ s: y }) => <span className="num">{y.roi ?? "—"}% · {y.days} يوماً</span>)} />
              <CmpRow l="الضمان" cells={cmp.map(({ s: y }) => <span className="num">{y.cover != null ? `${y.cover}x` : "بدون عقار"}</span>)} />
              <CmpRow l="الاستقطاع بعده" cells={cmp.map(({ s: y }) => <span className="num">{y.financing.dbrAfter ?? "—"}%</span>)} />
              {canEdit && <CmpRow l="" cells={cmp.map(({ structure }) => structure === s.structure ? <span className="text-xs text-brand-700">الهيكل الحالي</span> : <button type="button" className="btn-ghost btn-sm" onClick={() => upd({ structure })}>اختيار</button>)} />}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h3 className="font-bold">ما سيُسدَّد عن العميل</h3>
          <div className="text-sm text-slate-500">منّا: <b className="num text-slate-800">{f0(s.paidByCompany)}</b> · يعيد البنك تمويله: <b className="num text-slate-800">{f0(s.paidByBank)}</b></div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead><tr className="text-xs text-slate-500 text-start"><th className="text-start py-2">البند</th><th className="text-start">النوع</th><th className="text-start">المسجّل</th><th className="text-start">سنسدد</th><th className="text-start">يسدده</th><th className="text-start">القسط الشهري</th><th>مؤكد بخطاب</th><th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {x.items.map((i) => (
                <tr key={i.id} className={keptIds.has(i.id) ? "opacity-60" : ""}>
                  <td className="py-1.5 pe-2">
                    <input className="input" disabled={!canEdit} defaultValue={i.label} onBlur={(e) => updItem(i.id, { label: e.target.value })} />
                    {keptIds.has(i.id) && <span className="text-[11px] text-amber-700">يبقى قائماً بقسطه في هذا الهيكل</span>}
                  </td>
                  <td className="pe-2"><select className="input" disabled={!canEdit} value={i.kind} onChange={(e) => updItem(i.id, { kind: e.target.value as ItemKind })}>{Object.entries(ITEM_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                  <td className="pe-2 num text-slate-500 whitespace-nowrap">{f0(i.original)}</td>
                  <td className="pe-2 w-36"><input className="input num" disabled={!canEdit} defaultValue={i.pay} onBlur={(e) => updItem(i.id, { pay: numIn(e.target.value) ?? 0 })} /></td>
                  <td className="pe-2"><select className="input" disabled={!canEdit} value={i.by} onChange={(e) => updItem(i.id, { by: e.target.value as DealItem["by"] })}><option value="company">الشركة</option><option value="bank">البنك الجديد (من الشخصي)</option></select></td>
                  <td className="pe-2 w-28"><input key={`m${i.id}${i.monthly ?? ""}`} className="input num" disabled={!canEdit} defaultValue={i.monthly ?? ""} placeholder="—" onBlur={(e) => updItem(i.id, { monthly: numIn(e.target.value) })} /></td>
                  <td className="text-center"><input type="checkbox" disabled={!canEdit} checked={!!i.confirmed} onChange={(e) => updItem(i.id, { confirmed: e.target.checked })} /></td>
                  <td>{canEdit && <button type="button" className="text-rose-600 text-xs" onClick={() => upd({ items: x.items.filter((y) => y.id !== i.id) })}>حذف</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && <button type="button" className="btn-ghost mt-3" onClick={() => upd({ items: [...x.items, { id: `n${Date.now()}`, kind: "other", label: "بند جديد", original: 0, pay: 0, by: "company" }] })}>+ بند</button>}
        <p className="text-xs text-slate-500 mt-2">عدّل «سنسدد» بعد التفاوض على الخصم أو بعد وصول خطاب المديونية. المخالصة التي يعيد البنك الجديد تمويلها تُخصم من التمويل الشخصي لا من رأس مالنا.</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card p-5 space-y-3">
          <h3 className="font-bold">العقار والتكاليف والأتعاب</h3>
          {!st.mortgage && <p className="text-xs rounded-lg bg-slate-50 p-2 text-slate-500">العقار خارج هذا الهيكل: لا مخالصة ولا إفراغ ولا ضريبة تصرفات.</p>}
          <N disabled={!canEdit} label="قيمة العقار (التقييم = سعر البيع للبنك)" value={x.propertyValue} onChange={(v) => upd({ propertyValue: v })} />
          <div className="grid grid-cols-2 gap-3">
            <N disabled={!canEdit} label="ضريبة الإفراغ لطرفنا %" value={x.transferTaxPct} onChange={(v) => upd({ transferTaxPct: v ?? 0 })} />
            <N disabled={!canEdit} label="ضريبة البيع للبنك %" value={x.saleTaxPct} onChange={(v) => upd({ saleTaxPct: v ?? 0 })} hint="0 إن كان مسكناً أول للمواطن" />
          </div>
          <N disabled={!canEdit} label="تكاليف ثابتة (تقييم، سعي، رسوم)" value={x.fixedCosts} onChange={(v) => upd({ fixedCosts: v ?? 0 })} />
          <div className="rounded-xl bg-brand-50 p-3 space-y-3">
            <div className="text-xs font-bold text-brand-800">الأتعاب (من {FEE_MIN}% إلى {FEE_MAX}%) — النسبة المقترحة لهذا العميل: {s.suggestedPct}%{s.suggestedWhy.length ? ` (${s.suggestedWhy.join("، ")})` : ""}</div>
            <div className="grid grid-cols-2 gap-3">
              <N disabled={!canEdit} label="نسبة سداد المتعثرات %" value={x.fee.settlePct} onChange={(v) => upd({ fee: { ...x.fee, settlePct: v ?? 0 } })} />
              <N disabled={!canEdit} label="نسبة استخراج التمويل %" value={x.fee.financePct} onChange={(v) => upd({ fee: { ...x.fee, financePct: v ?? 0 } })} />
            </div>
            <label className="block"><span className="text-xs font-semibold text-slate-500">نسبة التمويل تُحسب على</span>
              <select className="input mt-1" disabled={!canEdit} value={x.fee.financeBase} onChange={(e) => upd({ fee: { ...x.fee, financeBase: e.target.value as FinanceBase } })}>{Object.entries(FINANCE_BASE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" disabled={!canEdit} checked={x.fee.settleIncludesPayoff} onChange={(e) => upd({ fee: { ...x.fee, settleIncludesPayoff: e.target.checked } })} /> نسبة السداد تشمل مخالصة العقار أيضاً</label>
            <N disabled={!canEdit} label="مبلغ مقطوع إضافي" value={x.fee.fixed} onChange={(v) => upd({ fee: { ...x.fee, fixed: v ?? 0 } })} />
            {canEdit && <button type="button" className="btn-ghost text-xs" onClick={() => upd({ fee: { ...x.fee, settlePct: s.suggestedPct, financePct: s.suggestedPct } })}>تطبيق النسبة المقترحة على البندين</button>}
          </div>
        </div>

        <div className="card p-5 space-y-3">
          <h3 className="font-bold">التمويل الجديد</h3>
          <label className="block"><span className="text-xs font-semibold text-slate-500">البنك المستهدف</span>
            <select className="input mt-1" disabled={!canEdit} value={x.targetBank ?? ""} onChange={(e) => upd({ targetBank: e.target.value || null })}><option value="">—</option>{Object.entries(banks).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <N disabled={!canEdit} label="هامش العقاري % (متناقص)" value={x.mortgageApr} onChange={(v) => upd({ mortgageApr: v ?? 5.5 })} />
            <N disabled={!canEdit} label="هامش الشخصي % (ثابت)" value={x.personalFlat} onChange={(v) => upd({ personalFlat: v ?? 3 })} />
            <N disabled={!canEdit} label="نسبة التمويل للقيمة %" value={x.ltvPct} onChange={(v) => upd({ ltvPct: v ?? 90 })} />
            <N disabled={!canEdit} label="أقصى عمر عند نهاية العقاري" value={x.mortgageMaxAge} onChange={(v) => upd({ mortgageMaxAge: v ?? 70 })} />
          </div>
          <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
            <div>العمر {s.financing.age ?? "—"} · التقاعد بعد {s.financing.monthsToRetire != null ? `${Math.round(s.financing.monthsToRetire / 12)} سنة` : "—"} · المعاش التقديري <span className="num">{f0(s.financing.pension)}</span></div>
            <div>الشخصي: قسط <span className="num">{f0(s.financing.personalInstallment)}</span> × {s.financing.personalMonths} شهراً</div>
            <div>العقاري: قسط <span className="num">{f0(s.financing.mortgagePre)}</span> قبل التقاعد ثم <span className="num">{f0(s.financing.mortgagePost)}</span> · {s.financing.mortgageMonths} شهراً</div>
            <div>حد الدخل <span className="num">{f0(s.financing.mortgageByIncome)}</span> · حد القيمة <span className="num">{f0(s.financing.mortgageByLtv)}</span> · الاستقطاع بعد التمويل {s.financing.dbrAfter ?? "—"}%</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <N disabled={!canEdit} label="عقاري حسب عرض البنك" value={x.bankMortgage} onChange={(v) => upd({ bankMortgage: v })} hint="يُلغي التقدير" />
            <N disabled={!canEdit} label="شخصي حسب عرض البنك" value={x.bankPersonal} onChange={(v) => upd({ bankPersonal: v })} hint="يُلغي التقدير" />
          </div>
        </div>

        <div className="card p-5">
          <h3 className="font-bold mb-3">مسار الأموال</h3>
          <ul className="space-y-2 text-sm">
            {s.waterfall.map((w, i) => (
              <li key={i} className="flex items-start justify-between gap-3">
                <span className="text-slate-600">{w.label}</span>
                <b className={`num whitespace-nowrap ${w.tone === "out" ? "text-rose-700" : w.tone === "net" ? "text-brand-700" : "text-emerald-700"}`}>{f0(w.amount)}</b>
              </li>
            ))}
            <li className="border-t pt-2 flex justify-between"><span className="text-slate-600">صافي الشخصي للعميل (بعد إعادة التمويل والرسوم)</span><b className="num">{f0(s.personalCash)}</b></li>
            {st.mortgage && <li className="flex justify-between"><span className="text-slate-600">الدفعة الأولى للعقار (من الشخصي)</span><b className="num">{f0(s.downPayment)}</b></li>}
            <li className="flex justify-between border-t pt-2"><span className="font-bold">يبقى للعميل</span><b className={`num ${s.clientNet < 0 ? "text-rose-700" : "text-emerald-700"}`}>{f0(s.clientNet)}</b></li>
          </ul>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="font-bold mb-3">المخاطر والضمانات</h3>
        <div className="grid md:grid-cols-2 gap-3">
          {s.risks.map((r, i) => <div key={i} className={`rounded-xl ring-1 p-3 text-sm leading-6 ${LVL[r.level]}`}>{r.level === "block" ? "⛔ " : r.level === "warn" ? "⚠️ " : "ℹ️ "}{r.text}</div>)}
        </div>
      </div>

      <div className="card p-5">
        <h3 className="font-bold mb-2">ملاحظات الصفقة</h3>
        <textarea className="input min-h-24" disabled={!canEdit} defaultValue={x.notes} onBlur={(e) => upd({ notes: e.target.value })} placeholder="نتيجة التفاوض مع الدائنين، رد البنك، اتفاق العميل..." />
      </div>

      {canEdit && (
        <div className="sticky bottom-3 flex items-center gap-3 rounded-2xl bg-white/90 backdrop-blur ring-1 ring-slate-200 p-3 shadow-sm">
          <button type="button" className="btn-primary" disabled={pending} onClick={() => start(async () => setMsg(await save(clientId, JSON.stringify(x))))}>{pending ? "جارٍ الحفظ..." : "💾 حفظ دراسة الصفقة"}</button>
          {msg?.ok && <span className="text-sm text-emerald-700">{msg.ok}</span>}
          {msg?.error && <span className="text-sm text-rose-700">{msg.error}</span>}
          <span className="text-xs text-slate-400 ms-auto">الأرقام تتحدث فوراً؛ الحفظ يثبتها في الملف ولوحة الصفقات.</span>
        </div>
      )}
    </div>
  );
}

const VERDICT: Record<string, string> = { go: "✅ تقفل", tight: "🟡 هامش ضيق", short: "🔴 عجز", needs_info: "⚪ ناقصة" };
function CmpRow({ l, cells }: { l: string; cells: React.ReactNode[] }) {
  return <tr><td className="py-2 text-xs font-semibold text-slate-500 whitespace-nowrap pe-3">{l}</td>{cells.map((c, i) => <td key={i} className="py-2 pe-3">{c}</td>)}</tr>;
}

function Hero({ l, v, u }: { l: string; v: string; u?: string }) {
  return (
    <div className="rounded-2xl bg-white/10 p-3">
      <div className="text-[11px] text-white/70">{l}</div>
      <div className="text-xl font-bold num mt-0.5">{v}</div>
      {u && <div className="text-[11px] text-white/70 mt-0.5">{u}</div>}
    </div>
  );
}

const numIn = (v: string) => (v.trim() === "" ? null : Number(v.replace(/[,،\s]/g, "")));
function N({ label, value, onChange, hint, disabled }: { label: string; value: number | null; onChange: (n: number | null) => void; hint?: string; disabled?: boolean }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <input key={String(value ?? "")} className="input mt-1 num" inputMode="decimal" disabled={disabled} defaultValue={value ?? ""} onBlur={(e) => onChange(numIn(e.target.value))} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}
