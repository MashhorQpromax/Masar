"use client";
import { useActionState } from "react";
import { loginAction } from "@/app/actions";

export default function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <div><label className="label">البريد الإلكتروني</label><input name="email" type="email" dir="ltr" required className="input text-left" autoComplete="username" defaultValue="admin@masar.local" /></div>
      <div><label className="label">كلمة المرور</label><input name="password" type="password" dir="ltr" required className="input text-left" autoComplete="current-password" /></div>
      {state?.error && <div className="text-sm text-rose-700 bg-rose-50 rounded-lg px-3 py-2">{state.error}</div>}
      <button className="btn-primary w-full h-11" disabled={pending}>{pending ? "جارٍ الدخول…" : "دخول"}</button>
    </form>
  );
}
