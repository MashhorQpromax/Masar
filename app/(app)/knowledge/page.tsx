import { all } from "@/lib/db";
import { requireUser, can } from "@/lib/auth";
import { lenderRules, lenderExperience } from "@/lib/data";
import { FINANCE_TYPE, OUTCOME_CONDITIONS, REJECT_REASONS, RULE_KIND, OUTCOME_DECISION, SECTOR } from "@/lib/labels";
import { Badge, PageHeader, Empty, sar, dateAr } from "@/components/ui";
import { addLenderRule, archiveLenderRule } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function Knowledge({ searchParams }: { searchParams: Promise<{ ft?: string }> }) {
  const u = await requireUser();
  const ft = (await searchParams).ft ?? "personal";
  const lenders = all<{ id: number; name: string }>("SELECT id, name FROM lenders WHERE active = 1 ORDER BY name");
  const rules = lenderRules();
  const exp = lenderExperience(ft);
  const recent = all<{ id: number; lender: string; decision: keyof typeof OUTCOME_DECISION; sector: keyof typeof SECTOR; salary: number | null; estimated_amount: number | null; approved_amount: number | null; conditions: string; reason: string | null; note: string | null; created_at: string; finance_type: keyof typeof FINANCE_TYPE }>(
    "SELECT o.*, l.name lender FROM outcomes o JOIN lenders l ON l.id = o.lender_id ORDER BY o.id DESC LIMIT 25",
  );
  const byLender = new Map<string, typeof rules>();
  for (const r of rules) {
    const k = r.lender_name ?? "عام — كل الجهات";
    byLender.set(k, [...(byLender.get(k) ?? []), r]);
  }
  const total = all<{ n: number }>("SELECT COUNT(*) n FROM outcomes")[0]?.n ?? 0;

  return (
    <>
      <PageHeader title="خبرة الجهات" sub="ما لا يُكتب في سياسات الجهات: الاشتراطات الفعلية، الاستثناءات، والطرق التي نجحت — تتراكم من نتائج الطلبات وملاحظات الفريق وتظهر تلقائياً في دراسة كل عميل." />

      <div className="grid lg:grid-cols-[1fr_380px] gap-6 items-start">
        <div className="space-y-6">
          <div className="card overflow-x-auto">
            <div className="p-5 pb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-bold">أداء الجهات من الواقع <span className="text-xs text-slate-400 font-normal">({total} نتيجة مسجلة)</span></h2>
              <div className="flex gap-1">{Object.entries(FINANCE_TYPE).map(([k, v]) => <a key={k} href={`?ft=${k}`} className={`btn-sm btn ${ft === k ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-600"}`}>{v}</a>)}</div>
            </div>
            {exp.size === 0 ? <div className="p-5 pt-0"><Empty>لا توجد نتائج مسجلة لهذا النوع بعد. سجّل نتيجة كل طلب من تبويب «الطلبات لدى الجهات» في ملف العميل.</Empty></div> : (
              <table className="w-full min-w-[760px]">
                <thead><tr>{["الجهة", "الطلبات", "نسبة القبول", "المعتمد ÷ تقديرنا", "أكثر ما تطلبه", "أسباب الرفض"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                <tbody>{[...exp.values()].sort((a, b) => b.n - a.n).map((e) => {
                  const pct = Math.round((e.approved / e.n) * 100);
                  return (
                    <tr key={e.lenderId} className="align-top">
                      <td className="td font-semibold">{lenders.find((l) => l.id === e.lenderId)?.name}</td>
                      <td className="td num">{e.n}</td>
                      <td className="td"><Badge tone={pct >= 70 ? "green" : pct >= 40 ? "amber" : "red"}>{pct}%</Badge></td>
                      <td className="td num">{e.ratio ? <span className={e.ratio < 0.95 ? "text-rose-700" : e.ratio > 1.05 ? "text-emerald-700" : ""}>{Math.round(e.ratio * 100)}%</span> : "—"}</td>
                      <td className="td"><div className="flex flex-wrap gap-1">{e.conditions.slice(0, 4).map(([k, n]) => <Badge key={k} tone="blue">{OUTCOME_CONDITIONS[k] ?? k} ×{n}</Badge>)}</div></td>
                      <td className="td"><div className="flex flex-wrap gap-1">{e.reasons.slice(0, 3).map(([k, n]) => <Badge key={k} tone="red">{REJECT_REASONS[k] ?? k} ×{n}</Badge>)}</div></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            )}
            <p className="px-5 py-3 text-xs text-slate-500 border-t border-slate-100">«المعتمد ÷ تقديرنا» أقل من 100% يعني أن الجهة تعطي فعلياً أقل من حسبتنا؛ تستخدمه الدراسة لتصحيح المبلغ المتوقع لكل عميل.</p>
          </div>

          {[...byLender.entries()].map(([name, list]) => (
            <div key={name} className="card">
              <div className="px-5 py-3 border-b border-slate-100 font-bold text-sm bg-slate-50/60">{name}</div>
              <ul>
                {list.map((r) => (
                  <li key={r.id} className="px-5 py-3 border-b border-slate-100 last:border-0 flex gap-3 items-start">
                    <span className="text-lg">{RULE_KIND[r.kind].emoji}</span>
                    <div className="flex-1">
                      <div className="font-semibold text-sm flex flex-wrap items-center gap-2">{r.title}<Badge tone={RULE_KIND[r.kind].tone}>{RULE_KIND[r.kind].label}</Badge>{r.finance_type && <Badge>{FINANCE_TYPE[r.finance_type as keyof typeof FINANCE_TYPE]}</Badge>}</div>
                      {r.body && <p className="text-sm text-slate-600 mt-1 leading-6">{r.body}</p>}
                      <div className="text-[11px] text-slate-400 mt-1">{r.author ?? "—"} · {dateAr(r.created_at)}</div>
                    </div>
                    {can(u, "lender.manage") && <form action={archiveLenderRule.bind(null, r.id)}><button className="text-xs text-slate-400 hover:text-rose-600">أرشفة</button></form>}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="card overflow-x-auto">
            <div className="p-5 pb-3 font-bold">آخر النتائج المسجلة</div>
            {recent.length === 0 ? <div className="p-5 pt-0"><Empty>لا توجد نتائج بعد.</Empty></div> : (
              <table className="w-full min-w-[760px]">
                <thead><tr>{["التاريخ", "الجهة", "النوع", "القطاع / الراتب", "القرار", "تقديرنا ← المعتمد", "الاشتراطات / السبب", "ملاحظة"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                <tbody>{recent.map((o) => (
                  <tr key={o.id} className="align-top">
                    <td className="td text-xs">{dateAr(o.created_at)}</td>
                    <td className="td font-semibold">{o.lender}</td>
                    <td className="td text-xs">{FINANCE_TYPE[o.finance_type]}</td>
                    <td className="td text-xs">{SECTOR[o.sector]} · <span className="num">{sar(o.salary)}</span></td>
                    <td className="td"><Badge tone={OUTCOME_DECISION[o.decision].tone}>{OUTCOME_DECISION[o.decision].label}</Badge></td>
                    <td className="td num text-xs">{sar(o.estimated_amount)} ← {sar(o.approved_amount)}</td>
                    <td className="td text-xs">{o.reason ? <span className="text-rose-700">{REJECT_REASONS[o.reason]}</span> : (JSON.parse(o.conditions) as string[]).map((k) => OUTCOME_CONDITIONS[k] ?? k).join("، ") || "—"}</td>
                    <td className="td text-xs max-w-56">{o.note}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>

        {can(u, "client.edit") && (
          <form action={addLenderRule} className="card p-5 space-y-3 lg:sticky lg:top-6">
            <h2 className="font-bold">أضف خبرة</h2>
            <p className="text-xs text-slate-500 leading-5">اشتراط غير مكتوب، استثناء حصلنا عليه، أو طريقة نجحت. ستظهر لكل عميل يطابق الجهة ونوع التمويل.</p>
            <div><label className="label">النوع</label><select name="kind" className="input">{Object.entries(RULE_KIND).map(([k, v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}</select></div>
            <div><label className="label">الجهة</label><select name="lender_id" className="input"><option value="">عام — كل الجهات</option>{lenders.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
            <div><label className="label">نوع التمويل</label><select name="finance_type" className="input"><option value="">كل الأنواع</option>{Object.entries(FINANCE_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className="label">العنوان</label><input name="title" className="input" required placeholder="مثال: يطلب تقرير طبي لمن فوق 55" /></div>
            <div><label className="label">التفاصيل</label><textarea name="body" rows={4} className="input" placeholder="متى ينطبق؟ ما الذي نجح؟ من الموظف المختص؟" /></div>
            <button className="btn-primary w-full">حفظ</button>
          </form>
        )}
      </div>
    </>
  );
}
