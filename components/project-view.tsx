import type { ProjectStudy, ProjectInput } from "@/lib/project";
import { Badge, sar } from "@/components/ui";

const FIT: Record<string, [string, string]> = { high: ["ملاءمة عالية", "green"], medium: ["ملاءمة متوسطة", "amber"], low: ["ملاءمة ضعيفة", "slate"] };
const BG: Record<string, string> = { feasible: "from-emerald-700 to-emerald-900", feasible_restructure: "from-amber-600 to-amber-800", needs_info: "from-slate-600 to-slate-800", weak: "from-rose-700 to-rose-900" };
const LVL: Record<string, string> = { block: "bg-rose-50 ring-rose-200 text-rose-900", warn: "bg-amber-50 ring-amber-200 text-amber-900", info: "bg-sky-50 ring-sky-200 text-sky-900" };
const mil = (n: number | null | undefined) => (n == null ? "—" : `${(Math.round(n / 100_000) / 10).toLocaleString("en-US")} م`);

export default function ProjectView({ p, x }: { p: ProjectStudy; x: ProjectInput }) {
  return (
    <div className="space-y-5">
      <div className={`rounded-3xl bg-gradient-to-l ${BG[p.verdict]} text-white p-6`}>
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-60">
            <div className="text-xs text-white/70">دراسة تمويل مشروع{x.projectType === "hotel" ? " فندقي" : ""}{x.city ? ` — ${x.city}${x.district ? ` / ${x.district}` : ""}` : ""}</div>
            <div className="text-2xl font-bold mt-1">🏗️ {p.headline}</div>
            <div className="mt-2 text-sm text-white/85">المطلوب {mil(p.requested)} ريال · قيمة الأرض {mil(x.landValue)}{x.landArea ? ` · ${sar(x.landArea)} م²` : ""}</div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1 max-w-3xl">
            <Hero l="الطلب ÷ قيمة الأرض" v={p.ltv != null ? `${p.ltv}%` : "—"} u="السيولة بضمان أرض ≈ 40–50%" />
            <Hero l="الطلب ÷ التكلفة الكلية" v={p.ltc != null ? `${p.ltc}%` : "—"} u={p.totalCost ? `التكلفة ${mil(p.totalCost)}` : "تكلفة البناء غير معروفة"} />
            <Hero l="سعر المتر حسب التقييم" v={p.pricePerM2 ? sar(p.pricePerM2) : "—"} u="ريال / م²" />
            <Hero l="تغطية خدمة الدين" v={p.dscr != null ? `${p.dscr}x` : "—"} u={p.noi ? `صافي دخل ≈ ${mil(p.noi)}/سنة` : "يحتاج الغرف والسعر والإشغال"} />
          </div>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="font-bold mb-3">التنبيهات والاشتراطات</h3>
        <div className="grid md:grid-cols-2 gap-3">
          {p.alerts.map((a, i) => (
            <div key={i} className={`rounded-xl ring-1 p-3 text-sm ${LVL[a.level]}`}>
              <div className="font-bold">{a.level === "block" ? "⛔" : a.level === "warn" ? "⚠️" : "ℹ️"} {a.title}</div>
              <div className="mt-1 leading-6">{a.detail}</div>
              {a.exit && <div className="mt-1.5 text-xs font-semibold">المخرج: {a.exit}</div>}
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-bold mb-3">الهياكل الممكنة والجهات</h3>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {p.structures.map((s) => (
            <div key={s.id} className="card p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2"><div className="font-bold">{s.title}</div><Badge tone={FIT[s.fit][1]}>{FIT[s.fit][0]}</Badge></div>
              {s.amount ? <div className="text-sm">مبلغ تقديري: <b className="num">{mil(s.amount)}</b> ريال</div> : null}
              <p className="text-sm text-slate-600 leading-6">{s.how}</p>
              <div className="text-xs"><span className="font-bold text-slate-500">يتطلب: </span>{s.needs.join("، ")}</div>
              <div className="text-xs"><span className="font-bold text-slate-500">الجهات: </span>{s.lenders.join("، ")}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-5">
        <h3 className="font-bold mb-3">النواقص المطلوبة من العميل</h3>
        <ol className="space-y-2 text-sm list-decimal pr-5">
          {p.missing.map((m, i) => <li key={i}><b>{m.label}</b>{m.critical ? <span className="text-rose-600"> (أساسي)</span> : null} — <span className="text-slate-500">{m.why}</span></li>)}
        </ol>
      </div>
      <p className="text-xs text-slate-400">النسب تقديرية من ممارسة السوق. القرار النهائي بعد تقييم الجهة ولجنة الائتمان.</p>
    </div>
  );
}
function Hero({ l, v, u }: { l: string; v: string; u?: string }) {
  return <div className="rounded-2xl bg-white/10 ring-1 ring-white/15 p-3"><div className="text-[11px] text-white/70">{l}</div><div className="text-xl font-bold num text-start mt-1">{v}</div>{u ? <div className="text-[11px] text-white/60 mt-0.5">{u}</div> : null}</div>;
}
