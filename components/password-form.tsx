"use client";
import { useActionState } from "react";
import { changePasswordAction } from "@/app/actions";

export default function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <div><label className="label">كلمة المرور الحالية</label><input name="current" type="password" dir="ltr" required className="input text-left" autoComplete="current-password" /></div>
      <div><label className="label">كلمة المرور الجديدة</label><input name="next" type="password" dir="ltr" required minLength={6} className="input text-left" autoComplete="new-password" /></div>
      <div><label className="label">تأكيد كلمة المرور الجديدة</label><input name="confirm" type="password" dir="ltr" required minLength={6} className="input text-left" autoComplete="new-password" /></div>
      {state?.error && <div className="text-sm text-rose-700 bg-rose-50 rounded-lg px-3 py-2">{state.error}</div>}
      {state?.ok && <div className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{state.ok}</div>}
      <button className="btn-primary" disabled={pending}>{pending ? "جارٍ الحفظ…" : "حفظ"}</button>
    </form>
  );
}
