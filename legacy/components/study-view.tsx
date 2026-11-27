import { fmt, SAMA, type Match } from "@/lib/engine";
import type { DeepStudy, Alert } from "@/lib/advisor";
import type { Experience, LenderRule } from "@/lib/data";
import { ELIGIBILITY, OUTCOME_CONDITIONS, REJECT_REASONS, RULE_KIND } from "@/lib/labels";
import { Badge, Fold, Callout, Empty } from "@/components/ui";
import { Icon } from "@/components/icon";

const CHIP: Record<string, string> = { eligible: "bg-emerald-50 text-emerald-800", conditional: "bg-amber-50 text-amber-800", pending: "bg-slate-100 text-slate-600", not_eligible: "bg-rose-50 text-rose-800" };

export default function StudyView({ s, exp, rules, requested }: { s: DeepStudy; exp: Map<number, Experience>; rules: LenderRule[]; requested: number | null }) {
  const ok = s.matches.filter((m) => m.verdict !== "fail");
  const failed = s.matches.filter((m) => m.verdict === "fail");
  const best = ok[0];
  const cap = s.capacity;
  const capPct = Math.round((cap.capUsed || 0) * 100);
  const afterDbr = cap.income > 0 && best ? Math.round(((cap.existingTotal + best.installment) / cap.income) * 1000) / 10 : cap.currentDbr;
  const generalRules = rules.filter((r) => r.lender_id == null);
  const el = ELIGIBILITY[s.verdict];
  const blocking = s.alerts.filter((a) => a.level === "block").length;

  const conds = [
    ...s.alerts.map((a) => <AlertItem key={a.id} a={a} />),
    ...generalRules.map((r) => (
      <li key={`r${r.id}`} className="flex gap-3 rounded-xl border border-slate-200/70 p-4">
        <Icon name={RULE_KIND[r.kind].icon} className="size-[18px] mt-0.5 text-brand-700" />
        <div className="flex-1 min-w-0"><div className="text-sm font-semibold flex flex-wrap items-center gap-2">{r.title}<Badge tone="brand">خبرة الفريق</Badge></div>{r.body && <p className="text-[13px] text-slate-600 mt-1 leading-6">{r.body}</p>}</div>
      </li>
    )),
  ];

  return (
    <div className="space-y-4">
      <section className="card p-5 sm:p-7">
        <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 h-7 text-xs font-bold ${CHIP[s.verdict]}`}><Icon name={el.icon} className="size-4" strokeWidth={2} />{el.label}</span>
        <h2 className="mt-4 text-[22px] sm:text-2xl font-bold leading-snug max-w-3xl">{s.headline}</h2>
        {best && <p className="mt-2 text-sm text-slate-500">الأنسب: <b className="text-ink">{best.product.lenderName}</b> · {best.product.name}</p>}
        <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-5">
          <Fig label="أعلى مبلغ ممكن" v={fmt(s.baseAmount)} hint={requested ? `${Math.min(100, Math.round((s.baseAmount / requested) * 100))}% من المطلوب` : undefined} tone="text-brand-700" />
          <Fig label="القسط المتاح" v={fmt(cap.available)} hint="شهرياً" />
          <Fig label="النسبة الفعلية" v={best ? `${best.apr}%` : "—"} hint={best ? `${best.product.rate}% ${best.product.rateType === "flat" ? "ثابتة معلنة" : "متناقصة"}` : undefined} />
          <Fig label="الاستقطاع بعد التمويل" v={`${afterDbr}%`} hint={`السقف ${capPct}%`} />
        </div>
        <DbrBar current={cap.currentDbr} after={afterDbr} cap={capPct} />
      </section>

      <section>
        <h3 className="font-bold text-[15px] mb-3 flex items-center gap-2">الجهات المناسبة<span className="num text-xs font-medium text-slate-400">{ok.length}</span></h3>
        {ok.length === 0 ? <div className="card"><Empty art="search" title="لا جهة مؤهلة بهذه المعطيات">راجع المخارج بالأسفل.</Empty></div> : (
          <div className="card overflow-hidden">
            {ok.map((m, i) => <LenderRow key={m.product.id} m={m} rank={i + 1} exp={exp.get(Number(m.product.lenderId))} rules={rules.filter((r) => String(r.lender_id) === m.product.lenderId)} />)}
          </div>
        )}
      </section>

      {s.scenarios.length > 0 && (
        <Fold title="مخارج لرفع المبلغ" icon="trend" meta={<span className="num">{s.scenarios.length}</span>}>
          <ul className="grid md:grid-cols-2 gap-3">
            {s.scenarios.map((x) => (
              <li key={x.key} className="rounded-xl border border-slate-200/70 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-sm leading-6">{x.title}</div>
                  <Badge tone={x.effort === "سهل" ? "green" : x.effort === "متوسط" ? "amber" : "red"}>{x.effort}</Badge>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="figure text-2xl font-semibold text-brand-700">{fmt(x.amount)}</span>
                  {x.gain > 0 && <span className="text-xs font-bold text-emerald-700 num">+{fmt(x.gain)}</span>}
                  {x.verdictAfter !== s.verdict && <Badge tone={ELIGIBILITY[x.verdictAfter].tone}>{ELIGIBILITY[x.verdictAfter].label}</Badge>}
                </div>
                <p className="text-[13px] text-slate-600 mt-2 leading-6">{x.detail}</p>
                <details className="mt-2 group"><summary className="cursor-pointer list-none text-xs font-semibold text-slate-500 hover:text-ink inline-flex items-center gap-1"><Icon name="chevron-down" className="size-3.5 transition-transform group-open:rotate-180" />الخطوات</summary>
                  <ol className="mt-2 text-xs text-slate-600 space-y-1 list-decimal ps-4 leading-5">{x.steps.map((st, i) => <li key={i}>{st}</li>)}</ol>
                </details>
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {(s.alerts.length > 0 || generalRules.length > 0) && (
        <Fold title="اشتراطات قد تُطلب" icon="shield" open={blocking > 0} meta={<>{blocking > 0 && <Badge tone="red">{blocking} مانع</Badge>}<span className="num">{s.alerts.length + generalRules.length}</span></>}>
          <ul className="space-y-2">{conds.slice(0, 3)}</ul>
          {conds.length > 3 && (
            <details className="group mt-3">
              <summary className="cursor-pointer list-none text-[13px] font-semibold text-slate-500 hover:text-ink inline-flex items-center gap-1.5"><Icon name="chevron-down" className="size-4 transition-transform group-open:rotate-180" />الباقي <span className="num">{conds.length - 3}</span></summary>
              <ul className="space-y-2 mt-3">{conds.slice(3)}</ul>
            </details>
          )}
        </Fold>
      )}

      <Fold title="كيف حُسبت؟" icon="calc">
        <dl className="grid sm:grid-cols-2 lg:grid-cols-5 gap-x-6 gap-y-4">
          <Mini label="الدخل المعتمد" v={fmt(cap.income)} unit={cap.incomeBasis} />
          <Mini label="التزامات غير عقارية" v={fmt(cap.existingNonRealEstate)} unit="شهرياً" />
          <Mini label="التزامات عقارية" v={fmt(cap.existingMortgage)} unit="شهرياً" />
          <Mini label="سقف الأقساط" v={fmt(cap.maxInstallment)} unit={cap.bindingRule} />
          <Mini label="القسط الجديد المتاح" v={fmt(cap.available)} unit="شهرياً" tone />
        </dl>
        {cap.warnings.length > 0 && <div className="mt-4"><Callout tone="amber">{cap.warnings.join(" · ")}</Callout></div>}
        <p className="mt-4 text-[11px] text-slate-400 leading-5">{SAMA.source}</p>
      </Fold>

      {failed.length > 0 && (
        <Fold title="جهات غير مناسبة حالياً" icon="ban" meta={<span className="num">{failed.length}</span>}>
          <ul className="text-[13px] divide-y divide-slate-100">
            {failed.map((m) => (
              <li key={m.product.id} className="py-2.5 grid sm:grid-cols-[180px_1fr] gap-x-4 gap-y-1">
                <div><b>{m.product.lenderName}</b><div className="text-xs text-slate-500">{m.product.name}</div></div>
                <div className="text-rose-700 leading-6">{m.checks.filter((c) => c.status === "fail").map((c) => `${c.label}: ${c.detail}`).join(" · ")}</div>
              </li>
            ))}
          </ul>
        </Fold>
      )}
      <p className="text-xs text-slate-400">دراسة مبدئية وليست عرضاً ملزماً. معايير الجهات تقديرية حتى يتحقق منها فريق الائتمان.</p>
    </div>
  );
}

function LenderRow({ m, rank, exp, rules }: { m: Match; rank: number; exp?: Experience; rules: LenderRule[] }) {
  const realistic = exp?.ratio ? Math.floor((m.offerPrincipal * Math.min(1.2, exp.ratio)) / 1000) * 1000 : null;
  const issues = m.checks.filter((c) => c.status !== "pass");
  return (
    <details className="group border-b border-slate-100 last:border-0">
      <summary className="list-none cursor-pointer grid grid-cols-[auto_1fr_auto] md:grid-cols-[auto_minmax(0,1.6fr)_repeat(3,minmax(0,.8fr))_auto_auto] items-center gap-x-5 gap-y-2 px-5 py-4 hover:bg-slate-50/70 transition-colors">
        <span className={`size-7 rounded-lg grid place-items-center text-xs font-bold font-display ${rank === 1 ? "bg-brand-800 text-gold-soft" : "bg-slate-100 text-slate-500"}`}>{rank}</span>
        <div className="min-w-0"><div className="font-semibold text-sm truncate">{m.product.lenderName}</div><div className="text-xs text-slate-500 truncate">{m.product.name}</div></div>
        <Num label="المبلغ" v={fmt(m.offerPrincipal)} strong />
        <Num label="القسط" v={fmt(m.installment)} cls="hidden md:block" />
        <Num label="النسبة الفعلية" v={`${m.apr}%`} cls="hidden md:block" />
        <span className="hidden md:block"><Badge tone={m.verdict === "pass" ? "green" : "amber"}>{m.verdict === "pass" ? "مؤهل" : "بشروط"}</Badge></span>
        <Icon name="chevron-down" className="hidden md:block size-4 text-slate-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-5 pb-5 pt-1 space-y-4">
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 text-[13px]">
          <Pair k="المدة" v={`${m.tenor} شهراً`} />
          <Pair k="إجمالي الأرباح" v={fmt(m.totalProfit)} />
          <Pair k="رسوم إدارية" v={fmt(m.fee)} />
          <Pair k="الحد الأعلى" v={fmt(m.maxPrincipal)} sub={`محدود بـ ${m.limitedBy}`} />
          {m.retirement && m.retirement.after < m.installment && <Pair k="القسط بعد التقاعد" v={fmt(m.retirement.after)} />}
          {m.ltv && <Pair k="التمويل إلى القيمة" v={`${m.ltv.pct}%`} sub={m.ltv.down != null ? `دفعة أولى ${fmt(m.ltv.down)}` : undefined} />}
          {m.settle12 && <Pair k="سداد مبكر بعد سنة" v={fmt(m.settle12.balance)} sub={`تعويض حتى ${fmt(m.settle12.fee)}`} />}
          {realistic != null && <Pair k="المتوقع من الواقع" v={fmt(realistic)} sub={`الجهة تعتمد ${Math.round((exp!.ratio ?? 1) * 100)}% من تقديرنا`} tone />}
        </dl>
        {exp && exp.n > 0 && (
          <div className="rounded-xl bg-slate-50 p-3.5 text-[13px] leading-6">
            <span className="font-semibold">سجل الفريق:</span> <span className="num">{exp.approved}</span> قبول من <span className="num">{exp.n}</span>{exp.similarN > 0 && exp.similarN !== exp.n ? <> · حالات مشابهة <span className="num">{exp.similarApproved}/{exp.similarN}</span></> : null}
            {(exp.conditions.length > 0 || exp.reasons.length > 0) && <div className="mt-2 flex flex-wrap gap-1.5">{exp.conditions.slice(0, 4).map(([k, n]) => <Badge key={k} tone="blue">{OUTCOME_CONDITIONS[k] ?? k} ×{n}</Badge>)}{exp.reasons.slice(0, 3).map(([k, n]) => <Badge key={k} tone="red">{REJECT_REASONS[k] ?? k} ×{n}</Badge>)}</div>}
          </div>
        )}
        {rules.length > 0 && <ul className="space-y-1.5 text-[13px]">{rules.map((r) => <li key={r.id} className="flex gap-2 leading-6"><Icon name={RULE_KIND[r.kind].icon} className="size-4 mt-1 text-brand-700" /><span><b>{r.title}</b>{r.body ? `: ${r.body}` : ""}</span></li>)}</ul>}
        <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
          {(issues.length ? [...issues, ...m.checks.filter((c) => c.status === "pass")] : m.checks).map((ch) => (
            <li key={ch.key} className="flex gap-2 leading-5"><Icon name={ch.status === "pass" ? "check" : ch.status === "warn" ? "alert" : "x"} className={`size-3.5 mt-0.5 ${ch.status === "pass" ? "text-emerald-600" : ch.status === "warn" ? "text-amber-600" : "text-rose-600"}`} strokeWidth={2.2} /><span className="text-slate-600"><b className="text-ink">{ch.label}:</b> {ch.detail}</span></li>
          ))}
        </ul>
      </div>
    </details>
  );
}

function AlertItem({ a }: { a: Alert }) {
  return (
    <li className={`flex gap-3 rounded-xl p-4 ${a.level === "block" ? "bg-rose-50" : a.level === "warn" ? "bg-amber-50" : "border border-slate-200/70"}`}>
      <Icon name={a.level === "block" ? "ban" : a.level === "warn" ? "alert" : "info"} className={`size-[18px] mt-0.5 ${a.level === "block" ? "text-rose-700" : a.level === "warn" ? "text-amber-700" : "text-slate-400"}`} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{a.title}</div>
        <p className="text-[13px] text-slate-600 mt-1 leading-6">{a.detail}</p>
        {a.exit && <p className="text-[13px] mt-1.5 leading-6"><b className="text-emerald-700">المخرج:</b> {a.exit}</p>}
        <div className="text-[11px] text-slate-400 mt-1.5">{a.source}</div>
      </div>
    </li>
  );
}

function DbrBar({ current, after, cap }: { current: number; after: number; cap: number }) {
  const W = (x: number) => `${Math.min(100, Math.max(0, x))}%`;
  return (
    <div className="mt-7">
      <div className="relative h-2.5 rounded-full bg-slate-100">
        <div className="absolute inset-y-0 start-0 rounded-full bg-brand-200 origin-right grow-x" style={{ width: W(after) }} />
        <div className="absolute inset-y-0 start-0 rounded-full bg-brand-700 origin-right grow-x" style={{ width: W(current) }} />
        <div className="absolute -inset-y-1 w-0.5 rounded-full bg-gold" style={{ insetInlineStart: W(cap) }} />
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500 mt-2.5">
        <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full bg-brand-700" />الاستقطاع الحالي <b className="num text-ink">{current}%</b></span>
        <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full bg-brand-200" />بعد التمويل <b className="num text-ink">{after}%</b></span>
        <span className="inline-flex items-center gap-1.5"><i className="h-3 w-0.5 rounded-full bg-gold" />السقف <b className="num text-ink">{cap}%</b></span>
      </div>
    </div>
  );
}

function Fig({ label, v, hint, tone = "text-ink" }: { label: string; v: string; hint?: string; tone?: string }) {
  return <div className="min-w-0"><div className="eyebrow">{label}</div><div className={`figure text-[26px] sm:text-[28px] font-semibold leading-none mt-1.5 ${tone}`}>{v}</div>{hint && <div className="text-xs text-slate-500 mt-1.5">{hint}</div>}</div>;
}
function Mini({ label, v, unit, tone }: { label: string; v: string; unit?: string; tone?: boolean }) {
  return <div><dt className="text-xs text-slate-500">{label}</dt><dd className={`figure text-xl font-semibold mt-1 ${tone ? "text-brand-700" : ""}`}>{v}</dd>{unit && <div className="text-[11px] text-slate-400 mt-0.5 leading-4">{unit}</div>}</div>;
}
function Num({ label, v, strong, cls = "" }: { label: string; v: string; strong?: boolean; cls?: string }) {
  return <div className={`min-w-0 ${cls}`}><div className="text-[11px] text-slate-500">{label}</div><div className={`num font-semibold ${strong ? "text-[15px] text-brand-800" : "text-sm"}`}>{v}</div></div>;
}
function Pair({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: boolean }) {
  return <div><dt className="text-xs text-slate-500">{k}</dt><dd className={`num font-semibold mt-0.5 ${tone ? "text-brand-700" : ""}`}>{v}</dd>{sub && <div className="text-[11px] text-slate-400 leading-4">{sub}</div>}</div>;
}
