"use client";
import { useActionState, useRef, useState, useTransition } from "react";
import { uploadDocument, revealId } from "@/app/actions";

export function UploadButton({ clientId, docId, hasFile }: { clientId: number; docId: number; hasFile: boolean }) {
  const [state, action, pending] = useActionState(uploadDocument.bind(null, clientId, docId), undefined);
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={action} className="flex items-center gap-2">
      <label className={`btn-ghost btn-sm ${pending ? "opacity-50" : ""}`}>
        {pending ? "جارٍ الرفع…" : hasFile ? "استبدال" : "⬆ رفع"}
        <input type="file" name="file" accept="application/pdf,image/*" className="hidden" onChange={() => ref.current?.requestSubmit()} />
      </label>
      {state?.error && <span className="text-xs text-rose-600">{state.error}</span>}
    </form>
  );
}

export function RevealId({ clientId, masked }: { clientId: number; masked: string }) {
  const [v, setV] = useState<string | null>(null);
  const [p, start] = useTransition();
  return (
    <span className="inline-flex items-center gap-2">
      <span className="num">{v ?? masked}</span>
      {!v && <button type="button" disabled={p} onClick={() => start(async () => setV(await revealId(clientId)))} className="text-xs text-brand-700 hover:underline">إظهار</button>}
    </span>
  );
}
