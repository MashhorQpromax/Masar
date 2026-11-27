import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { waOtpReady } from "@/lib/auth-methods";
import LoginForm from "./form";
import { Logo } from "@/components/logo";
import { HeroArt } from "@/components/art";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  return (
    <div className="min-h-dvh grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] bg-sheet">
      <div className="flex flex-col px-6 py-8 sm:px-10 lg:py-10">
        <Logo />
        <div className="flex-1 grid place-items-center py-10">
          <div className="w-full max-w-[360px] animate-rise">
            <h1 className="text-[30px] font-bold leading-tight">أهلاً بعودتك</h1>
            <p className="text-sm text-slate-500 mt-1.5 mb-8">ادخل بالطريقة التي تناسبك.</p>
            <LoginForm waOtp={waOtpReady()} />
          </div>
        </div>
        <div className="text-[11px] text-slate-400">كل دخول يُسجَّل لحماية بيانات العملاء.</div>
      </div>
      <div className="relative hidden lg:block overflow-hidden bg-canvas m-3 rounded-[26px]">
        <HeroArt className="absolute inset-0 size-full" />
        <div className="absolute top-10 inset-x-10 animate-fade" style={{ animationDelay: ".3s" }}>
          <div className="font-display text-[34px] font-bold leading-[1.35] text-[#f3ead6] max-w-sm">من أول مكالمة<br />إلى صرف التمويل.</div>
        </div>
      </div>
    </div>
  );
}
