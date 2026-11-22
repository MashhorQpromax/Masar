"use client";
import { useActionState, useEffect, useState, useTransition } from "react";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { codeLoginAction, loginAction, passkeyLoginOptionsAction, passkeyLoginVerifyAction, secondFactorAction, sendCodeAction } from "@/app/auth-actions";
import { Icon } from "@/components/icon";
import { CodeInput } from "@/components/code-input";

export default function LoginForm({ waOtp }: { waOtp: boolean }) {
  const [mode, setMode] = useState<"password" | "code">("password");
  const [stage, setStage] = useState<"main" | "totp">("main");
  const [remember, setRemember] = useState(true);
  const [email, setEmail] = useState("");
  const [show, setShow] = useState(false);
  const [pw, pwAction, pwPending] = useActionState(loginAction, undefined);
  const [tf, tfAction, tfPending] = useActionState(secondFactorAction, undefined);
  const [cd, cdAction, cdPending] = useActionState(codeLoginAction, undefined);
  const [canPk, setCanPk] = useState(false);
  const [pkErr, setPkErr] = useState<string | null>(null);
  const [pkBusy, startPk] = useTransition();
  const [sent, setSent] = useState(false);
  const [sending, startSend] = useTransition();

  useEffect(() => setCanPk(browserSupportsWebAuthn()), []);
  useEffect(() => { if (pw?.step === "totp") setStage("totp"); }, [pw]);
  useEffect(() => { if (tf && !tf.step) setStage("main"); }, [tf]);

  const passkey = () => startPk(async () => {
    setPkErr(null);
    const o = await passkeyLoginOptionsAction();
    if (!("options" in o) || !o.options) { setPkErr(("error" in o && o.error) || "تعذر البدء"); return; }
    try {
      const resp = await startAuthentication({ optionsJSON: o.options });
      const r = await passkeyLoginVerifyAction(resp, remember);
      if (r.ok) window.location.assign("/"); else setPkErr(r.error ?? "تعذر الدخول");
    } catch (e) {
      if ((e as Error).name !== "NotAllowedError" && (e as Error).name !== "AbortError") setPkErr("تعذر استخدام مفتاح المرور على هذا الجهاز.");
    }
  });
  const sendCode = () => startSend(async () => { await sendCodeAction(email); setSent(true); });

  const Remember = <input type="hidden" name="remember" value={remember ? "1" : "0"} />;
  const Err = ({ t }: { t?: string | null }) => t ? <div key={t} role="alert" className="shake flex gap-2 text-[13px] text-rose-700 bg-rose-50 rounded-[10px] px-3 py-2.5 leading-6"><Icon name="alert" className="size-4 mt-1" />{t}</div> : null;

  if (stage === "totp") {
    return (
      <form action={tfAction} className="space-y-4 animate-rise">
        <div className="flex items-center gap-3">
          <span className="size-10 rounded-xl bg-brand-50 text-brand-700 grid place-items-center"><Icon name="shield" className="size-5" /></span>
          <div><div className="font-bold">رمز تطبيق المصادقة</div><div className="text-[13px] text-slate-500">ستة أرقام من التطبيق</div></div>
        </div>
        <CodeInput autoFocus />
        <Err t={tf?.error} />
        <button className="btn-primary w-full !h-11" disabled={tfPending}>{tfPending ? "جارٍ التحقق" : "دخول"}</button>
        <button type="button" className="btn-quiet w-full" onClick={() => setStage("main")}><Icon name="arrow-right" className="size-4" />رجوع</button>
      </form>
    );
  }

  return (
    <div className="space-y-5">
      {canPk && (
        <>
          <button type="button" onClick={passkey} disabled={pkBusy} className="btn-ghost w-full !h-12 !rounded-[13px] !text-[15px] group">
            <Icon name="fingerprint" className="size-5 text-brand-700 transition-transform group-hover:scale-110" />{pkBusy ? "بانتظار جهازك" : "الدخول بالبصمة"}
          </button>
          <Err t={pkErr} />
          <div className="flex items-center gap-3 text-[11px] text-slate-400"><span className="h-px flex-1 bg-slate-200" />أو<span className="h-px flex-1 bg-slate-200" /></div>
        </>
      )}

      <div className="seg w-full">
        <button type="button" onClick={() => setMode("password")} className={`seg-item flex-1 justify-center ${mode === "password" ? "seg-on" : ""}`}>كلمة المرور</button>
        <button type="button" onClick={() => setMode("code")} className={`seg-item flex-1 justify-center ${mode === "code" ? "seg-on" : ""}`}>رمز تحقق</button>
      </div>

      {mode === "password" ? (
        <form action={pwAction} className="space-y-4" key="pw">
          {Remember}
          <div><label className="label">البريد</label><input name="email" type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} className="input !h-11 text-left" autoComplete="username webauthn" inputMode="email" autoCapitalize="none" /></div>
          <div>
            <label className="label">كلمة المرور</label>
            <div className="relative">
              <input name="password" type={show ? "text" : "password"} dir="ltr" required className="input !h-11 text-left pe-11" autoComplete="current-password" />
              <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "إخفاء" : "إظهار"} className="absolute inset-y-0 end-1.5 my-auto size-8 grid place-items-center rounded-lg text-slate-400 hover:text-ink hover:bg-slate-100 transition-colors"><Icon name={show ? "lock" : "eye"} className="size-4" /></button>
            </div>
          </div>
          <Err t={pw?.error ?? (tf && !tf.step ? tf.error : null)} />
          <button className="btn-primary w-full !h-11" disabled={pwPending}>{pwPending ? "جارٍ الدخول" : "دخول"}</button>
        </form>
      ) : (
        <form action={cdAction} className="space-y-4 animate-fade" key="code">
          {Remember}
          <div><label className="label">البريد</label><input name="email" type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} className="input !h-11 text-left" autoComplete="username" inputMode="email" autoCapitalize="none" /></div>
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <label className="label !mb-0">الرمز</label>
              {waOtp && <button type="button" onClick={sendCode} disabled={sending || !/^\S+@\S+\.\S+$/.test(email)} className="text-xs font-semibold text-brand-700 hover:text-brand-900 disabled:text-slate-400 inline-flex items-center gap-1.5"><Icon name="chat" className="size-3.5" />{sending ? "جارٍ الإرسال" : sent ? "إعادة الإرسال" : "أرسله على واتساب"}</button>}
            </div>
            <CodeInput />
            <p className="text-xs text-slate-500 mt-2 leading-5">{sent ? "إن كان بريدك مسجلاً بجوال فالرمز في واتساب الآن، وصالح 5 دقائق." : waOtp ? "من واتساب أو من تطبيق المصادقة." : "من تطبيق المصادقة."}</p>
          </div>
          <Err t={cd?.error} />
          <button className="btn-primary w-full !h-11" disabled={cdPending}>{cdPending ? "جارٍ التحقق" : "دخول"}</button>
        </form>
      )}

      <label className="flex items-center gap-2 text-[13px] text-slate-500"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4 accent-brand-700" />تذكرني 30 يوماً</label>
    </div>
  );
}
