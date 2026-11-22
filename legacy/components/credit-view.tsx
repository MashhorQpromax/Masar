import type { CreditAnalysis, CreditReport, Access } from "@/lib/simah";
import { typeLabel } from "@/lib/simah";
import { Badge, Callout, Fig, Fold, VerdictChip, sar } from "@/components/ui";
import { Icon } from "@/components/icon";
import { confirmCredit } from "@/app/actions";

const GRADE: Record<string, [string, string]> = { A: ["green", "check-circle"], B: ["green", "check-circle"], C: ["amber", "alert"], D: ["orange", "alert"], E: ["red", "x-circle"] };
const ACCESS: Record<Access, [string, string]> = { open: ["مفتوح", "green"], conditional: ["مشروط", "amber"], closed: ["مغلق", "red"] };
const ST: Record<string, [string, string]> = { current: ["منتظم", "green"], late: ["متأخر", "amber"], default: ["متعثر", "red"], settled: ["متعثر سُدد", "slate"], closed: ["مغلق", "slate"] };
const LVL: Record<string, string> = { block: "red", warn: "amber", info: "slate", good: "green" };

export default function CreditView({ clientId, reportId, r, a, createdAt, author, canEdit }: {
  clientId: number; reportId: number; r: CreditReport & { warnings?: string[]; confidence?: string }; a: CreditAnalysis; createdAt: string; author: string | null; canEdit: boolean;
}) {
  const live = r.facilities.filter((f) => f.status === "current" || f.status === "late");
  const defs = r.facilities.filter((f) => f.status === "default" || f.status === "settled");
  const closed = r.facilities.filter((f) => f.status === "closed");
  const j = r.judgments ?? [];
  const s = a.stats;
  return (
    <div className="space-y-4">
      <section className="card p-5 sm:p-7">
        <VerdictChip tone={GRADE[a.grade]?.[0] ?? "slate"} icon={GRADE[a.grade]?.[1] ?? "info"}>التصنيف {a.grade}</VerdictChip>
        <h2 className="mt-4 text-[22px] sm:text-2xl font-bold leading-snug">{a.gradeLabel}</h2>
        <p className="mt-2 text-[13px] text-slate-500">سمة <span className="num">{r.reportDate ?? ""}</span> · حُلل <span className="num">{createdAt.slice(0, 10)}</span>{author ? ` · ${author}` : ""} · دقة القراءة {r.confidence === "high" ? "عالية" : r.confidence === "medium" ? "متوسطة، راجع" : "منخفضة، راجع يدوياً"}</p>
        <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-5">
          <Fig label="إيقاف خدمات" value={r.serviceSuspension ? (r.suspensionAssumed ? "مرجّح" : "نعم") : "لا"} tone={r.serviceSuspension ? "text-rose-700" : "text-emerald-700"} />
          <Fig label="قرارات تنفيذ قائمة" value={s.activeJudgments} hint={s.activeJudgments ? <span className="num">{sar(s.activeJudgmentsAmount)}</span> : undefined} tone={s.activeJudgments ? "text-rose-700" : "text-ink"} />
          <Fig label="تعثرات قائمة" value={s.activeDefaults} hint={s.activeDefaults ? <span className="num">{sar(s.activeDefaultsAmount)}</span> : undefined} tone={s.activeDefaults ? "text-rose-700" : "text-ink"} />
          <Fig label="لتنظيف السجل" value={sar(s.totalToClear)} hint="تقريباً" />
        </div>
      </section>

      {(r.warnings?.length ?? 0) > 0 && <Callout tone="amber" title="راجع قبل الاعتماد"><ul className="list-disc ps-4">{r.warnings!.map((w, i) => <li key={i}>{w}</li>)}</ul></Callout>}
      {a.blockers.length > 0 && (
        <Callout tone="red" icon="ban" title={`${a.blockers.length} موانع قائمة`}>
          <ul className="mt-1 space-y-1.5">{a.blockers.map((b, i) => <li key={i} className="flex gap-2"><span className="mt-[11px] size-1 shrink-0 rounded-full bg-current opacity-50" />{b}</li>)}</ul>
        </Callout>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <h3 className="font-bold text-[15px] mb-3">من يقبل العميل الآن؟</h3>
          {([["البنوك", a.banks], ["شركات التمويل", a.financeCompanies]] as const).map(([l, x]) => (
            <div key={l} className="flex items-start justify-between gap-3 py-3 border-b last:border-0 border-slate-100">
              <div><div className="font-semibold text-sm">{l}</div><div className="text-[13px] text-slate-500 mt-0.5 leading-6">{x.reason}{x.reopenInMonths ? ` · تنفتح بعد نحو ${x.reopenInMonths} شهراً` : ""}</div></div>
              <Badge tone={ACCESS[x.access][1]} dot>{ACCESS[x.access][0]}</Badge>
            </div>
          ))}
        </div>
        <div className="card p-5">
          <h3 className="font-bold text-[15px] mb-3">خطة العمل</h3>
          <ol className="space-y-2.5 text-[13px] leading-6">{a.actions.map((x, i) => <li key={i} className="flex gap-3"><span className="size-5 shrink-0 mt-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px] font-bold grid place-items-center num">{i + 1}</span>{x}</li>)}</ol>
        </div>
      </div>

      {a.findings.length > 0 && (
        <Fold title="ملاحظات التحليل" icon="list" meta={<span className="num">{a.findings.length}</span>}>
          <ul className="space-y-2">{a.findings.map((f, i) => <li key={i}><Callout tone={LVL[f.level]}>{f.text}</Callout></li>)}</ul>
        </Fold>
      )}

      {j.length > 0 && (
        <Table title="قرارات محاكم التنفيذ" icon="scale" n={j.length} open head={["التاريخ", "المبلغ", "المتبقي", "الحالة", "على الأرجح لصالح"]}
          rows={j.map((x) => [x.date ?? "—", sar(x.amount), sar(x.remaining ?? x.amount), <Badge key="s" tone={x.active ? "red" : "slate"}>{x.state || (x.active ? "قائم" : "منتهٍ")}</Badge>, x.creditor ?? "—"])} />
      )}
      {defs.length > 0 && (
        <Table title="المنتجات المتعثرة" icon="alert" n={defs.length} open head={["الجهة", "النوع", "تصنيف الجهة", "الإدراج", "مبلغ التعثر", "المتبقي", "الحالة"]}
          rows={defs.map((f) => [f.lender, f.product, typeLabel(f.creditorType), f.defaultListedAt ?? "—", sar(f.defaultAmount), sar(f.defaultNow ?? (f.status === "settled" ? 0 : f.balance)), <Badge key="s" tone={f.status === "settled" ? "slate" : "red"}>{f.defaultState || ST[f.status][0]}</Badge>])} />
      )}
      {live.length > 0 && (
        <Table title="الالتزامات النشطة" icon="wallet" n={live.length} meta={<>أقساط <span className="num">{sar(s.monthlyInstallments)}</span> شهرياً</>} head={["الجهة", "النوع", "الحد", "المتبقي", "القسط", "ينتهي", "الحالة"]}
          rows={live.map((f) => [f.lender, f.product, sar(f.limit), sar(f.balance), sar(f.installment), f.endAt ?? "—", <Badge key="s" tone={ST[f.status][1]}>{ST[f.status][0]}{f.overdue ? ` · ${sar(f.overdue)}` : ""}</Badge>])} />
      )}
      {closed.length > 0 && (
        <Fold title="منتجات مغلقة" icon="check-circle" meta={<span className="num">{closed.length}</span>}>
          <ul className="text-[13px] text-slate-600 divide-y divide-slate-100">{closed.map((f, i) => <li key={i} className="py-2 flex flex-wrap gap-x-3">{f.lender}<span className="text-slate-400">{f.product}</span><span className="num ms-auto">{sar(f.limit)}</span><span className="num text-slate-400">{f.openedAt ?? ""}</span></li>)}</ul>
        </Fold>
      )}
      {(r.inquiries?.length ?? 0) > 0 && (
        <Fold title="الاستعلامات" icon="search" meta={<><span className="num">{s.inquiries6m}</span> في 6 أشهر</>}>
          <ul className="text-[13px] text-slate-600 divide-y divide-slate-100">{r.inquiries!.map((q, i) => <li key={i} className="py-2 flex flex-wrap gap-x-3"><span className="num text-slate-400">{q.date}</span>{q.lender}<span className="text-slate-400">{q.product}</span>{q.amount ? <span className="num ms-auto">{sar(q.amount)}</span> : null}</li>)}</ul>
        </Fold>
      )}

      {canEdit && (
        <Fold title="تحقق المحلل من أبشر أو ناجز" icon="edit">
          <form action={confirmCredit.bind(null, clientId, reportId)} className="space-y-3">
            <p className="text-[13px] text-slate-500">سمة لا تُظهر إيقاف الخدمات مباشرة. أكّده هنا ليُعاد الحساب.</p>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <label className="inline-flex items-center gap-2"><input type="radio" name="suspension" value="yes" className="accent-brand-700" defaultChecked={r.serviceSuspension && !r.suspensionAssumed} />يوجد إيقاف خدمات</label>
              <label className="inline-flex items-center gap-2"><input type="radio" name="suspension" value="no" className="accent-brand-700" defaultChecked={!r.serviceSuspension} />لا يوجد إيقاف</label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" name="travel_ban" className="accent-brand-700" defaultChecked={!!r.travelBan} />منع سفر</label>
            </div>
            <textarea name="note" className="input min-h-20" placeholder="ملاحظة، مثل: قبل الدائن تسوية بخصم 20%" defaultValue={r.notes ?? ""} />
            <button className="btn-primary">حفظ وإعادة الحساب</button>
          </form>
        </Fold>
      )}
    </div>
  );
}

function Table({ title, icon, n, meta, open, head, rows }: { title: string; icon: string; n: number; meta?: React.ReactNode; open?: boolean; head: string[]; rows: React.ReactNode[][] }) {
  return (
    <Fold title={title} icon={icon} open={open} meta={<>{meta}<span className="num">{n}</span></>}>
      <div className="overflow-x-auto -mx-5 -mb-5">
        <table className="w-full min-w-[680px]"><thead><tr>{head.map((h, i) => <th key={h} className={`th ${i === 0 ? "ps-5" : ""}`}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, k) => <td key={k} className={`td ${k === 0 ? "ps-5 font-medium" : ""} ${typeof c === "string" && /^[\d,.\-—\s]+$/.test(c) ? "num" : ""}`}>{c}</td>)}</tr>)}</tbody></table>
      </div>
    </Fold>
  );
}
