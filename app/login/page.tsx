import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import LoginForm from "./form";
import { Logo } from "@/components/logo";

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between bg-brand-900 text-white p-12 relative overflow-hidden">
        <div className="absolute -left-24 -bottom-24 size-[28rem] rounded-full bg-brand-700/40 blur-2xl" />
        <div className="absolute left-20 top-24 size-40 rounded-full border border-gold/30" />
        <Logo light />
        <div className="relative">
          <h2 className="text-4xl font-bold leading-snug">من أول مكالمة<br />إلى صرف التمويل.</h2>
          <p className="mt-4 text-brand-100/80 max-w-md leading-7">ملف واحد لكل عميل، دراسة أهلية فورية وفق ضوابط ساما، ومطابقة ذكية مع جهات التمويل.</p>
          <div className="mt-8 grid grid-cols-3 gap-4 max-w-md text-sm">
            {[["33.33%", "حد الاستقطاع"], ["13", "منتجاً تمويلياً"], ["5", "مراحل للطلب"]].map(([a, b]) => (
              <div key={b} className="rounded-xl bg-white/5 ring-1 ring-white/10 p-3"><div className="text-xl font-bold text-gold num text-start">{a}</div><div className="text-brand-100/70 text-xs mt-1">{b}</div></div>
            ))}
          </div>
        </div>
        <div className="text-xs text-brand-100/50 relative">بيانات العملاء محمية ومسجلة الوصول — نظام حماية البيانات الشخصية</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8"><Logo /></div>
          <h1 className="text-2xl font-bold">تسجيل الدخول</h1>
          <p className="text-sm text-slate-500 mt-1 mb-8">ادخل ببريدك في الشركة</p>
          <LoginForm />
          <div className="mt-8 rounded-xl bg-amber-50 ring-1 ring-amber-200 p-3 text-xs text-amber-900 leading-6">
            نسخة تجريبية: <span className="num">admin@masar.local</span> / <span className="num">Masar@2026</span><br />وأيضاً analyst@ و officer@ و viewer@ بنفس كلمة المرور.
          </div>
        </div>
      </div>
    </div>
  );
}

