import Link from "next/link";
import { all } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { STAGES, STAGE_LABEL, CAPITAL_OUT_STAGES, type Stage } from "@/lib/deal";
import { PageHeader, Stat, Badge, sar, dateAr } from "@/components/ui";

export const dynamic = "force-dynamic";

const VERDICT: Record<string, [string, string]> = { go: ["تُغلق", "green"], tight: ["هامش ضيق", "amber"], short: ["عجز", "red"], needs_info: ["ناقصة", "slate"] };

export default async function DealsPage() {
  await requireUser();
  const rows = await all<{ client_id: number; full_name: string; file_no: string; stage: Stage; capital: number | null; fee: number | null; client_net: number | null; verdict: string | null; updated_at: string }>(
    "SELECT d.client_id, c.full_name, c.file_no, d.stage, d.capital, d.fee, d.client_net, d.verdict, d.updated_at FROM deals d JOIN clients c ON c.id = d.client_id ORDER BY d.updated_at DESC",
  );
  const open = rows.filter((r) => r.stage !== "closed" && r.stage !== "lost");
  const deployed = rows.filter((r) => CAPITAL_OUT_STAGES.includes(r.stage)).reduce((s, r) => s + (r.capital ?? 0), 0);
  const pipelineCap = open.filter((r) => r.stage === "study" || r.stage === "agreement").reduce((s, r) => s + (r.capital ?? 0), 0);
  const expected = open.reduce((s, r) => s + (r.fee ?? 0), 0);
  const realized = rows.filter((r) => r.stage === "recovered" || r.stage === "closed").reduce((s, r) => s + (r.fee ?? 0), 0);
  const cols = STAGES.filter(([k]) => k !== "closed" && k !== "lost");

  return (
    <>
      <PageHeader title="الصفقات" sub="سداد المديونيات وإعادة التمويل — رأس المال والأتعاب حسب المرحلة" actions={<Link href="/clients/new" className="btn-primary">+ عميل جديد</Link>} />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <Stat label="رأس مال موظّف الآن" value={sar(deployed)} tone="orange" hint="ريال — صفقات دفعنا فيها ولم نسترد" />
        <Stat label="رأس مال مطلوب قريباً" value={sar(pipelineCap)} tone="blue" hint="ريال — صفقات في الدراسة والاتفاق" />
        <Stat label="أتعاب متوقعة" value={sar(expected)} tone="brand" hint={`ريال — ${open.length} صفقة مفتوحة`} />
        <Stat label="أتعاب محققة" value={sar(realized)} tone="green" hint="ريال — صفقات مستردة/مغلقة" />
      </div>
      {rows.length === 0 ? (
        <div className="card p-10 text-center text-slate-500">لا صفقات بعد. افتح ملف عميل ← تبويب «الصفقة» ← احفظ الدراسة.</div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4 snap-x">
          {cols.map(([k, l]) => {
            const list = rows.filter((r) => r.stage === k);
            return (
              <div key={k} className="min-w-[240px] flex-1 snap-start">
                <div className="flex items-center gap-2 mb-2 px-1"><span className="text-sm font-bold">{l}</span><span className="text-xs text-slate-400 num">{list.length}</span></div>
                <div className="space-y-2 rounded-2xl bg-slate-100/70 p-2 min-h-28">
                  {list.map((r) => (
                    <Link key={r.client_id} href={`/clients/${r.client_id}?tab=deal`} className="block card p-3 hover:ring-brand-300">
                      <div className="flex items-start justify-between gap-2"><div className="font-bold text-sm">{r.full_name}</div>{r.verdict && <Badge tone={VERDICT[r.verdict]?.[1]}>{VERDICT[r.verdict]?.[0]}</Badge>}</div>
                      <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-slate-500">
                        <span>رأس المال</span><b className="num text-slate-800 text-end">{sar(r.capital)}</b>
                        <span>أتعابنا</span><b className="num text-brand-700 text-end">{sar(r.fee)}</b>
                        <span>للعميل</span><b className={`num text-end ${(r.client_net ?? 0) < 0 ? "text-rose-700" : "text-emerald-700"}`}>{sar(r.client_net)}</b>
                      </div>
                      <div className="mt-2 text-[11px] text-slate-400"><span className="num">{r.file_no}</span> · {dateAr(r.updated_at)}</div>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {rows.some((r) => r.stage === "closed" || r.stage === "lost") && (
        <div className="card p-5 mt-6">
          <h3 className="font-bold mb-3">المغلقة والمتعثرة</h3>
          <ul className="text-sm space-y-1">{rows.filter((r) => r.stage === "closed" || r.stage === "lost").map((r) => <li key={r.client_id}><Link className="text-brand-700 hover:underline" href={`/clients/${r.client_id}?tab=deal`}>{r.full_name}</Link> — {STAGE_LABEL[r.stage]} · أتعاب <span className="num">{sar(r.fee)}</span></li>)}</ul>
        </div>
      )}
    </>
  );
}
