"use client";
import { useActionState, useState } from "react";
import { loginAction } from "@/app/actions";

export default function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="space-y-4">
      <div><label className="label">البريد الإلكتروني</label><input name="email" type="email" dir="ltr" required autoFocus className="input text-left" autoComplete="username" inputMode="email" autoCapitalize="none" /></div>
      <div>
        <label className="label">كلمة المرور</label>
        <div className="relative">
          <input name="password" type={show ? "text" : "password"} dir="ltr" required className="input text-left pe-16" autoComplete="current-password" />
          <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 end-2 my-auto h-7 px-2 text-xs font-semibold text-brand-700">{show ? "إخفاء" : "إظهار"}</button>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" name="remember" value="1" defaultChecked /> تذكرني على هذا الجهاز لمدة 30 يوماً</label>
      {state?.error && <div className="text-sm text-rose-700 bg-rose-50 rounded-lg px-3 py-2">{state.error}</div>}
      <button className="btn-primary w-full h-11" disabled={pending}>{pending ? "جارٍ الدخول…" : "دخول"}</button>
    </form>
  );
}
