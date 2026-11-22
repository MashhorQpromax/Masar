"use client";
import { useState } from "react";
import { OUTCOME_CONDITIONS, REJECT_REASONS } from "@/lib/labels";
import { Icon } from "@/components/icon";

const DECISIONS: [string, string, string][] = [["approved", "موافقة", "check-circle"], ["approved_modified", "موافقة معدّلة", "alert"], ["rejected", "رفض", "x-circle"]];

export default function OutcomeForm({ action, amount, tenor }: { action: (fd: FormData) => Promise<void>; amount: number | null; tenor: number | null }) {
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState("approved");
  if (!open) return <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)}><Icon name="plus" className="size-3.5" />النتيجة</button>;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/35 backdrop-blur-[3px] animate-fade" onClick={() => setOpen(false)} />
      <form action={async (fd) => { await action(fd); setOpen(false); }} className="relative w-full max-w-xl rounded-[20px] bg-white border border-slate-200/80 p-6 max-h-[90vh] overflow-y-auto shadow-[0_30px_80px_-20px_rgba(20,28,24,.45)]" style={{ animation: "palette .22s var(--ease-out) both" }}>
        <h3 className="font-bold text-lg">نتيجة الجهة</h3>
        <p className="text-[13px] text-slate-500 mt-1 mb-5">كل نتيجة تحسّن تقديرات المنصة لهذه الجهة.</p>
        <div className="grid grid-cols-3 gap-2 mb-5">
          {DECISIONS.map(([k, l, ic]) => (
            <label key={k} className={`btn-ghost cursor-pointer ${decision === k ? "!border-brand-600 !bg-brand-50 !text-brand-800" : ""}`}>
              <input type="radio" name="decision" value={k} checked={decision === k} onChange={() => setDecision(k)} className="sr-only" /><Icon name={ic} className="size-4" />{l}
            </label>
          ))}
        </div>
        {decision !== "rejected" ? (
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div><label className="label">المبلغ المعتمد</label><input name="approved_amount" defaultValue={amount ?? ""} className="input num" inputMode="decimal" /></div>
            <div><label className="label">النسبة %</label><input name="approved_rate" className="input num" inputMode="decimal" /></div>
            <div><label className="label">المدة (شهر)</label><input name="approved_tenor" defaultValue={tenor ?? ""} className="input num" inputMode="numeric" /></div>
          </div>
        ) : (
          <div className="mb-5"><label className="label">سبب الرفض</label>
            <select name="reason" className="input">{Object.entries(REJECT_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </div>
        )}
        <label className="label">ما الذي اشترطته الجهة؟</label>
        <div className="flex flex-wrap gap-1.5 mb-5">
          {Object.entries(OUTCOME_CONDITIONS).map(([k, v]) => (
            <label key={k} className="inline-flex items-center rounded-lg border border-slate-200 px-2.5 h-8 text-xs font-medium cursor-pointer transition-colors has-[:checked]:bg-brand-50 has-[:checked]:border-brand-600 has-[:checked]:text-brand-800">
              <input type="checkbox" name="conditions" value={k} className="sr-only" />{v}
            </label>
          ))}
        </div>
        <label className="label">ملاحظة</label>
        <textarea name="note" rows={2} className="input mb-5" placeholder="استثناء، طريقة نجحت، اسم الموظف المختص" />
        <div className="flex gap-2"><button className="btn-primary">حفظ النتيجة</button><button type="button" className="btn-quiet" onClick={() => setOpen(false)}>إلغاء</button></div>
      </form>
    </div>
  );
}
