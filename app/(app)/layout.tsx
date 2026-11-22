import { requireUser, ROLE_LABEL, can } from "@/lib/auth";
import { logoutAction } from "@/app/actions";
import { Logo } from "@/components/logo";
import Nav from "@/components/nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  const items = [
    { href: "/", label: "لوحة المتابعة", icon: "grid" },
    { href: "/deals", label: "الصفقات", icon: "deal" },
    { href: "/clients", label: "العملاء", icon: "users" },
    { href: "/calculator", label: "الحاسبة السريعة", icon: "calc" },
    { href: "/lenders", label: "جهات التمويل", icon: "bank" },
    { href: "/knowledge", label: "خبرة الجهات", icon: "bulb" },
    ...(can(u, "user.manage") ? [{ href: "/users", label: "المستخدمون", icon: "shield" }] : []),
    ...(can(u, "audit.view") ? [{ href: "/audit", label: "سجل التدقيق", icon: "log" }] : []),
  ];
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[250px_1fr]">
      <aside className="no-print lg:sticky lg:top-0 lg:h-screen bg-white border-l border-slate-200/80 flex flex-col">
        <div className="p-5 flex items-center justify-between"><Logo /><div className="lg:hidden flex gap-2"><a href="/account" className="btn-ghost btn-sm">حسابي</a><form action={logoutAction}><button className="btn-ghost btn-sm">خروج</button></form></div></div>
        <Nav items={items} />
        <div className="mt-auto p-4 border-t border-slate-100 hidden lg:block">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-full bg-brand-100 text-brand-800 grid place-items-center font-bold">{u.name.slice(0, 1)}</div>
            <div className="min-w-0 flex-1"><div className="text-sm font-semibold truncate">{u.name}</div><div className="text-xs text-slate-500">{ROLE_LABEL[u.role]} · <a href="/account" className="text-brand-700 hover:underline">حسابي</a></div></div>
          </div>
          <form action={logoutAction}><button className="btn-ghost btn-sm w-full mt-3">تسجيل الخروج</button></form>
        </div>
      </aside>
      <main className="p-4 sm:p-6 lg:p-8 max-w-[1400px] w-full">
        {process.env.VERCEL && <div className="no-print mb-5 rounded-xl bg-amber-50 ring-1 ring-amber-200 px-4 py-2.5 text-xs text-amber-900">نسخة عرض تجريبية: كل البيانات وهمية، وقد تعود للوضع الافتراضي عند إعادة تشغيل الخادم. لا تُدخل بيانات عملاء حقيقية.</div>}
        {children}
      </main>
    </div>
  );
}
