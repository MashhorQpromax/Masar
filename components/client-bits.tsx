"use client";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { uploadDocument, revealId, uploadSimah } from "@/app/actions";
import { Icon } from "@/components/icon";

export function UploadButton({ clientId, docId, hasFile }: { clientId: number; docId: number; hasFile: boolean }) {
  const [state, action, pending] = useActionState(uploadDocument.bind(null, clientId, docId), undefined);
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={action} className="flex items-center gap-2">
      <label className={`btn-ghost btn-sm ${pending ? "opacity-50" : ""}`}>
        <Icon name={hasFile ? "refresh" : "upload"} className="size-3.5" />{pending ? "جارٍ الرفع" : hasFile ? "استبدال" : "رفع"}
        <input type="file" name="file" accept="application/pdf,image/*" className="hidden" onChange={() => ref.current?.requestSubmit()} />
      </label>
      {state?.error && <span className="text-xs text-rose-700">{state.error}</span>}
    </form>
  );
}

export function RevealId({ clientId, masked }: { clientId: number; masked: string }) {
  const [v, setV] = useState<string | null>(null);
  const [p, start] = useTransition();
  return (
    <span className="inline-flex items-center gap-2">
      <span className="num">{v ?? masked}</span>
      {!v && <button type="button" disabled={p} onClick={() => start(async () => setV(await revealId(clientId)))} aria-label="إظهار رقم الهوية" className="text-slate-400 hover:text-ink cursor-pointer"><Icon name="eye" className="size-4" /></button>}
    </span>
  );
}

export function SimahUpload({ clientId, label = "رفع تقرير سمة" }: { clientId: number; label?: string }) {
  const [state, action, pending] = useActionState(uploadSimah.bind(null, clientId), undefined);
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={action} className="flex flex-wrap items-center gap-3">
      <label className={`btn-primary cursor-pointer ${pending ? "opacity-60" : ""}`}>
        <Icon name="upload" className="size-4" />{pending ? "جارٍ قراءة التقرير" : label}
        <input type="file" name="file" accept="application/pdf" className="hidden" disabled={pending} onChange={() => ref.current?.requestSubmit()} />
      </label>
      {state?.error && <span className="text-sm text-rose-700">{state.error}</span>}
      {state?.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
    </form>
  );
}

/** قائمة تُحفظ فور تغييرها، بلا زر */
export function AutoSelect({ name, defaultValue, options, className = "", label }: { name: string; defaultValue: string; options: [string, string][]; className?: string; label?: string }) {
  return (
    <select name={name} defaultValue={defaultValue} aria-label={label} className={`input w-auto ${className}`} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
      {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </select>
  );
}

/** قائمة «المزيد» */
export function MoreMenu({ items }: { items: { href: string; label: string; icon: string }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-label="المزيد" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="btn-ghost !px-0 w-10"><Icon name="more" /></button>
      {open && (
        <div className="absolute z-30 end-0 top-12 w-52 rounded-2xl bg-white border border-slate-200/80 shadow-[0_18px_40px_-18px_rgba(20,28,24,.35)] p-1.5 animate-pop origin-top">
          {items.map((i) => <Link key={i.href} href={i.href} onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-[10px] px-3 h-9 text-[13px] font-medium text-slate-700 hover:bg-slate-100 hover:text-ink"><Icon name={i.icon} className="size-4 text-slate-400" />{i.label}</Link>)}
        </div>
      )}
    </div>
  );
}

/** زر يطلب تأكيداً بضغطة ثانية بدل نافذة منبثقة */
export function ConfirmButton({ children, confirm = "اضغط مرة أخرى للتأكيد", className = "btn-danger" }: { children: React.ReactNode; confirm?: string; className?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t); }, [armed]);
  return <button type={armed ? "submit" : "button"} className={className} onClick={(e) => { if (!armed) { e.preventDefault(); setArmed(true); } }}>{armed ? confirm : children}</button>;
}
