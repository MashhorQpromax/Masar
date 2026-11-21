import { fmt, SAMA, type Match } from "@/lib/engine";
import type { DeepStudy, Alert } from "@/lib/advisor";
import type { Experience, LenderRule } from "@/lib/data";
import { ELIGIBILITY, OUTCOME_CONDITIONS, REJECT_REASONS, RULE_KIND } from "@/lib/labels";
import { Badge } from "@/components/ui";

const VERDICT_BG: Record<string, string> = {
  eligible: "from-emerald-700 to-emerald-900",
  conditional: "from-amber-600 to-amber-800",
  pending: "from-slate-600 to-slate-800",
  not_eligible: "from-rose-700 to-rose-900",
};

export default function StudyView({ s, exp, rules, requested }: { s: DeepStudy; exp: Map<number, Experience>; rules: LenderRule[]; requested: number | null }) {
  const ok = s.matches.filter((m) => m.verdict !== "fail");
  const failed = s.matches.filter((m) => m.verdict === "fail");
  const best = ok[0];
  const cap = s.capacity;
  const capPct = Math.round((cap.capUsed || 0) * 100);
  const afterDbr = cap.income > 0 && best ? Math.round(((cap.existingTotal + best.installment) / cap.income) * 1000) / 10 : cap.currentDbr;
  const generalRules = rules.filter((r) => r.lender_id == null);

  return (
    <div className="space-y-5">
      {/* ===== الحكم ===== */}
      <div className={`rounded-3xl bg-gradient-to-l ${VERDICT_BG[s.verdict]} text-white p-6 shadow-sm relative overflow-hidden`}>
        <div className="absolute -left-10 -top-10 size-48 rounded-full bg-white/5" />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-60">
            <div className="text-xs text-white/70">حكم الدراسة</div>
            <div className="text-2xl font-bold mt-1">{ELIGIBILITY[s.verdict].emoji} {s.headline}</div>
            {best && <div className="mt-2 text-sm text-white/85">الأنسب: <b>{best.product.lenderName}</b> — {best.product.name}</div>}
            {requested ? <div className="mt-1 text-xs text-white/70">المطلوب <span className="num">{fmt(requested)}</span> ريال · الممكن <span className="num">{fmt(s.baseAmount)}</span> ({requested ? Math.min(100, Math.round((s.baseAmount / requested) * 100)) : 0}%)</div> : null}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1 max-w-3xl">
            <Hero label="أعلى مبلغ ممكن" v={fmt(s.baseAmount)} u="ريال" />
            <Hero label="القسط المتاح" v={fmt(cap.available)} u="ريال / شهر" />
            <Hero label="النسبة الفعلية (APR)" v={best ? `${best.apr}%` : "—"} u={best ? `${best.product.rate}% ${best.product.rateType === "flat" ? "ثابتة معلنة" : "متناقصة"}` : ""} />
            <Hero label="الاستقطاع بعد التمويل" v={`${afterDbr}%`} u={`من ${capPct}% مسموح`} />
          </div>
        </div>
      </div>

      {/* ===== الحسبة ===== */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h3 className="font-bold">كيف حُسبت؟</h3>
          <span className="text-[11px] text-slate-400 max-w-xl leading-4">{SAMA.source}</span>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <Big label="الدخل المعتمد" v={fmt(cap.income)} unit={cap.incomeBasis} />
          <Big label="التزامات غير عقارية" v={fmt(cap.existingNonRealEstate)} unit="ريال شهرياً" />
          <Big label="التزامات عقارية" v={fmt(cap.existingMortgage)} unit="ريال شهرياً" />
          <Big label="سقف الأقساط" v={fmt(cap.maxInstallment)} unit={cap.bindingRule} />
          <Big label="القسط الجديد المتاح" v={fmt(cap.available)} unit="ريال شهرياً" tone="brand" />
        </div>
        <DbrBar current={cap.currentDbr} after={afterDbr} cap={capPct} />
        {cap.warnings.length > 0 && <div className="mt-3 text-xs text-amber-800 bg-amber-50 rounded-xl px-3 py-2">{cap.warnings.join(" · ")}</div>}
      </div>

      {/* ===== الاشتراطات الخفية ===== */}
      {s.alerts.length > 0 && (
        <div className="card p-5">
          <h3 className="font-bold">ما لا تُظهره الحسبة — اشتراطات قد تُطلب</h3>
          <p className="text-xs text-slate-500 mt-1 mb-4">تنبيهات مبنية على الأنظمة وممارسة السوق وخبرة الفريق. راجعها مع العميل قبل التقديم.</p>
          <div className="grid md:grid-cols-2 gap-3">
            {s.alerts.map((a) => <AlertCard key={a.id} a={a} />)}
            {generalRules.map((r) => (
              <div key={`r${r.id}`} className="rounded-2xl ring-1 ring-brand-200 bg-brand-50/40 p-4">
                <div className="flex items-center gap-2 text-sm font-bold">{RULE_KIND[r.kind].emoji} {r.title}<Badge tone="brand">خبرة الفريق</Badge></div>
                {r.body && <p className="text-sm text-slate-600 mt-1.5 leading-6">{r.body}</p>}
                <div className="text-[11px] text-slate-400 mt-2">{r.author}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== المخارج ===== */}
      <div className="card p-5">
        <h3 className="font-bold">المخارج — كيف نرفع المبلغ أو نحوّل الرفض لقبول</h3>
        <p className="text-xs text-slate-500 mt-1 mb-4">كل مخرج أُعيد حسابه فعلياً على المحرك بنفس معايير الجهات.</p>
        {s.scenarios.length === 0 ? (
          <p className="text-sm text-slate-500">لا توجد مخارج ترفع المبلغ حالياً — الوضع الحالي هو الأفضل بالمعطيات المدخلة.</p>
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {s.scenarios.map((x) => (
              <div key={x.key} className="rounded-2xl ring-1 ring-slate-200 p-4 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-bold text-sm leading-6">{x.title}</div>
                  <Badge tone={x.effort === "سهل" ? "green" : x.effort === "متوسط" ? "amber" : "red"}>{x.effort}</Badge>
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-2xl font-bold num text-brand-700">{fmt(x.amount)}</span>
                  {x.gain > 0 && <span className="text-xs font-bold text-emerald-700 num">+{fmt(x.gain)}</span>}
                  {x.verdictAfter !== s.verdict && <Badge tone={ELIGIBILITY[x.verdictAfter].tone}>{ELIGIBILITY[x.verdictAfter].label}</Badge>}
                </div>
                <p className="text-xs text-slate-600 mt-2 leading-5 flex-1">{x.detail}</p>
                <ol className="mt-3 text-[11px] text-slate-500 space-y-0.5 list-decimal ps-4">{x.steps.map((st, i) => <li key={i}>{st}</li>)}</ol>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== الجهات ===== */}
      <div>
        <div className="flex items-end justify-between mb-3">
          <h3 className="font-bold">الجهات المناسبة ({ok.length})</h3>
          <span className="text-xs text-slate-500">مرتبة حسب الملاءمة والتكلفة</span>
        </div>
        {ok.length === 0 && <div className="card p-5 text-sm text-slate-500">لا توجد جهة مؤهلة بالمعطيات الحالية — راجع المخارج أعلاه.</div>}
        <div className="grid lg:grid-cols-2 gap-4">
          {ok.map((m, i) => <LenderCard key={m.product.id} m={m} rank={i + 1} exp={exp.get(Number(m.product.lenderId))} rules={rules.filter((r) => String(r.lender_id) === m.product.lenderId)} />)}
        </div>
        {failed.length > 0 && (
          <details className="card mt-4">
            <summary className="p-4 cursor-pointer text-sm font-semibold select-none">جهات غير مناسبة حالياً ({failed.length}) — لماذا؟</summary>
            <ul className="px-4 pb-4 space-y-2 text-sm">
              {failed.map((m) => (
                <li key={m.product.id} className="flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 pt-2">
                  <b className="min-w-40">{m.product.lenderName}</b>
                  <span className="text-slate-500 text-xs">{m.product.name}</span>
                  <span className="text-rose-700 text-xs">{m.checks.filter((c) => c.status === "fail").map((c) => `${c.label}: ${c.detail}`).join(" · ")}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="text-xs text-slate-500 mt-3">⚠️ معايير الجهات تقديرية حتى يتحقق منها فريق الائتمان. الأرقام دراسة مبدئية وليست عرضاً ملزماً.</p>
      </div>
    </div>
  );
}

function LenderCard({ m, rank, exp, rules }: { m: Match; rank: number; exp?: Experience; rules: LenderRule[] }) {
  const realistic = exp?.ratio ? Math.floor((m.offerPrincipal * Math.min(1.2, exp.ratio)) / 1000) * 1000 : null;
  const issues = m.checks.filter((c) => c.status !== "pass");
  return (
    <div className={`card p-5 ${rank === 1 ? "ring-2 ring-brand-500/40" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`size-6 rounded-lg grid place-items-center text-xs font-bold ${rank === 1 ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-600"}`}>{rank}</span>
            <span className="font-bold">{m.product.lenderName}</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">{m.product.name} · {m.product.lenderType === "bank" ? "بنك" : "شركة تمويل"}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone={m.verdict === "pass" ? "green" : "amber"}>{m.verdict === "pass" ? "مؤهل" : "مؤهل بشروط"}</Badge>
          <span className="text-[11px] text-slate-400 num">ملاءمة {m.score}</span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Cell label="المبلغ المقترح" v={fmt(m.offerPrincipal)} strong />
        <Cell label="القسط" v={fmt(m.installment)} sub={m.retirement && m.retirement.after < m.installment ? `ثم ${fmt(m.retirement.after)} بعد التقاعد` : undefined} />
        <Cell label="المدة" v={`${m.tenor}`} sub={`شهر (${Math.round((m.tenor / 12) * 10) / 10} سنة)`} />
        <Cell label="النسبة الفعلية" v={`${m.apr}%`} sub={`${m.product.rate}% ${m.product.rateType === "flat" ? "ثابتة" : "متناقصة"}`} />
        <Cell label="إجمالي الأرباح" v={fmt(m.totalProfit)} />
        <Cell label="رسوم إدارية" v={fmt(m.fee)} />
      </div>

      <div className="mt-3 text-xs text-slate-600 space-y-1 leading-5">
        <div>الحد الأعلى لهذه الجهة <b className="num">{fmt(m.maxPrincipal)}</b> — محدود بـ {m.limitedBy}.</div>
        {m.ltv && <div>🏠 تمويل حتى {m.ltv.pct}% {m.ltv.down != null ? <>— دفعة أولى ≈ <b className="num">{fmt(m.ltv.down)}</b></> : null}</div>}
        {m.settle12 && <div>↩︎ السداد المبكر بعد سنة: رصيد <span className="num">{fmt(m.settle12.balance)}</span> + تعويض بحد أقصى <span className="num">{fmt(m.settle12.fee)}</span> (أرباح 3 أشهر — ساما)</div>}
        {realistic != null && <div className="text-brand-800">📊 من الواقع: الجهة اعتمدت في المتوسط <b className="num">{Math.round((exp!.ratio ?? 1) * 100)}%</b> من تقديرنا ← المتوقع فعلياً ≈ <b className="num">{fmt(realistic)}</b></div>}
      </div>

      {exp && exp.n > 0 && (
        <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs leading-5">
          <div className="font-bold text-slate-700">سجل الفريق مع هذه الجهة</div>
          <div className="text-slate-600 mt-0.5"><span className="num">{exp.approved}</span> قبول من <span className="num">{exp.n}</span> طلب{exp.similarN > 0 && exp.similarN !== exp.n ? <> · حالات مشابهة: <span className="num">{exp.similarApproved}/{exp.similarN}</span></> : null}</div>
          {exp.conditions.length > 0 && <div className="mt-1">طلبت سابقاً: {exp.conditions.slice(0, 4).map(([k, n]) => <span key={k} className="inline-block me-1 mb-1"><Badge tone="blue">{OUTCOME_CONDITIONS[k] ?? k} ×{n}</Badge></span>)}</div>}
          {exp.reasons.length > 0 && <div className="mt-1">أسباب رفض سابقة: {exp.reasons.slice(0, 3).map(([k, n]) => <span key={k} className="inline-block me-1"><Badge tone="red">{REJECT_REASONS[k] ?? k} ×{n}</Badge></span>)}</div>}
        </div>
      )}

      {rules.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-xs">
          {rules.map((r) => <li key={r.id} className="flex gap-1.5 leading-5"><span>{RULE_KIND[r.kind].emoji}</span><span><b>{r.title}</b>{r.body ? ` — ${r.body}` : ""}</span></li>)}
        </ul>
      )}

      <details className="mt-3">
        <summary className="text-xs text-brand-700 font-semibold cursor-pointer select-none">{issues.length ? `${issues.length} ملاحظات على المعايير` : "كل المعايير مستوفاة"} · التفاصيل</summary>
        <ul className="mt-2 space-y-1 text-xs">{m.checks.map((ch) => <li key={ch.key} className="flex gap-1.5"><span>{ch.status === "pass" ? "✅" : ch.status === "warn" ? "⚠️" : "❌"}</span><span><b>{ch.label}:</b> {ch.detail}</span></li>)}</ul>
      </details>
    </div>
  );
}

function AlertCard({ a }: { a: Alert }) {
  const tone = a.level === "block" ? "ring-rose-200 bg-rose-50/60" : a.level === "warn" ? "ring-amber-200 bg-amber-50/60" : "ring-slate-200 bg-white";
  return (
    <div className={`rounded-2xl ring-1 p-4 ${tone}`}>
      <div className="flex items-center gap-2 text-sm font-bold">{a.level === "block" ? "⛔" : a.level === "warn" ? "⚠️" : "ℹ️"} {a.title}</div>
      <p className="text-sm text-slate-600 mt-1.5 leading-6">{a.detail}</p>
      {a.exit && <p className="text-sm mt-2 leading-6"><b className="text-emerald-700">المخرج:</b> {a.exit}</p>}
      <div className="text-[11px] text-slate-400 mt-2">المصدر: {a.source}</div>
    </div>
  );
}

function DbrBar({ current, after, cap }: { current: number; after: number; cap: number }) {
  const W = (x: number) => `${Math.min(100, Math.max(0, x))}%`;
  return (
    <div className="mt-5">
      <div className="flex justify-between text-[11px] text-slate-500 mb-1.5"><span>نسبة الاستقطاع من الدخل</span><span className="num">0% — 100%</span></div>
      <div className="relative h-3 rounded-full bg-slate-100 overflow-hidden">
        <div className="absolute inset-y-0 start-0 bg-brand-200" style={{ width: W(after) }} />
        <div className="absolute inset-y-0 start-0 bg-brand-600" style={{ width: W(current) }} />
        <div className="absolute inset-y-0 w-0.5 bg-rose-500" style={{ insetInlineStart: W(cap) }} />
      </div>
      <div className="flex flex-wrap gap-4 text-[11px] text-slate-500 mt-1.5">
        <span><i className="inline-block size-2 rounded-full bg-brand-600 me-1" />الحالي <span className="num">{current}%</span></span>
        <span><i className="inline-block size-2 rounded-full bg-brand-200 me-1" />بعد التمويل <span className="num">{after}%</span></span>
        <span><i className="inline-block size-2 rounded-full bg-rose-500 me-1" />السقف <span className="num">{cap}%</span></span>
      </div>
    </div>
  );
}

function Hero({ label, v, u }: { label: string; v: string; u?: string }) {
  return (
    <div className="rounded-2xl bg-white/10 ring-1 ring-white/15 p-3">
      <div className="text-[11px] text-white/70">{label}</div>
      <div className="text-xl font-bold num text-start mt-0.5">{v}</div>
      {u && <div className="text-[10px] text-white/60 mt-0.5 leading-4">{u}</div>}
    </div>
  );
}
function Big({ label, v, unit, tone }: { label: string; v: string; unit?: string; tone?: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl font-bold num text-start mt-1 ${tone === "brand" ? "text-brand-700" : ""}`}>{v}</div>
      {unit && <div className="text-[11px] text-slate-400 mt-0.5 leading-4">{unit}</div>}
    </div>
  );
}
function Cell({ label, v, sub, strong }: { label: string; v: string; sub?: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl p-2.5 ${strong ? "bg-brand-50" : "bg-slate-50"}`}>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`num text-start font-bold ${strong ? "text-brand-800 text-lg" : ""}`}>{v}</div>
      {sub && <div className="text-[10px] text-slate-400 leading-4">{sub}</div>}
    </div>
  );
}
