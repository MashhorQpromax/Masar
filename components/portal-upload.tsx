"use client";
import { useActionState, useRef } from "react";
import type { FormState } from "@/app/actions";

export default function PortalUpload({ label, rejected, action }: { label: string; rejected?: boolean; action: (s: FormState, fd: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  if (state?.ok) return <div className="rounded-xl bg-emerald-50 ring-1 ring-emerald-200 p-3 text-sm text-emerald-800">✅ {label} — {state.ok}</div>;
  return (
    <form ref={ref} action={formAction} className="rounded-xl ring-1 ring-slate-200 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">{label}{rejected && <span className="text-rose-600 text-xs font-normal"> — يُعاد إرساله</span>}</div>
        <label className={`btn-primary btn-sm cursor-pointer whitespace-nowrap ${pending ? "opacity-60" : ""}`}>
          {pending ? "جارٍ الرفع…" : "📷 رفع"}
          <input type="file" name="file" accept="application/pdf,image/*" className="hidden" disabled={pending} onChange={() => ref.current?.requestSubmit()} />
        </label>
      </div>
      {state?.error && <div className="text-xs text-rose-700 mt-2">{state.error}</div>}
    </form>
  );
}
