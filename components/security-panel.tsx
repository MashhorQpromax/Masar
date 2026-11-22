"use client";
import { useActionState, useState, useTransition } from "react";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import {
  confirmIdentityAction, passkeyDeleteAction, passkeyRegisterOptionsAction, passkeyRegisterVerifyAction, savePhoneAction, totpBeginAction, totpConfirmAction, totpDisableAction,
} from "@/app/auth-actions";
import { Icon } from "@/components/icon";
import { Badge, dateAr } from "@/components/ui";
import { CodeInput } from "@/components/code-input";

type State = { phone: string | null; totp: boolean; codeLocked: boolean; passkeys: { id: number; name: string | null; created_at: string; last_used_at: string | null }[]; waReady: boolean };

export default function SecurityPanel({ state, unlocked }: { state: State; unlocked: boolean }) {
  const [sudo, sudoAction, sudoPending] = useActionState(confirmIdentityAction, undefined);
  const [phone, phoneAction, phonePending] = useActionState(savePhoneAction, undefined);
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [enroll, setEnroll] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [dropTotp, setDropTotp] = useState(false);

  const addPasskey = () => start(async () => {
    setMsg(null);
    if (!browserSupportsWebAuthn()) { setMsg({ error: "هذا المتصفح لا يدعم مفاتيح المرور." }); return; }
    const o = await passkeyRegisterOptionsAction();
    if (!("options" in o) || !o.options) { setMsg({ error: ("error" in o && o.error) || "تعذر البدء" }); return; }
    try { setMsg(await passkeyRegisterVerifyAction(await startRegistration({ optionsJSON: o.options }))); }
    catch (e) { setMsg((e as Error).name === "InvalidStateError" ? { error: "هذا الجهاز مسجل من قبل." } : (e as Error).name === "NotAllowedError" ? null : { error: "تعذر إنشاء المفتاح على هذا الجهاز." }); }
  });
  const beginTotp = () => start(async () => {
    setMsg(null);
    const r = await totpBeginAction();
    if (r.secret && r.qr) { setEnroll({ secret: r.secret, qr: r.qr }); setCode(""); } else setMsg({ error: r.error ?? "تعذر البدء" });
  });
  const confirmTotp = () => start(async () => {
    const r = await totpConfirmAction(code);
    setMsg(r);
    if (r.ok) setEnroll(null);
  });

  return (
    <div className="space-y-4">
      {!unlocked ? (
        <form action={sudoAction} className="card p-4 sm:p-5 flex flex-wrap items-center gap-3">
          <span className="size-9 rounded-[10px] bg-slate-100 text-slate-600 grid place-items-center"><Icon name="lock" className="size-[18px]" /></span>
          <div className="flex-1 min-w-40"><div className="font-semibold text-sm">التعديل مقفل</div><div className="text-xs text-slate-500">أكّد كلمة المرور لتعديل طرق الدخول.</div></div>
          <input name="password" type="password" dir="ltr" required placeholder="كلمة المرور" autoComplete="current-password" className="input w-full sm:w-52 text-left placeholder:text-right" />
          <button className="btn-primary" disabled={sudoPending}>{sudoPending ? "جارٍ التحقق" : "فتح"}</button>
          {sudo?.error && <div className="basis-full text-[13px] text-rose-700">{sudo.error}</div>}
        </form>
      ) : (
        <div className="flex items-center gap-2 text-[13px] text-emerald-700 animate-fade"><Icon name="unlock" className="size-4" />التعديل مفتوح لعشر دقائق.</div>
      )}
      {msg && (msg.error || msg.ok) && <div className={`text-[13px] rounded-[10px] px-3 py-2.5 ${msg.error ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"}`}>{msg.error ?? msg.ok}</div>}

      <div className="card divide-y divide-slate-100">
        {/* مفتاح المرور */}
        <section className="p-5">
          <Head icon="fingerprint" title="مفتاح المرور" sub="بصمة الوجه أو الإصبع أو قفل الجهاز." badge={state.passkeys.length ? <Badge tone="green" dot>{state.passkeys.length === 1 ? "جهاز واحد" : `${state.passkeys.length} أجهزة`}</Badge> : <Badge>غير مفعّل</Badge>}>
            <button type="button" className="btn-ghost btn-sm" onClick={addPasskey} disabled={!unlocked || busy}><Icon name="plus" className="size-3.5" />إضافة هذا الجهاز</button>
          </Head>
          {state.passkeys.length > 0 && (
            <ul className="mt-4 space-y-2">
              {state.passkeys.map((p) => (
                <li key={p.id} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm">
                  <Icon name="mobile" className="size-4 text-slate-400" />
                  <div className="flex-1 min-w-0"><div className="font-medium truncate">{p.name ?? "جهاز"}</div><div className="text-[11px] text-slate-500">أُضيف {dateAr(p.created_at)}{p.last_used_at ? ` · آخر دخول ${dateAr(p.last_used_at)}` : ""}</div></div>
                  <button type="button" className="btn-quiet btn-sm !text-rose-700" disabled={!unlocked || busy} onClick={() => start(async () => setMsg(await passkeyDeleteAction(p.id)))} aria-label="حذف"><Icon name="trash" className="size-4" /></button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* تطبيق المصادقة */}
        <section className="p-5">
          <Head icon="shield" title="تطبيق المصادقة" sub="رمز يتجدد كل 30 ثانية من Google Authenticator أو ما يشبهه." badge={state.totp ? <Badge tone="green" dot>مفعّل</Badge> : <Badge>غير مفعّل</Badge>}>
            {state.totp
              ? (dropTotp
                ? <button type="button" className="btn-danger btn-sm" disabled={!unlocked || busy} onClick={() => start(async () => { setMsg(await totpDisableAction()); setDropTotp(false); })}>تأكيد الإيقاف</button>
                : <button type="button" className="btn-quiet btn-sm" disabled={!unlocked || busy} onClick={() => setDropTotp(true)}>إيقاف</button>)
              : !enroll && <button type="button" className="btn-ghost btn-sm" disabled={!unlocked || busy} onClick={beginTotp}>تفعيل</button>}
          </Head>
          {enroll && (
            <div className="mt-4 grid sm:grid-cols-[168px_minmax(0,1fr)] gap-5 items-start animate-rise">
              <div className="rounded-2xl border border-slate-200/70 bg-white p-3 [&_svg]:w-full [&_svg]:h-auto" dangerouslySetInnerHTML={{ __html: enroll.qr }} />
              <div className="space-y-3">
                <ol className="text-[13px] text-slate-600 space-y-1 list-decimal ps-4 leading-6"><li>امسح المربع من تطبيق المصادقة.</li><li>اكتب الرمز الظاهر في التطبيق.</li></ol>
                <details className="group text-xs text-slate-500"><summary className="cursor-pointer list-none inline-flex items-center gap-1 hover:text-ink"><Icon name="chevron-down" className="size-3.5 transition-transform group-open:rotate-180" />إدخال يدوي</summary><code dir="ltr" className="mt-2 block rounded-lg bg-slate-100 px-3 py-2 text-[12px] tracking-wider break-all select-all text-left">{enroll.secret.replace(/(.{4})/g, "$1 ").trim()}</code></details>
                <div className="max-w-56"><CodeInput value={code} onChange={setCode} /></div>
                <div className="flex gap-2">
                  <button type="button" className="btn-primary" disabled={busy || code.length !== 6} onClick={confirmTotp}>تأكيد</button>
                  <button type="button" className="btn-quiet" onClick={() => setEnroll(null)}>إلغاء</button>
                </div>
              </div>
            </div>
          )}
          {state.totp && state.codeLocked && <p className="mt-3 text-xs text-amber-700">الدخول بالرمز موقوف بعد محاولات خاطئة، ويعود تلقائياً بعد دخولك بكلمة المرور أو البصمة.</p>}
        </section>

        {/* واتساب */}
        <section className="p-5">
          <Head icon="chat" title="رمز على واتساب" sub="يصلك من رقم الشركة عند الدخول." badge={!state.waReady ? <Badge tone="amber">بانتظار ربط رقم الشركة</Badge> : state.phone ? <Badge tone="green" dot>مفعّل</Badge> : <Badge>أضف جوالك</Badge>} />
          <form action={phoneAction} className="mt-4 flex flex-wrap items-center gap-2">
            <div className="relative"><Icon name="phone" className="size-4 text-slate-400 absolute start-3 top-3 pointer-events-none" /><input name="phone" defaultValue={state.phone ?? ""} dir="ltr" inputMode="tel" placeholder="05xxxxxxxx" aria-label="جوال الدخول" className="input num pe-9 w-52" disabled={!unlocked} /></div>
            <button className="btn-ghost" disabled={!unlocked || phonePending}>حفظ</button>
            {phone?.error && <span className="text-[13px] text-rose-700">{phone.error}</span>}
            {phone?.ok && <span className="text-[13px] text-emerald-700 inline-flex items-center gap-1"><Icon name="check" className="size-4" />{phone.ok}</span>}
          </form>
        </section>
      </div>
    </div>
  );
}

function Head({ icon, title, sub, badge, children }: { icon: string; title: string; sub: string; badge?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
      <span className="size-10 shrink-0 rounded-xl bg-brand-50 text-brand-700 grid place-items-center"><Icon name={icon} className="size-5" /></span>
      <div className="flex-1 min-w-48"><div className="font-bold text-[15px] flex flex-wrap items-center gap-2">{title}{badge}</div><div className="text-[13px] text-slate-500 mt-0.5">{sub}</div></div>
      {children}
    </div>
  );
}
