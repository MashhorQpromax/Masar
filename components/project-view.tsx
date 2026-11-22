import type { ProjectStudy, ProjectInput } from "@/lib/project";
import { Badge, Callout, Fig, Fold, VerdictChip, sar } from "@/components/ui";

const FIT: Record<string, [string, string]> = { high: ["ملاءمة عالية", "green"], medium: ["ملاءمة متوسطة", "amber"], low: ["ملاءمة ضعيفة", "slate"] };
const V: Record<string, [string, string, string]> = { feasible: ["green", "check-circle", "قابل للتمويل"], feasible_restructure: ["amber", "alert", "قابل بإعادة هيكلة"], needs_info: ["slate", "info", "بيانات ناقصة"], weak: ["red", "x-circle", "ضعيف"] };
const LVL: Record<string, string> = { block: "red", warn: "amber", info: "slate" };
const mil = (n: number | null | undefined) => (n == null ? "—" : `${(Math.round(n / 100_000) / 10).toLocaleString("en-US")} م`);

export default function ProjectView({ p, x }: { p: ProjectStudy; x: ProjectInput }) {
  const v = V[p.verdict] ?? V.needs_info;
  return (
    <div className="space-y-4">
      <section className="card p-5 sm:p-7">
        <VerdictChip tone={v[0]} icon={v[1]}>{v[2]}</VerdictChip>
        <h2 className="mt-4 text-[22px] sm:text-2xl font-bold leading-snug max-w-3xl">{p.headline}</h2>
        <p className="mt-2 text-[13px] text-slate-500">{x.projectType === "hotel" ? "مشروع فندقي" : "مشروع"}{x.city ? ` · ${x.city}${x.district ? `، ${x.district}` : ""}` : ""} · المطلوب <span className="num">{mil(p.requested)}</span> · قيمة الأرض <span className="num">{mil(x.landValue)}</span>{x.landArea ? <> · <span className="num">{sar(x.landArea)}</span> م²</> : null}</p>
        <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-5">
          <Fig label="الطلب إلى قيمة الأرض" value={p.ltv != null ? `${p.ltv}%` : "—"} hint="المعتاد بضمان أرض 40 إلى 50%" />
          <Fig label="الطلب إلى التكلفة" value={p.ltc != null ? `${p.ltc}%` : "—"} hint={p.totalCost ? `التكلفة ${mil(p.totalCost)}` : "تكلفة البناء غير معروفة"} />
          <Fig label="سعر المتر" value={p.pricePerM2 ? sar(p.pricePerM2) : "—"} hint="ريال للمتر" />
          <Fig label="تغطية خدمة الدين" value={p.dscr != null ? `${p.dscr}x` : "—"} hint={p.noi ? `صافي دخل ${mil(p.noi)} سنوياً` : "يحتاج الغرف والسعر والإشغال"} />
        </div>
      </section>

      {p.alerts.filter((a) => a.level === "block").map((a, i) => <Callout key={i} tone="red" icon="ban" title={a.title}>{a.detail}{a.exit && <div className="mt-1 font-semibold">المخرج: {a.exit}</div>}</Callout>)}

      <section>
        <h3 className="font-bold text-[15px] mb-3">الهياكل الممكنة</h3>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {p.structures.map((s) => (
            <div key={s.id} className="card p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2"><div className="font-semibold text-sm leading-6">{s.title}</div><Badge tone={FIT[s.fit][1]}>{FIT[s.fit][0]}</Badge></div>
              {s.amount ? <div className="figure text-2xl font-semibold text-brand-700">{mil(s.amount)}</div> : null}
              <p className="text-[13px] text-slate-600 leading-6">{s.how}</p>
              <dl className="text-xs space-y-1.5 mt-auto pt-2 border-t border-slate-100">
                <div><dt className="inline font-semibold text-slate-500">يتطلب: </dt><dd className="inline">{s.needs.join("، ")}</dd></div>
                <div><dt className="inline font-semibold text-slate-500">الجهات: </dt><dd className="inline">{s.lenders.join("، ")}</dd></div>
              </dl>
            </div>
          ))}
        </div>
      </section>

      {p.alerts.some((a) => a.level !== "block") && (
        <Fold title="تنبيهات واشتراطات" icon="shield" meta={<span className="num">{p.alerts.filter((a) => a.level !== "block").length}</span>}>
          <ul className="space-y-2">{p.alerts.filter((a) => a.level !== "block").map((a, i) => <li key={i}><Callout tone={LVL[a.level]} title={a.title}>{a.detail}{a.exit && <div className="mt-1 font-semibold">المخرج: {a.exit}</div>}</Callout></li>)}</ul>
        </Fold>
      )}

      <Fold title="المطلوب من العميل" icon="file" open meta={<span className="num">{p.missing.length}</span>}>
        <ol className="space-y-2.5 text-[13px] leading-6">
          {p.missing.map((m, i) => <li key={i} className="flex gap-3"><span className="size-5 shrink-0 mt-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px] font-bold grid place-items-center num">{i + 1}</span><span><b>{m.label}</b>{m.critical ? <span className="text-rose-700 font-semibold"> · أساسي</span> : null}<span className="block text-slate-500">{m.why}</span></span></li>)}
        </ol>
      </Fold>
      <p className="text-xs text-slate-400">النسب تقديرية من ممارسة السوق. القرار النهائي بعد تقييم الجهة ولجنة الائتمان.</p>
    </div>
  );
}
