import Link from "next/link";
import { all } from "@/lib/db";
import { requireUser, can } from "@/lib/auth";
import { lenderRules, lenderExperience } from "@/lib/data";
import { FINANCE_TYPE, OUTCOME_CONDITIONS, REJECT_REASONS, RULE_KIND, OUTCOME_DECISION, SECTOR } from "@/lib/labels";
import { Badge, Fold, PageHeader, Empty, sar, dateAr } from "@/components/ui";
import { Icon } from "@/components/icon";
import { LenderTabs } from "@/components/lender-tabs";
import { addLenderRule, archiveLenderRule } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function Knowledge({ searchParams }: { searchParams: Promise<{ ft?: string }> }) {
  const u = await requireUser();
  const ft = (await searchParams).ft ?? "personal";
  const lenders = await all<{ id: number; name: string }>("SELECT id, name FROM lenders WHERE active = 1 ORDER BY name");
  const rules = await lenderRules();
  const exp = await lenderExperience(ft);
  const recent = await all<{ id: number; lender: string; decision: keyof typeof OUTCOME_DECISION; sector: keyof typeof SECTOR; salary: number | null; estimated_amount: number | null; approved_amount: number | null; conditions: string; reason: string | null; note: string | null; created_at: string; finance_type: keyof typeof FINANCE_TYPE }>(
    "SELECT o.*, l.name lender FROM outcomes o JOIN lenders l ON l.id = o.lender_id ORDER BY o.id DESC LIMIT 25",
  );
  const byLender = new Map<string, typeof rules>();
  for (const r of rules) {
    const k = r.lender_name ?? "كل الجهات";
    byLender.set(k, [...(byLender.get(k) ?? []), r]);
  }
  const total = (await all<{ n: number }>("SELECT COUNT(*) n FROM outcomes"))[0]?.n ?? 0;

  return (
    <>
      <PageHeader title="الجهات" sub={<><span className="num">{rules.length}</span> خبرة · <span className="num">{total}</span> نتيجة مسجلة</>} actions={<LenderTabs at="knowledge" />} />

      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
        <div className="space-y-5 stagger">
          <section className="card overflow-hidden">
            <div className="px-5 pt-5 pb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[15px] font-bold">القبول الفعلي</h2>
              <div className="seg !p-0.5 overflow-x-auto max-w-full">{Object.entries(FINANCE_TYPE).map(([k, v]) => <Link key={k} href={`?ft=${k}`} className={`seg-item !h-7 !px-3 !text-xs ${ft === k ? "seg-on" : ""}`}>{v}</Link>)}</div>
            </div>
            {exp.size === 0 ? <Empty art="search" title="لا نتائج لهذا النوع بعد">تُسجَّل النتيجة من تبويب الطلبات في ملف العميل.</Empty> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px]">
                  <thead><tr>{["الجهة", "الطلبات", "القبول", "المعتمد من تقديرنا", "تطلب غالباً", "ترفض بسبب"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                  <tbody>{[...exp.values()].sort((a, b) => b.n - a.n).map((e) => {
                    const pct = Math.round((e.approved / e.n) * 100);
                    return (
                      <tr key={e.lenderId} className="align-top">
                        <td className="td font-semibold">{lenders.find((l) => l.id === e.lenderId)?.name}</td>
                        <td className="td num">{e.n}</td>
                        <td className="td"><Badge tone={pct >= 70 ? "green" : pct >= 40 ? "amber" : "red"}>{pct}%</Badge></td>
                        <td className="td num">{e.ratio ? <span className={e.ratio < 0.95 ? "text-rose-700" : e.ratio > 1.05 ? "text-emerald-700" : ""}>{Math.round(e.ratio * 100)}%</span> : "—"}</td>
                        <td className="td"><div className="flex flex-wrap gap-1">{e.conditions.slice(0, 3).map(([k, n]) => <Badge key={k} tone="blue">{OUTCOME_CONDITIONS[k] ?? k} ×{n}</Badge>)}</div></td>
                        <td className="td"><div className="flex flex-wrap gap-1">{e.reasons.slice(0, 2).map(([k, n]) => <Badge key={k} tone="red">{REJECT_REASONS[k] ?? k} ×{n}</Badge>)}</div></td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            )}
          </section>

          {byLender.size === 0 && <div className="card"><Empty art="path" title="لا خبرات مسجلة بعد" /></div>}
          {[...byLender.entries()].map(([name, list]) => (
            <section key={name} className="card overflow-hidden">
              <div className="px-5 pt-4 pb-2 text-[15px] font-bold flex items-center gap-2">{name}<span className="num text-xs font-medium text-slate-400">{list.length}</span></div>
              <ul>
                {list.map((r) => (
                  <li key={r.id} className="group px-5 py-3.5 border-t border-slate-100 flex gap-3 items-start">
                    <span className="size-8 shrink-0 rounded-[10px] bg-slate-100 text-slate-600 grid place-items-center"><Icon name={RULE_KIND[r.kind].icon} className="size-4" /></span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm flex flex-wrap items-center gap-2">{r.title}<Badge tone={RULE_KIND[r.kind].tone}>{RULE_KIND[r.kind].label}</Badge>{r.finance_type && <Badge>{FINANCE_TYPE[r.finance_type as keyof typeof FINANCE_TYPE]}</Badge>}</div>
                      {r.body && <p className="text-[13px] text-slate-600 mt-1 leading-6">{r.body}</p>}
                      <div className="text-[11px] text-slate-400 mt-1">{r.author ?? "الفريق"} · {dateAr(r.created_at)}</div>
                    </div>
                    {can(u, "lender.manage") && <form action={archiveLenderRule.bind(null, r.id)}><button className="btn-quiet btn-sm opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity" title="أرشفة"><Icon name="trash" className="size-4" /></button></form>}
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {recent.length > 0 && (
            <Fold title="آخر النتائج" icon="list" meta={<span className="num">{recent.length}</span>}>
              <div className="overflow-x-auto -mx-5">
                <table className="w-full min-w-[720px]">
                  <thead><tr>{["التاريخ", "الجهة", "القطاع والراتب", "القرار", "تقديرنا", "المعتمد", "الاشتراطات أو السبب"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                  <tbody>{recent.map((o) => (
                    <tr key={o.id} className="align-top">
                      <td className="td text-xs whitespace-nowrap">{dateAr(o.created_at)}</td>
                      <td className="td"><div className="font-semibold">{o.lender}</div><div className="text-xs text-slate-500">{FINANCE_TYPE[o.finance_type]}</div></td>
                      <td className="td text-xs">{SECTOR[o.sector]} · <span className="num">{sar(o.salary)}</span></td>
                      <td className="td"><Badge tone={OUTCOME_DECISION[o.decision].tone}>{OUTCOME_DECISION[o.decision].label}</Badge></td>
                      <td className="td num text-xs">{sar(o.estimated_amount)}</td>
                      <td className="td num text-xs font-semibold">{sar(o.approved_amount)}</td>
                      <td className="td text-xs max-w-64">{o.reason ? <span className="text-rose-700">{REJECT_REASONS[o.reason]}</span> : (JSON.parse(o.conditions) as string[]).map((k) => OUTCOME_CONDITIONS[k] ?? k).join("، ") || "—"}{o.note && <div className="text-slate-500 mt-0.5">{o.note}</div>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Fold>
          )}
        </div>

        {can(u, "client.edit") && (
          <form action={addLenderRule} className="card p-5 space-y-3.5 lg:sticky lg:top-6">
            <h2 className="text-[15px] font-bold">أضف خبرة</h2>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">النوع</label><select name="kind" className="input">{Object.entries(RULE_KIND).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
              <div><label className="label">التمويل</label><select name="finance_type" className="input"><option value="">كل الأنواع</option>{Object.entries(FINANCE_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            </div>
            <div><label className="label">الجهة</label><select name="lender_id" className="input"><option value="">كل الجهات</option>{lenders.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
            <div><label className="label">العنوان</label><input name="title" className="input" required placeholder="يطلب تقريراً طبياً لمن فوق 55" /></div>
            <div><label className="label">التفاصيل</label><textarea name="body" rows={4} className="input !h-auto py-2.5 leading-6" placeholder="متى ينطبق؟ وما الذي نجح؟" /></div>
            <button className="btn-primary w-full">حفظ</button>
          </form>
        )}
      </div>
    </>
  );
}
