"use client";
import { useActionState, useRef } from "react";
import type { FormState } from "@/app/actions";
import { Icon } from "@/components/icon";

export default function PortalUpload({ label, rejected, action }: { label: string; rejected?: boolean; action: (s: FormState, fd: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  if (state?.ok) return (
    <div className="flex items-center gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 animate-pop">
      <Icon name="check-circle" className="size-[18px]" /><span className="flex-1"><b>{label}</b> · {state.ok}</span>
    </div>
  );
  return (
    <form ref={ref} action={formAction} className="rounded-xl border border-slate-200/70 bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold min-w-0">{label}{rejected && <span className="block text-rose-600 text-xs font-normal mt-0.5">يُعاد إرساله</span>}</div>
        <label className={`btn-primary btn-sm !h-9 cursor-pointer ${pending ? "opacity-60 pointer-events-none" : ""}`}>
          <Icon name={pending ? "refresh" : "camera"} className={`size-4 ${pending ? "animate-spin" : ""}`} />{pending ? "جارٍ الرفع" : "رفع"}
          <input type="file" name="file" accept="application/pdf,image/*" className="hidden" disabled={pending} onChange={() => ref.current?.requestSubmit()} />
        </label>
      </div>
      {state?.error && <div className="text-xs text-rose-700 mt-2">{state.error}</div>}
    </form>
  );
}
