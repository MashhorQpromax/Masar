"use client";
import { useState } from "react";
import { OUTCOME_CONDITIONS, REJECT_REASONS } from "@/lib/labels";

export default function OutcomeForm({ action, amount, tenor }: { action: (fd: FormData) => Promise<void>; amount: number | null; tenor: number | null }) {
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState("approved");
  if (!open) return <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)}>+ سجّل النتيجة</button>;
  return (
    <div className="fixed inset-0 z-40 bg-slate-900/40 grid place-items-center p-4" onClick={() => setOpen(false)}>
      <form action={async (fd) => { await action(fd); setOpen(false); }} className="card w-full max-w-xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold">نتيجة الجهة الفعلية</h3>
        <p className="text-xs text-slate-500 mt-1 mb-4">كل نتيجة تُسجَّل تعلّم المنصة: نسبة القبول، الفرق بين تقديرنا والواقع، والاشتراطات التي تطلبها كل جهة.</p>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[["approved", "✅ موافقة"], ["approved_modified", "🟡 موافقة معدّلة"], ["rejected", "❌ رفض"]].map(([k, l]) => (
            <label key={k} className={`btn-ghost cursor-pointer ${decision === k ? "!border-brand-500 !bg-brand-50 text-brand-800" : ""}`}>
              <input type="radio" name="decision" value={k} checked={decision === k} onChange={() => setDecision(k)} className="sr-only" />{l}
            </label>
          ))}
        </div>
        {decision !== "rejected" ? (
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div><label className="label">المبلغ المعتمد</label><input name="approved_amount" defaultValue={amount ?? ""} className="input" inputMode="decimal" /></div>
            <div><label className="label">النسبة %</label><input name="approved_rate" className="input" inputMode="decimal" /></div>
            <div><label className="label">المدة (شهر)</label><input name="approved_tenor" defaultValue={tenor ?? ""} className="input" inputMode="numeric" /></div>
          </div>
        ) : (
          <div className="mb-4"><label className="label">سبب الرفض</label>
            <select name="reason" className="input">{Object.entries(REJECT_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </div>
        )}
        <label className="label">ما الذي طلبته الجهة / اشترطته؟</label>
        <div className="flex flex-wrap gap-2 mb-4">
          {Object.entries(OUTCOME_CONDITIONS).map(([k, v]) => (
            <label key={k} className="inline-flex items-center gap-1.5 rounded-full ring-1 ring-slate-200 px-3 py-1 text-xs cursor-pointer has-[:checked]:bg-brand-50 has-[:checked]:ring-brand-500">
              <input type="checkbox" name="conditions" value={k} className="accent-brand-600" />{v}
            </label>
          ))}
        </div>
        <label className="label">ملاحظة (طريقة غير متوقعة، استثناء، اسم الموظف…)</label>
        <textarea name="note" rows={2} className="input mb-4" />
        <div className="flex gap-2"><button className="btn-primary">حفظ النتيجة</button><button type="button" className="btn-ghost" onClick={() => setOpen(false)}>إلغاء</button></div>
      </form>
    </div>
  );
}
