import Link from "next/link";
import { all } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { STAGES, STAGE_LABEL, CAPITAL_OUT_STAGES, type Stage } from "@/lib/deal";
import { PageHeader, Metric, MetricStrip, Badge, Empty, Fold, StageBar, sar } from "@/components/ui";
import { CountUp } from "@/components/count-up";

export const dynamic = "force-dynamic";

const VERDICT: Record<string, [string, string]> = { go: ["تُغلق", "green"], tight: ["هامش ضيق", "amber"], short: ["عجز", "red"], needs_info: ["بيانات ناقصة", "slate"] };
const ORDER = STAGES.map(([k]) => k).filter((k) => k !== "closed" && k !== "lost") as Stage[];

type Row = { client_id: number; full_name: string; file_no: string; stage: Stage; capital: number | null; fee: number | null; client_net: number | null; verdict: string | null; updated_at: string };

export default async function DealsPage() {
  await requireUser();
  const rows = await all<Row>(
    "SELECT d.client_id, c.full_name, c.file_no, d.stage, d.capital, d.fee, d.client_net, d.verdict, d.updated_at FROM deals d JOIN clients c ON c.id = d.client_id ORDER BY d.updated_at DESC",
  );
  const open = rows.filter((r) => r.stage !== "closed" && r.stage !== "lost").sort((a, b) => ORDER.indexOf(b.stage) - ORDER.indexOf(a.stage));
  const done = rows.filter((r) => r.stage === "closed" || r.stage === "lost");
  const deployed = rows.filter((r) => CAPITAL_OUT_STAGES.includes(r.stage)).reduce((s, r) => s + (r.capital ?? 0), 0);
  const pipelineCap = open.filter((r) => r.stage === "study" || r.stage === "agreement").reduce((s, r) => s + (r.capital ?? 0), 0);
  const expected = open.reduce((s, r) => s + (r.fee ?? 0), 0);
  const realized = rows.filter((r) => r.stage === "recovered" || r.stage === "closed").reduce((s, r) => s + (r.fee ?? 0), 0);

  const line = (r: Row) => (
    <li key={r.client_id} className="border-b border-slate-100 last:border-0">
      <Link href={`/clients/${r.client_id}?tab=deal`} className="grid grid-cols-2 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.7fr)_repeat(3,minmax(0,.8fr))] gap-x-6 gap-y-3 items-center px-5 py-4 hover:bg-slate-50/70 transition-colors">
        <div className="min-w-0"><div className="font-semibold text-sm truncate">{r.full_name}</div><div className="mt-1">{r.verdict && <Badge tone={VERDICT[r.verdict]?.[1]} dot>{VERDICT[r.verdict]?.[0]}</Badge>}</div></div>
        <div className="min-w-0">
          <div className="text-xs text-slate-600 mb-1.5 truncate">{STAGE_LABEL[r.stage]}</div>
          <StageBar total={ORDER.length} at={ORDER.indexOf(r.stage)} lost={r.stage === "lost"} />
        </div>
        <Num label="رأس المال" v={r.capital} />
        <Num label="أتعابنا" v={r.fee} tone="text-brand-700" />
        <Num label="للعميل" v={r.client_net} tone={(r.client_net ?? 0) < 0 ? "text-rose-700" : "text-emerald-700"} />
      </Link>
    </li>
  );

  return (
    <>
      <PageHeader title="الصفقات" />
      <div className="stagger space-y-6">
        <MetricStrip>
          <Metric label="رأس مال موظّف" value={<CountUp value={deployed} />} unit="ر.س" hint="دفعناه ولم نسترده بعد" />
          <Metric label="مطلوب قريباً" value={<CountUp value={pipelineCap} />} unit="ر.س" hint="في الدراسة والاتفاق" />
          <Metric label="أتعاب متوقعة" value={<CountUp value={expected} />} unit="ر.س" hint={`${open.length} صفقة مفتوحة`} tone="brand" />
          <Metric label="أتعاب محققة" value={<CountUp value={realized} />} unit="ر.س" tone="green" />
        </MetricStrip>
        {open.length === 0 ? (
          <div className="card"><Empty art="bridge" title="لا صفقات مفتوحة">تبدأ الصفقة من ملف العميل، تبويب «الصفقة».</Empty></div>
        ) : <div className="card overflow-hidden"><ul>{open.map(line)}</ul></div>}
        {done.length > 0 && <Fold title="المغلقة والملغاة" icon="layers" meta={<span className="num">{done.length}</span>}><ul className="-mx-5 -mb-5">{done.map(line)}</ul></Fold>}
      </div>
    </>
  );
}

function Num({ label, v, tone = "text-ink" }: { label: string; v: number | null; tone?: string }) {
  return <div className="min-w-0"><div className="text-[11px] text-slate-500">{label}</div><div className={`num text-sm font-semibold text-start ${tone}`}>{sar(v)}</div></div>;
}
