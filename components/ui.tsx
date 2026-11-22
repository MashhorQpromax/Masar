import Link from "next/link";
import { STATUS, ELIGIBILITY, type StatusKey, type EligibilityKey } from "@/lib/labels";
import { Icon } from "@/components/icon";
import { Spot } from "@/components/art";

const TONES: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-800",
  amber: "bg-amber-50 text-amber-800",
  orange: "bg-orange-50 text-orange-800",
  blue: "bg-sky-50 text-sky-800",
  red: "bg-rose-50 text-rose-800",
  slate: "bg-slate-100 text-slate-600",
  brand: "bg-brand-50 text-brand-800",
  gold: "bg-gold-soft/60 text-amber-900",
};
export const DOT: Record<string, string> = {
  green: "bg-emerald-500", amber: "bg-amber-400", orange: "bg-orange-500", blue: "bg-sky-500", red: "bg-rose-500", slate: "bg-slate-400", brand: "bg-brand-500", gold: "bg-gold",
};
export const TEXT: Record<string, string> = {
  green: "text-emerald-700", amber: "text-amber-700", orange: "text-orange-700", blue: "text-sky-700", red: "text-rose-700", slate: "text-slate-500", brand: "text-brand-700", gold: "text-amber-700",
};

export function Badge({ tone = "slate", children, dot, icon }: { tone?: string; children: React.ReactNode; dot?: boolean; icon?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 h-[22px] text-[11.5px] font-semibold whitespace-nowrap ${TONES[tone] ?? TONES.slate}`}>
      {dot && <span className={`size-1.5 rounded-full ${DOT[tone]}`} />}
      {icon && <Icon name={icon} className="size-3.5" strokeWidth={2} />}
      {children}
    </span>
  );
}

export function StatusBadge({ s }: { s: string }) {
  const x = STATUS[s as StatusKey] ?? STATUS.study;
  return <Badge tone={x.tone} dot>{x.label}</Badge>;
}
export function EligBadge({ e }: { e: string }) {
  const x = ELIGIBILITY[e as EligibilityKey] ?? ELIGIBILITY.pending;
  return <Badge tone={x.tone} icon={x.icon}>{x.label}</Badge>;
}

export function PageHeader({ title, sub, actions, back, eyebrow }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string }; eyebrow?: React.ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        {back && <Link href={back.href} className="no-print inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-ink transition-colors mb-2"><Icon name="arrow-right" className="size-3.5" />{back.label}</Link>}
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <h1 className="text-[26px] sm:text-[28px] font-bold leading-tight">{title}</h1>
        {sub && <div className="text-sm text-slate-500 mt-1.5">{sub}</div>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** رقم كبير بعنوان صغير، بلا إطار: يوضع داخل شريط أرقام */
export function Metric({ label, value, unit, hint, tone }: { label: string; value: React.ReactNode; unit?: string; hint?: React.ReactNode; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="eyebrow">{label}</div>
      <div className={`mt-1.5 flex items-baseline gap-1.5 ${tone ? TEXT[tone] : "text-ink"}`}>
        <span className="figure text-[30px] font-semibold leading-none">{value}</span>
        {unit && <span className="text-xs text-slate-400 font-medium">{unit}</span>}
      </div>
      {hint && <div className="mt-1.5 text-xs text-slate-500 truncate">{hint}</div>}
    </div>
  );
}
export function MetricStrip({ children, cols = 4 }: { children: React.ReactNode; cols?: 2 | 3 | 4 }) {
  const c = cols === 4 ? "grid-cols-2 lg:grid-cols-4" : cols === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2";
  return <div className={`card grid ${c} gap-x-6 gap-y-6 p-5 sm:p-6 [&>*]:lg:border-s [&>*]:lg:border-slate-200/70 [&>*]:lg:ps-6 [&>*:first-child]:lg:border-0 [&>*:first-child]:lg:ps-0`}>{children}</div>;
}

// توافق مع الصفحات القديمة
export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: string }) {
  return <div className="card p-5"><Metric label={label} value={value} hint={hint} tone={tone === "brand" ? undefined : tone} /></div>;
}

export function Progress({ pct, tone = "brand" }: { pct: number; tone?: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
      <div className={`h-full rounded-full origin-right grow-x ${DOT[tone]}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

export function Empty({ children, title, art = "path", action }: { children?: React.ReactNode; title?: string; art?: "path" | "bridge" | "docs" | "chat" | "search" | "lost" | null; action?: React.ReactNode }) {
  return (
    <div className="py-10 px-6 text-center flex flex-col items-center">
      {art && <Spot kind={art} className="w-36 mb-3" />}
      {title && <div className="font-semibold text-[15px]">{title}</div>}
      {children && <div className="text-sm text-slate-500 mt-1 max-w-sm leading-6">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function SectionTitle({ children, action, count }: { children: React.ReactNode; action?: React.ReactNode; count?: number }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <h2 className="text-[15px] font-bold flex items-center gap-2">{children}{count != null && <span className="num text-xs font-medium text-slate-400">{count}</span>}</h2>
      {action}
    </div>
  );
}

/** قسم يُفتح عند الحاجة */
export function Fold({ title, icon, meta, open, children, id }: { title: React.ReactNode; icon?: string; meta?: React.ReactNode; open?: boolean; children: React.ReactNode; id?: string }) {
  return (
    <details className="fold" open={open} id={id}>
      <summary>
        {icon && <span className="size-8 rounded-[10px] bg-slate-100 text-slate-600 grid place-items-center"><Icon name={icon} className="size-4" /></span>}
        <span className="flex-1 min-w-0 truncate">{title}</span>
        {meta && <span className="text-xs font-medium text-slate-500 flex items-center gap-2">{meta}</span>}
        <Icon name="chevron-down" className="chev size-4 text-slate-400" />
      </summary>
      <div className="px-5 pb-5 pt-1">{children}</div>
    </details>
  );
}

/** تنبيه سطري هادئ */
export function Callout({ tone = "slate", icon, title, children, action }: { tone?: string; icon?: string; title?: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode }) {
  const ic = icon ?? (tone === "red" ? "x-circle" : tone === "amber" || tone === "orange" ? "alert" : tone === "green" ? "check-circle" : "info");
  return (
    <div className={`rounded-xl px-4 py-3 flex gap-3 text-sm ${TONES[tone] ?? TONES.slate}`}>
      <Icon name={ic} className="size-[18px] mt-0.5" />
      <div className="flex-1 min-w-0 leading-6">{title && <div className="font-semibold">{title}</div>}{children && <div className="opacity-90">{children}</div>}</div>
      {action}
    </div>
  );
}

export function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-4 py-2.5 border-b border-slate-100 last:border-0"><dt className="text-slate-500 text-[13px]">{k}</dt><dd className="font-medium text-[13px] text-end">{v}</dd></div>;
}

/** يزيل الرموز التعبيرية من نصوص قديمة محفوظة */
export const plain = (t: string | null | undefined) => (t ?? "").replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{2B05}-\u{2B07}]/gu, "").replace(/^\s+/, "");

export const sar = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
/** اختصار المبالغ الكبيرة: 1.25 م، 840 ألف */
export const sarShort = (n: number | null | undefined) => {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toLocaleString("en-US", { maximumFractionDigits: a >= 1e7 ? 1 : 2 })} م`;
  if (a >= 1e4) return `${Math.round(n / 1e3).toLocaleString("en-US")} ألف`;
  return Math.round(n).toLocaleString("en-US");
};
export const dateAr = (s: string | null | undefined) => {
  if (!s) return "—";
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T") + (s.length > 10 ? "Z" : ""));
  return d.toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "short", year: "numeric" });
};
export const dateTimeAr = (s: string | null | undefined) => {
  if (!s) return "—";
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
  return d.toLocaleString("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

/** شريط مراحل مختصر: ما اكتمل، الحالي، والباقي */
export function StageBar({ total, at, lost }: { total: number; at: number; lost?: boolean }) {
  return (
    <div className="flex gap-[3px]" aria-hidden>
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} className={`h-1.5 flex-1 rounded-full ${lost ? "bg-rose-200" : i < at ? "bg-brand-600" : i === at ? "bg-gold" : "bg-slate-200"}`} />
      ))}
    </div>
  );
}

const CHIP_TONE: Record<string, string> = { green: "bg-emerald-50 text-emerald-800", amber: "bg-amber-50 text-amber-800", red: "bg-rose-50 text-rose-800", slate: "bg-slate-100 text-slate-600", orange: "bg-orange-50 text-orange-800", brand: "bg-brand-50 text-brand-800" };
/** شارة الحكم أعلى بطاقة الدراسة */
export function VerdictChip({ tone, icon, children }: { tone: string; icon: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 h-7 text-xs font-bold ${CHIP_TONE[tone] ?? CHIP_TONE.slate}`}><Icon name={icon} className="size-4" strokeWidth={2} />{children}</span>;
}
/** رقم رئيسي داخل بطاقة الحكم */
export function Fig({ label, value, hint, tone = "text-ink" }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="eyebrow">{label}</div>
      <div className={`figure text-[26px] sm:text-[28px] font-semibold leading-none mt-1.5 ${tone}`}>{value}</div>
      {hint && <div className="text-xs text-slate-500 mt-1.5 leading-5">{hint}</div>}
    </div>
  );
}
