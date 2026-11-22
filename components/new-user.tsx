"use client";
import { useActionState } from "react";
import { createUser } from "@/app/actions";

export default function NewUserForm() {
  const [s, a, p] = useActionState(createUser, undefined);
  return (
    <form action={a} className="grid sm:grid-cols-5 gap-3">
      <input name="name" placeholder="الاسم" className="input" required />
      <input name="email" type="email" placeholder="البريد" className="input text-left" dir="ltr" required />
      <select name="role" className="input" defaultValue="officer"><option value="officer">مسؤول علاقة</option><option value="analyst">محلل ائتماني</option><option value="viewer">مطّلع</option><option value="admin">مدير النظام</option></select>
      <input name="password" type="password" placeholder="كلمة مرور (6 خانات أو أكثر)" className="input" required />
      <button className="btn-primary" disabled={p}>إضافة</button>
      {s?.error && <div className="sm:col-span-5 text-sm text-rose-700">{s.error}</div>}
      {s?.ok && <div className="sm:col-span-5 text-sm text-emerald-700">{s.ok}</div>}
    </form>
  );
}
