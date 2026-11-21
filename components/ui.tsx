import Link from "next/link";
import { STATUS, ELIGIBILITY, type StatusKey, type EligibilityKey } from "@/lib/labels";

const TONES: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  orange: "bg-orange-50 text-orange-700 ring-orange-600/20",
  blue: "bg-sky-50 text-sky-700 ring-sky-600/20",
  red: "bg-rose-50 text-rose-700 ring-rose-600/20",
  slate: "bg-slate-100 text-slate-600 ring-slate-500/20",
  brand: "bg-brand-50 text-brand-700 ring-brand-600/20",
};
export const DOT: Record<string, string> = {
  green: "bg-emerald-500", amber: "bg-amber-400", orange: "bg-orange-500", blue: "bg-sky-500", red: "bg-rose-500", slate: "bg-slate-400", brand: "bg-brand-500",
};

export function Badge({ tone = "slate", children, dot }: { tone?: string; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset whitespace-nowrap ${TONES[tone] ?? TONES.slate}`}>
      {dot && <span className={`size-1.5 rounded-full ${DOT[tone]}`} />}
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
  return <Badge tone={x.tone}>{x.emoji} {x.label}</Badge>;
}

export function PageHeader({ title, sub, actions, back }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {back && <Link href={back.href} className="text-xs font-semibold text-brand-700 hover:underline">→ {back.label}</Link>}
        <h1 className="text-2xl font-bold tracking-tight mt-1">{title}</h1>
        {sub && <div className="text-sm text-slate-500 mt-1">{sub}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone = "brand" }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: string }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500"><span className={`size-2 rounded-full ${DOT[tone]}`} />{label}</div>
      <div className="mt-2 text-3xl font-bold num text-start">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function Progress({ pct, tone = "brand" }: { pct: number; tone?: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
      <div className={`h-full rounded-full ${DOT[tone]}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">{children}</div>;
}

export const sar = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
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
