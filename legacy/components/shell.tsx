"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { logoutAction } from "@/app/actions";

export type NavItem = { href: string; label: string; icon: string; match?: string[]; badge?: number };
export type PaletteClient = { id: number; name: string; no: string };
export type PaletteAction = { href: string; label: string; icon: string; keys?: string };

const active = (path: string, i: NavItem) =>
  i.href === "/" ? path === "/" : [i.href, ...(i.match ?? [])].some((p) => path === p || path.startsWith(p + "/"));

export const openPalette = () => window.dispatchEvent(new Event("masar:palette"));

export function SideNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((i) => {
        const on = active(path, i);
        return (
          <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined}
            className={`group flex items-center gap-3 rounded-[11px] px-3 h-10 text-[13.5px] font-semibold transition-colors ${on ? "bg-white text-ink shadow-[0_1px_2px_rgba(20,28,24,.08)]" : "text-slate-600 hover:bg-black/[.045] hover:text-ink"}`}>
            <Icon name={i.icon} className={`size-[18px] transition-colors ${on ? "text-brand-700" : "text-slate-400 group-hover:text-slate-600"}`} />
            <span className="flex-1">{i.label}</span>
            {!!i.badge && <span className="num min-w-5 h-5 px-1.5 rounded-full bg-brand-700 text-white text-[11px] font-bold grid place-items-center">{i.badge}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileTabs({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav className="no-print lg:hidden fixed bottom-0 inset-x-0 z-30 bg-sheet/95 backdrop-blur border-t border-slate-200/80 grid pb-[env(safe-area-inset-bottom)]" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
      {items.map((i) => {
        const on = active(path, i);
        return (
          <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined} className={`relative flex flex-col items-center justify-center gap-1 h-[58px] text-[10.5px] font-semibold transition-colors ${on ? "text-brand-800" : "text-slate-500"}`}>
            <span className={`absolute top-0 h-0.5 w-8 rounded-full transition-colors ${on ? "bg-gold" : "bg-transparent"}`} />
            <span className="relative"><Icon name={i.icon} className="size-[21px]" strokeWidth={on ? 2 : 1.7} />{!!i.badge && <span className="absolute -top-1 -end-2 num min-w-4 h-4 px-1 rounded-full bg-brand-700 text-white text-[9px] font-bold grid place-items-center">{i.badge}</span>}</span>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SearchButton({ compact }: { compact?: boolean }) {
  if (compact) return <button type="button" onClick={openPalette} aria-label="بحث" className="size-10 grid place-items-center rounded-[11px] text-slate-600 hover:bg-black/[.05]"><Icon name="search" className="size-5" /></button>;
  return (
    <button type="button" onClick={openPalette} className="group w-full flex items-center gap-2.5 h-10 rounded-[11px] px-3 text-[13px] text-slate-500 bg-black/[.04] hover:bg-black/[.07] transition-colors cursor-pointer">
      <Icon name="search" className="size-4" />
      <span className="flex-1 text-start">بحث أو أمر</span>
      <kbd className="num text-[10px] font-semibold text-slate-400 border border-slate-300/80 rounded-md px-1.5 py-0.5 bg-white/60">Ctrl K</kbd>
    </button>
  );
}

export function UserMenu({ name, role, items, compact }: { name: string; role: string; items: PaletteAction[]; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [open]);
  const avatar = <span className="size-8 rounded-full bg-brand-800 text-gold-soft grid place-items-center text-[13px] font-bold font-display">{name.slice(0, 1)}</span>;
  return (
    <div className="relative" ref={ref}>
      {compact ? (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-label="القائمة" aria-expanded={open} className="size-10 grid place-items-center rounded-[11px] hover:bg-black/[.05]">{avatar}</button>
      ) : (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={`w-full flex items-center gap-2.5 rounded-[12px] p-2 text-start transition-colors cursor-pointer ${open ? "bg-black/[.06]" : "hover:bg-black/[.045]"}`}>
          {avatar}
          <span className="flex-1 min-w-0"><span className="block text-[13px] font-semibold truncate">{name}</span><span className="block text-[11px] text-slate-500 truncate">{role}</span></span>
          <Icon name="more" className="size-4 text-slate-400" />
        </button>
      )}
      {open && (
        <div className={`absolute z-40 w-56 rounded-2xl bg-white border border-slate-200/80 shadow-[0_18px_40px_-18px_rgba(20,28,24,.35)] p-1.5 animate-pop origin-bottom ${compact ? "top-12 end-0 origin-top" : "bottom-[calc(100%+6px)] inset-x-0"}`}>
          {compact && <div className="px-3 py-2 border-b border-slate-100 mb-1"><div className="text-[13px] font-semibold truncate">{name}</div><div className="text-[11px] text-slate-500">{role}</div></div>}
          {items.map((i) => (
            <Link key={i.href} href={i.href} className="flex items-center gap-2.5 rounded-[10px] px-3 h-9 text-[13px] font-medium text-slate-700 hover:bg-slate-100 hover:text-ink"><Icon name={i.icon} className="size-4 text-slate-400" />{i.label}</Link>
          ))}
          <form action={logoutAction} className="border-t border-slate-100 mt-1 pt-1">
            <button className="w-full flex items-center gap-2.5 rounded-[10px] px-3 h-9 text-[13px] font-medium text-rose-700 hover:bg-rose-50 cursor-pointer"><Icon name="logout" className="size-4" />تسجيل الخروج</button>
          </form>
        </div>
      )}
    </div>
  );
}

const norm = (s: string) => s.toLowerCase().replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").trim();

export function CommandPalette({ clients, actions }: { clients: PaletteClient[]; actions: PaletteAction[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const router = useRouter();
  const path = usePathname();
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === "Escape") setOpen(false);
    };
    const ev = () => setOpen(true);
    window.addEventListener("keydown", key); window.addEventListener("masar:palette", ev);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("masar:palette", ev); };
  }, []);
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => { if (open) { setQ(""); setSel(0); } }, [open]);

  const rows = useMemo(() => {
    const n = norm(q);
    const a = actions.filter((x) => !n || norm(x.label).includes(n) || (x.keys ?? "").includes(n)).map((x) => ({ kind: "a" as const, href: x.href, label: x.label, icon: x.icon, sub: "" }));
    const c = clients.filter((x) => !n || norm(x.name).includes(n) || x.no.toLowerCase().includes(n)).slice(0, n ? 8 : 5).map((x) => ({ kind: "c" as const, href: `/clients/${x.id}`, label: x.name, icon: "user", sub: x.no }));
    return n ? [...c, ...a] : [...a, ...c];
  }, [q, clients, actions]);

  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);

  if (!open) return null;
  const go = (href: string) => { setOpen(false); router.push(href); };
  let lastKind = "";
  return (
    <div className="no-print fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="بحث">
      <div className="absolute inset-0 bg-ink/35 backdrop-blur-[3px] animate-fade" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-[560px] rounded-[20px] bg-white border border-slate-200/80 shadow-[0_30px_80px_-20px_rgba(20,28,24,.45)] overflow-hidden" style={{ animation: "palette .22s var(--ease-out) both" }}>
        <div className="flex items-center gap-3 px-4 h-14 border-b border-slate-100">
          <Icon name="search" className="size-5 text-slate-400" />
          <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} placeholder="اكتب اسم عميل أو رقم ملف أو أمراً"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(rows.length - 1, s + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              else if (e.key === "Enter" && rows[sel]) { e.preventDefault(); go(rows[sel].href); }
            }}
            className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-slate-400" />
          <kbd className="num text-[10px] font-semibold text-slate-400 border border-slate-200 rounded-md px-1.5 py-0.5">Esc</kbd>
        </div>
        <div ref={list} className="max-h-[52vh] overflow-y-auto p-2">
          {rows.length === 0 && <div className="py-10 text-center text-sm text-slate-500">لا نتائج لـ «{q}»</div>}
          {rows.map((r, i) => {
            const head = r.kind !== lastKind ? (r.kind === "a" ? "انتقال سريع" : "العملاء") : null;
            lastKind = r.kind;
            return (
              <div key={r.kind + r.href}>
                {head && <div className="eyebrow px-3 pt-2.5 pb-1.5">{head}</div>}
                <button type="button" data-i={i} onMouseMove={() => setSel(i)} onClick={() => go(r.href)}
                  className={`w-full flex items-center gap-3 rounded-[11px] px-3 h-11 text-start text-sm cursor-pointer ${i === sel ? "bg-slate-100 text-ink" : "text-slate-700"}`}>
                  <span className={`size-7 rounded-lg grid place-items-center ${r.kind === "c" ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-500"}`}><Icon name={r.icon} className="size-4" /></span>
                  <span className="flex-1 font-medium truncate">{r.label}</span>
                  {r.sub && <span className="num text-xs text-slate-400">{r.sub}</span>}
                  {i === sel && <Icon name="arrow-left" className="size-4 text-slate-400" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
