"use client";
import { useActionState } from "react";
import { createUser } from "@/app/actions";

export default function NewUserForm() {
  const [s, a, p] = useActionState(createUser, undefined);
  return (
    <form action={a} className="grid sm:grid-cols-2 lg:grid-cols-[1fr_1.2fr_1fr_1fr_auto] gap-3 items-end">
      <div><label className="label">الاسم</label><input name="name" className="input" required /></div>
      <div><label className="label">البريد</label><input name="email" type="email" className="input text-left" dir="ltr" required /></div>
      <div><label className="label">الدور</label><select name="role" className="input" defaultValue="officer"><option value="officer">مسؤول علاقة</option><option value="analyst">محلل ائتماني</option><option value="viewer">مطّلع</option><option value="admin">مدير النظام</option></select></div>
      <div><label className="label">كلمة المرور</label><input name="password" type="password" minLength={6} className="input" required autoComplete="new-password" /></div>
      <button className="btn-primary" disabled={p}>إضافة</button>
      {s?.error && <div className="sm:col-span-2 lg:col-span-5 text-[13px] text-rose-700">{s.error}</div>}
      {s?.ok && <div className="sm:col-span-2 lg:col-span-5 text-[13px] text-emerald-700">{s.ok}</div>}
    </form>
  );
}
