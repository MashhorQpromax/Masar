"use client";
import { useMemo, useState, useTransition } from "react";
import { dealStudy, compareStructures, dealAlternatives, splitItems, STRUCTURES, STRUCTURE_KEYS, ITEM_KIND, FINANCE_BASE, FEE_MIN, FEE_MAX, type DealInput, type DealItem, type Borrower, type ItemKind, type FinanceBase, type DealStudy } from "@/lib/deal";
import type { FormState } from "@/app/actions";
import { Icon } from "@/components/icon";
import { Fold, Callout } from "@/components/ui";

const f0 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : Math.round(n).toLocaleString("en-US"));
const VERDICT: Record<string, { label: string; icon: string; chip: string; text: string }> = {
  go: { label: "تُغلق", icon: "check-circle", chip: "bg-emerald-50 text-emerald-800", text: "text-emerald-700" },
  tight: { label: "هامش ضيق", icon: "alert", chip: "bg-amber-50 text-amber-800", text: "text-amber-700" },
  short: { label: "عجز", icon: "x-circle", chip: "bg-rose-50 text-rose-800", text: "text-rose-700" },
  needs_info: { label: "بيانات ناقصة", icon: "info", chip: "bg-slate-100 text-slate-600", text: "text-slate-500" },
};
const PAYOFF = new Set<ItemKind>(["mortgage_payoff", "personal_payoff"]);

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
  const [saved, setSaved] = useState<DealInput>(initial);
  const [msg, setMsg] = useState<FormState>(undefined);
  const [more, setMore] = useState(false);
  const [pending, start] = useTransition();
  const s = useMemo(() => dealStudy(x, borrower, credit), [x, borrower, credit]);
  const cmp = useMemo(() => compareStructures(x, borrower, credit), [x, borrower, credit]);
  const alts = useMemo(() => dealAlternatives(x, borrower, credit), [x, borrower, credit]);
  const st = STRUCTURES[s.structure];
  const v = VERDICT[s.verdict];
  const keptIds = useMemo(() => new Set(splitItems(x).kept.map((i) => i.id)), [x]);
  const dirty = x !== saved;
  const upd = (p: Partial<DealInput>) => { setX((o) => ({ ...o, ...p })); setMsg(undefined); };
  const updItem = (id: string, p: Partial<DealItem>) => upd({ items: x.items.map((i) => (i.id === id ? { ...i, ...p } : i)) });
  const blocks = s.risks.filter((r) => r.level === "block");
  const others = s.risks.filter((r) => r.level !== "block");

  return (
    <div className="space-y-4">
      {/* الحكم */}
      <section className="card p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 h-7 text-xs font-bold ${v.chip}`}><Icon name={v.icon} className="size-4" strokeWidth={2} />{v.label}</span>
          <div className="seg">
            {STRUCTURE_KEYS.map((k) => (
              <button key={k} type="button" disabled={!canEdit && k !== s.structure} onClick={() => upd({ structure: k })} title={STRUCTURES[k].hint}
                className={`seg-item ${k === s.structure ? "seg-on" : ""} disabled:opacity-40 disabled:cursor-default`}>{STRUCTURES[k].short}</button>
            ))}
          </div>
        </div>
        <h2 className="mt-4 text-[22px] sm:text-2xl font-bold leading-snug max-w-3xl">{s.headline}</h2>
        {blocks.map((r, i) => <p key={i} className="mt-2 text-[13px] text-rose-800 leading-6 max-w-3xl">{r.text}</p>)}

        <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-5">
          <Fig label="يبقى للعميل" value={f0(s.clientNet)} tone={s.clientNet < 0 ? "text-rose-700" : "text-emerald-700"} hint={s.clientNet < 0 ? "عجز" : "نقداً بعد كل شيء"} />
          <Fig label="رأس المال منا" value={f0(s.capital)} hint={s.cover != null ? `ضمان ${s.cover}x` : "بلا ضمان عقاري"} />
          <Fig label="أتعابنا" value={f0(s.fee)} tone="text-brand-700" hint={s.roi != null ? `عائد ${s.roi}% في ${s.days} يوماً` : undefined} />
          <Fig label="التمويل الجديد" value={f0(s.summary.totalFinancing)} hint={s.financing.source === "bank" ? "حسب عرض الجهة" : "تقدير"} />
        </div>

        <div className="mt-7"><BridgeViz s={s} /></div>
      </section>

      {/* البنود */}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-3">
          <h3 className="font-bold text-[15px]">ما يُسدَّد عن العميل</h3>
          <button type="button" onClick={() => setMore((m) => !m)} className="btn-quiet btn-sm"><Icon name="sliders" className="size-3.5" />{more ? "أعمدة أقل" : "كل الأعمدة"}</button>
        </div>
        <div className="overflow-x-auto">
          <table className={`w-full text-sm ${more ? "min-w-[980px]" : "min-w-[620px]"}`}>
            <thead><tr>
              <th className="th ps-5">البند</th>
              {more && <th className="th">النوع</th>}
              {more && <th className="th">المسجّل</th>}
              <th className="th w-24">الخصم %</th>
              <th className="th w-36">سنسدد</th>
              <th className="th w-44">يسدده</th>
              {more && <th className="th w-28">القسط الشهري</th>}
              {more && <th className="th text-center">بخطاب</th>}
              <th className="th w-10" />
            </tr></thead>
            <tbody>
              {x.items.map((i) => {
                const out = keptIds.has(i.id);
                return (
                  <tr key={i.id} className={`border-b border-slate-100 ${out ? "bg-slate-50/60" : ""}`}>
                    <td className="py-2 ps-5 pe-2 min-w-48">
                      <input className={`input ${out ? "text-slate-500" : ""}`} disabled={!canEdit} defaultValue={i.label} onBlur={(e) => updItem(i.id, { label: e.target.value })} />
                      {out && <div className="mt-1 text-[11px] font-medium text-amber-700 flex items-center gap-1">{i.by === "out" && i.kind === "execution" && <Icon name="ban" className="size-3" />}{i.by === "out" ? (i.kind === "execution" ? "خارج الصفقة، الإيقاف يبقى" : "خارج الصفقة") : "يبقى قائماً بقسطه"}</div>}
                    </td>
                    {more && <td className="pe-2"><select className="input" disabled={!canEdit} value={i.kind} onChange={(e) => updItem(i.id, { kind: e.target.value as ItemKind })}>{Object.entries(ITEM_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>}
                    {more && <td className="pe-2 num text-slate-500 whitespace-nowrap">{f0(i.original)}</td>}
                    <td className="pe-2">
                      {PAYOFF.has(i.kind) || !i.original ? <span className="text-slate-300 px-3">—</span> : (
                        <input key={`d${i.id}${i.pay}`} className="input num" inputMode="decimal" disabled={!canEdit} placeholder="0" defaultValue={i.pay < i.original ? Math.round((1 - i.pay / i.original) * 1000) / 10 : ""}
                          onBlur={(e) => { const p = Math.min(100, Math.max(0, numIn(e.target.value) ?? 0)); updItem(i.id, { pay: Math.round(i.original * (1 - p / 100)) }); }} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
                      )}
                    </td>
                    <td className="pe-2">
                      <input key={`p${i.id}${i.pay}`} className="input num font-semibold" disabled={!canEdit} defaultValue={i.pay} onBlur={(e) => updItem(i.id, { pay: numIn(e.target.value) ?? 0 })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
                    </td>
                    <td className="pe-2"><select className="input" disabled={!canEdit} value={i.by} onChange={(e) => updItem(i.id, { by: e.target.value as DealItem["by"] })}><option value="company">الشركة</option><option value="bank">الجهة الجديدة</option><option value="out">خارج الصفقة</option></select></td>
                    {more && <td className="pe-2"><input key={`m${i.id}${i.monthly ?? ""}`} className="input num" disabled={!canEdit} defaultValue={i.monthly ?? ""} placeholder="—" onBlur={(e) => updItem(i.id, { monthly: numIn(e.target.value) })} /></td>}
                    {more && <td className="text-center"><input type="checkbox" className="size-4 accent-brand-700" disabled={!canEdit} checked={!!i.confirmed} onChange={(e) => updItem(i.id, { confirmed: e.target.checked })} /></td>}
                    <td className="pe-3">{canEdit && <button type="button" aria-label="حذف البند" className="size-8 grid place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-700 cursor-pointer" onClick={() => upd({ items: x.items.filter((y) => y.id !== i.id) })}><Icon name="trash" className="size-4" /></button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3.5 text-[13px] text-slate-500">
          {canEdit && <button type="button" className="btn-ghost btn-sm" onClick={() => upd({ items: [...x.items, { id: `n${Date.now()}`, kind: "other", label: "بند جديد", original: 0, pay: 0, by: "company" }] })}><Icon name="plus" className="size-3.5" />بند</button>}
          <span className="ms-auto">من الشركة <b className="num text-ink">{f0(s.paidByCompany)}</b></span>
          {s.paidByBank > 0 && <span>من الجهة الجديدة <b className="num text-ink">{f0(s.paidByBank)}</b></span>}
          {s.summary.discountTotal > 0 && <span>وفّرنا بالتفاوض <b className="num text-emerald-700">{f0(s.summary.discountTotal)}</b></span>}
        </div>
      </section>

      <Fold title="التمويل الجديد" icon="bank" meta={<span className="num">{[st.mortgage && `عقاري ${f0(s.financing.mortgage)}`, st.personal && `شخصي ${f0(s.financing.personal)}`].filter(Boolean).join(" · ")}</span>}>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {st.mortgage && <N disabled={!canEdit} label="عرض العقاري الفعلي" value={x.bankMortgage} onChange={(n) => upd({ bankMortgage: n })} hint="فارغ = تقدير" />}
          {st.personal && <N disabled={!canEdit} label="عرض الشخصي الفعلي" value={x.bankPersonal} onChange={(n) => upd({ bankPersonal: n })} hint="فارغ = تقدير" />}
          {st.personal && <T disabled={!canEdit} label="جهة عرض الشخصي" value={x.personalLender ?? ""} onChange={(t) => upd({ personalLender: t || null })} />}
          {st.personal && (
            <L label="نوعها"><select className="input" disabled={!canEdit} value={x.personalLenderKind ?? ""} onChange={(e) => upd({ personalLenderKind: (e.target.value || null) as DealInput["personalLenderKind"] })}><option value="">—</option><option value="bank">بنك</option><option value="finance_co">شركة تمويل</option></select></L>
          )}
          <L label="البنك المستهدف"><select className="input" disabled={!canEdit} value={x.targetBank ?? ""} onChange={(e) => upd({ targetBank: e.target.value || null })}><option value="">—</option>{Object.entries(banks).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></L>
        </div>
        <details className="mt-4 group">
          <summary className="cursor-pointer list-none inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-ink"><Icon name="chevron-down" className="size-3.5 transition-transform group-open:rotate-180" />افتراضات التقدير</summary>
          <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-3">
            <N disabled={!canEdit} label="هامش العقاري % (متناقص)" value={x.mortgageApr} onChange={(n) => upd({ mortgageApr: n ?? 5.5 })} />
            <N disabled={!canEdit} label="هامش الشخصي % (ثابت)" value={x.personalFlat} onChange={(n) => upd({ personalFlat: n ?? 3 })} />
            <N disabled={!canEdit} label="التمويل إلى القيمة %" value={x.ltvPct} onChange={(n) => upd({ ltvPct: n ?? 90 })} />
            <N disabled={!canEdit} label="أقصى عمر بنهاية العقاري" value={x.mortgageMaxAge} onChange={(n) => upd({ mortgageMaxAge: n ?? 70 })} />
          </div>
          <dl className="mt-3 grid sm:grid-cols-2 gap-x-8 text-[13px]">
            <Row k="العمر والتقاعد" v={`${s.financing.age ?? "—"} سنة، التقاعد بعد ${s.financing.monthsToRetire != null ? Math.round(s.financing.monthsToRetire / 12) : "—"} سنة`} />
            <Row k="المعاش التقديري" v={f0(s.financing.pension)} num />
            {st.personal && <Row k="قسط الشخصي" v={`${f0(s.financing.personalInstallment)} × ${s.financing.personalMonths} شهراً`} num />}
            {st.mortgage && <Row k="قسط العقاري" v={`${f0(s.financing.mortgagePre)} ثم ${f0(s.financing.mortgagePost)} بعد التقاعد`} num />}
            {st.mortgage && <Row k="حد الدخل / حد القيمة" v={`${f0(s.financing.mortgageByIncome)} / ${f0(s.financing.mortgageByLtv)}`} num />}
            <Row k="الاستقطاع بعد التمويل" v={`${s.financing.dbrAfter ?? "—"}%`} num />
          </dl>
        </details>
      </Fold>

      <Fold title="الأتعاب" icon="coins" meta={<span className="num">{f0(s.fee)}</span>}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <N disabled={!canEdit} label="على سداد المتعثرات %" value={x.fee.settlePct} onChange={(n) => upd({ fee: { ...x.fee, settlePct: n ?? 0 } })} hint={`= ${f0(s.feeSettle)}`} />
          <N disabled={!canEdit} label="على استخراج التمويل %" value={x.fee.financePct} onChange={(n) => upd({ fee: { ...x.fee, financePct: n ?? 0 } })} hint={`= ${f0(s.feeFinance)}`} />
          <L label="تُحسب نسبة التمويل على"><select className="input" disabled={!canEdit} value={x.fee.financeBase} onChange={(e) => upd({ fee: { ...x.fee, financeBase: e.target.value as FinanceBase } })}>{Object.entries(FINANCE_BASE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></L>
          <N disabled={!canEdit} label="مبلغ مقطوع إضافي" value={x.fee.fixed} onChange={(n) => upd({ fee: { ...x.fee, fixed: n ?? 0 } })} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-slate-600">
          <label className="inline-flex items-center gap-2"><input type="checkbox" className="size-4 accent-brand-700" disabled={!canEdit} checked={x.fee.settleIncludesPayoff} onChange={(e) => upd({ fee: { ...x.fee, settleIncludesPayoff: e.target.checked } })} />نسبة السداد تشمل مخالصة العقار</label>
          <span className="ms-auto text-slate-500">المقترح لهذا العميل <b className="num text-ink">{s.suggestedPct}%</b>{s.suggestedWhy.length ? ` (${s.suggestedWhy.join("، ")})` : ""} · الحدود {FEE_MIN} إلى {FEE_MAX}%</span>
          {canEdit && <button type="button" className="btn-ghost btn-sm" onClick={() => upd({ fee: { ...x.fee, settlePct: s.suggestedPct, financePct: s.suggestedPct } })}>تطبيق المقترح</button>}
        </div>
      </Fold>

      {st.mortgage && (
        <Fold title="العقار والتكاليف" icon="building" meta={<span className="num">{f0(x.propertyValue)}</span>}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <N disabled={!canEdit} label="قيمة العقار (التقييم)" value={x.propertyValue} onChange={(n) => upd({ propertyValue: n })} />
            <N disabled={!canEdit} label="ضريبة الإفراغ لطرفنا %" value={x.transferTaxPct} onChange={(n) => upd({ transferTaxPct: n ?? 0 })} />
            <N disabled={!canEdit} label="ضريبة البيع للبنك %" value={x.saleTaxPct} onChange={(n) => upd({ saleTaxPct: n ?? 0 })} hint="0 للمسكن الأول" />
            <N disabled={!canEdit} label="تكاليف ثابتة" value={x.fixedCosts} onChange={(n) => upd({ fixedCosts: n ?? 0 })} hint="تقييم، سعي، رسوم" />
          </div>
        </Fold>
      )}

      {(alts.length > 0 || cmp.length > 1) && (
        <Fold title="بدائل وحلول" icon="bulb" open={s.verdict === "short"} meta={alts.filter((a) => a.tone === "good").length ? <span className="text-emerald-700 font-semibold">{alts.filter((a) => a.tone === "good").length} حل ممكن</span> : undefined}>
          {alts.length > 0 && (
            <ul className="space-y-2 mb-5">
              {alts.map((a, i) => (
                <li key={i} className="flex items-start gap-3 rounded-xl border border-slate-200/70 p-3.5">
                  <Icon name={a.tone === "good" ? "check-circle" : a.tone === "maybe" ? "alert" : "x-circle"} className={`size-[18px] mt-0.5 ${a.tone === "good" ? "text-emerald-600" : a.tone === "maybe" ? "text-amber-600" : "text-slate-400"}`} />
                  <div className="flex-1 min-w-0"><div className={`text-sm font-semibold ${a.tone === "no" ? "text-slate-500" : ""}`}>{a.title}</div><div className="text-[13px] text-slate-500 mt-0.5 leading-6">{a.detail}</div></div>
                  {a.patch && canEdit && <button type="button" className="btn-ghost btn-sm" onClick={() => upd(a.patch!)}>جرّب</button>}
                </li>
              ))}
            </ul>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead><tr><th className="th ps-0" />{cmp.map(({ structure }) => <th key={structure} className={`th ${structure === s.structure ? "!text-brand-800" : ""}`}>{STRUCTURES[structure].short}{structure === s.structure && <span className="ms-1.5 inline-block size-1.5 rounded-full bg-gold align-middle" />}</th>)}</tr></thead>
              <tbody>
                <CmpRow l="الحكم" cells={cmp.map(({ s: y }) => <span className={`font-semibold ${VERDICT[y.verdict].text}`}>{VERDICT[y.verdict].label}</span>)} />
                <CmpRow l="يبقى للعميل" cells={cmp.map(({ s: y }) => <b className={`num ${y.clientNet < 0 ? "text-rose-700" : "text-emerald-700"}`}>{f0(y.clientNet)}</b>)} />
                <CmpRow l="التمويل" cells={cmp.map(({ s: y }) => <span className="num">{f0(y.summary.totalFinancing)}</span>)} />
                <CmpRow l="رأس المال" cells={cmp.map(({ s: y }) => <span className="num">{f0(y.capital)}</span>)} />
                <CmpRow l="أتعابنا" cells={cmp.map(({ s: y }) => <span className="num">{f0(y.fee)}</span>)} />
                <CmpRow l="الاستقطاع" cells={cmp.map(({ s: y }) => <span className="num">{y.financing.dbrAfter ?? "—"}%</span>)} />
                {canEdit && <CmpRow l="" cells={cmp.map(({ structure }) => structure === s.structure ? null : <button type="button" className="btn-ghost btn-sm" onClick={() => upd({ structure })}>اختيار</button>)} />}
              </tbody>
            </table>
          </div>
        </Fold>
      )}

      <Fold title="تفصيل الحساب" icon="calc">
        <div className="grid lg:grid-cols-2 gap-x-10 gap-y-6">
          {[...new Set(s.explain.map((e) => e.group))].map((g) => (
            <div key={g}>
              <div className="eyebrow mb-2">{g}</div>
              <table className="w-full text-[13px]">
                <tbody>
                  {s.explain.filter((e) => e.group === g).map((e, i) => (
                    <tr key={i} className={e.tone === "total" ? "border-t border-slate-200 font-bold" : ""}>
                      <td className="py-1.5 pe-2 align-top">
                        <div className={e.tone === "total" ? "" : "text-slate-700"}>{e.label}</div>
                        {e.note && <div className="text-[11px] text-slate-400">{e.note}</div>}
                        {e.calc && <div className="text-[11px] text-slate-400 text-right" dir="ltr" style={{ unicodeBidi: "plaintext" }}>{e.calc}</div>}
                      </td>
                      <td className={`py-1.5 text-left num whitespace-nowrap align-top ${e.tone === "minus" || (e.tone === "total" && e.value < 0) ? "text-rose-700" : e.tone === "total" ? "text-emerald-800" : ""}`}>{f0(e.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </Fold>

      {others.length > 0 && (
        <Fold title="تنبيهات" icon="shield" meta={<span className="num">{others.length}</span>}>
          <ul className="space-y-2">{others.map((r, i) => <li key={i}><Callout tone={r.level === "warn" ? "amber" : "slate"}>{r.text}</Callout></li>)}</ul>
        </Fold>
      )}

      <Fold title="ملاحظات" icon="edit" open={!!x.notes}>
        <textarea className="input min-h-24" disabled={!canEdit} defaultValue={x.notes} onBlur={(e) => upd({ notes: e.target.value })} placeholder="نتيجة التفاوض، رد البنك، اتفاق العميل" />
      </Fold>

      {canEdit && (dirty || msg) && (
        <div className="no-print sticky bottom-[74px] lg:bottom-4 z-20 flex items-center gap-3 rounded-2xl bg-ink text-white ps-5 pe-2.5 py-2.5 shadow-[0_18px_40px_-12px_rgba(20,28,24,.5)] animate-rise">
          <span className="flex-1 text-sm">{msg?.error ? <span className="text-rose-300">{msg.error}</span> : msg?.ok && !dirty ? <span className="inline-flex items-center gap-2"><Icon name="check" className="size-4 text-gold" />{msg.ok}</span> : "تغييرات غير محفوظة"}</span>
          {dirty && <button type="button" className="btn btn-sm text-white/70 hover:text-white" onClick={() => { setX(saved); setMsg(undefined); }}>تراجع</button>}
          {dirty && <button type="button" className="btn h-9 bg-gold text-ink hover:bg-gold-soft" disabled={pending} onClick={() => start(async () => { const snap = x; const r = await save(clientId, JSON.stringify(snap)); setMsg(r); if (r?.ok) setSaved(snap); })}>{pending ? "جارٍ الحفظ" : "حفظ"}</button>}
        </div>
      )}
    </div>
  );
}

/** الجسر: ما يدخل من التمويل مقابل ما يخرج. الفجوة = العجز، والزيادة = ما يبقى للعميل. */
function BridgeViz({ s }: { s: DealStudy }) {
  const costs = s.summary.costs.reduce((a, c) => a + c.amount, 0);
  const have = s.summary.totalFinancing;
  const need = s.summary.totalObligations + costs + s.fee;
  const scale = Math.max(have, need, 1);
  const gap = Math.max(0, need - have);
  const surplus = Math.max(0, have - need);
  const FIN = ["bg-brand-700", "bg-brand-400", "bg-brand-300"];
  const inflow = s.summary.financing.filter((f) => f.amount > 0).map((f, i) => ({ label: f.label, amount: f.amount, cls: FIN[i % FIN.length] }));
  const outflow = [
    { label: "الالتزامات", amount: s.summary.totalObligations, cls: "bg-slate-700" },
    { label: "تكاليف", amount: costs, cls: "bg-slate-400" },
    { label: "أتعابنا", amount: s.fee, cls: "bg-gold" },
  ].filter((p) => p.amount > 0);
  if (have <= 0 && need <= 0) return null;
  const w = (n: number) => `${(n / scale) * 100}%`;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs mb-2"><span className="font-semibold text-slate-600">يدخل من التمويل</span><span className="num font-semibold">{f0(have)}</span></div>
      <div className="flex h-3.5 gap-[3px]">
        {inflow.map((p, i) => <div key={p.label} className={`${p.cls} rounded-[5px] origin-right grow-x`} style={{ width: w(p.amount), animationDelay: `${i * 120}ms` }} title={`${p.label}: ${f0(p.amount)}`} />)}
        {gap > 0 && <div className="rounded-[5px] border-[1.5px] border-dashed border-rose-400 bg-rose-50 fade" style={{ width: w(gap), animationDelay: ".5s" }} title={`عجز: ${f0(gap)}`} />}
      </div>
      <svg viewBox="0 0 400 22" preserveAspectRatio="none" className="w-full h-6 my-1 text-slate-300" aria-hidden>
        {Array.from({ length: 8 }).map((_, i) => <path key={i} d={`M${i * 50} 22 A25 20 0 0 1 ${i * 50 + 50} 22`} fill="none" stroke="currentColor" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />)}
        <path d="M0 1 H400" stroke="currentColor" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex h-3.5 gap-[3px]">
        {outflow.map((p, i) => <div key={p.label} className={`${p.cls} rounded-[5px] origin-right grow-x`} style={{ width: w(p.amount), animationDelay: `${200 + i * 120}ms` }} title={`${p.label}: ${f0(p.amount)}`} />)}
        {surplus > 0 && <div className="rounded-[5px] bg-emerald-500 origin-right grow-x" style={{ width: w(surplus), animationDelay: ".6s" }} title={`يبقى للعميل: ${f0(surplus)}`} />}
      </div>
      <div className="flex items-baseline justify-between text-xs mt-2"><span className="font-semibold text-slate-600">يخرج</span><span className="num font-semibold">{f0(need)}</span></div>
      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-600">
        {[...inflow, ...outflow].map((p) => <li key={p.label} className="inline-flex items-center gap-1.5"><span className={`size-2.5 rounded-[3px] ${p.cls}`} />{p.label}<b className="num text-ink">{f0(p.amount)}</b></li>)}
        {gap > 0 && <li className="inline-flex items-center gap-1.5 text-rose-700 font-semibold"><span className="size-2.5 rounded-[3px] border-[1.5px] border-dashed border-rose-400" />العجز<b className="num">{f0(gap)}</b></li>}
        {surplus > 0 && <li className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold"><span className="size-2.5 rounded-[3px] bg-emerald-500" />يبقى للعميل<b className="num">{f0(surplus)}</b></li>}
      </ul>
    </div>
  );
}

function Fig({ label, value, hint, tone = "text-ink" }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="eyebrow">{label}</div>
      <div className={`figure text-[26px] sm:text-[28px] font-semibold leading-none mt-1.5 ${tone}`}>{value}</div>
      {hint && <div className="text-xs text-slate-500 mt-1.5">{hint}</div>}
    </div>
  );
}
function CmpRow({ l, cells }: { l: string; cells: React.ReactNode[] }) {
  return <tr className="border-b border-slate-100 last:border-0"><td className="py-2.5 text-xs font-semibold text-slate-500 whitespace-nowrap pe-3">{l}</td>{cells.map((c, i) => <td key={i} className="py-2.5 px-4">{c}</td>)}</tr>;
}
function Row({ k, v, num }: { k: string; v: string; num?: boolean }) {
  return <div className="flex justify-between gap-4 py-1.5 border-b border-slate-100"><dt className="text-slate-500">{k}</dt><dd className={`font-medium ${num ? "tabular-nums" : ""}`}>{v}</dd></div>;
}
function L({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="block"><span className="label">{label}</span>{children}{hint && <span className="block mt-1 text-[11px] text-slate-400">{hint}</span>}</label>;
}
const numIn = (v: string) => (v.trim() === "" ? null : Number(v.replace(/[,،\s]/g, "")));
function N({ label, value, onChange, hint, disabled }: { label: string; value: number | null; onChange: (n: number | null) => void; hint?: string; disabled?: boolean }) {
  return (
    <L label={label} hint={hint}>
      <input key={String(value ?? "")} className="input num" inputMode="decimal" disabled={disabled} defaultValue={value ?? ""} onBlur={(e) => onChange(numIn(e.target.value))} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
    </L>
  );
}
function T({ label, value, onChange, disabled }: { label: string; value: string; onChange: (t: string) => void; disabled?: boolean }) {
  return <L label={label}><input key={value} className="input" disabled={disabled} defaultValue={value} onBlur={(e) => onChange(e.target.value.trim())} /></L>;
}
