"use client";
import { useActionState } from "react";
import { changePasswordAction } from "@/app/actions";

export default function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, undefined);
  return (
    <form action={action} className="space-y-3.5">
      <div><label className="label">الحالية</label><input name="current" type="password" dir="ltr" required className="input text-left" autoComplete="current-password" /></div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><label className="label">الجديدة</label><input name="next" type="password" dir="ltr" required minLength={6} className="input text-left" autoComplete="new-password" /></div>
        <div><label className="label">تأكيدها</label><input name="confirm" type="password" dir="ltr" required minLength={6} className="input text-left" autoComplete="new-password" /></div>
      </div>
      {state?.error && <div className="text-[13px] text-rose-700">{state.error}</div>}
      {state?.ok && <div className="text-[13px] text-emerald-700">{state.ok}</div>}
      <button className="btn-primary" disabled={pending}>{pending ? "جارٍ الحفظ" : "حفظ"}</button>
    </form>
  );
}
