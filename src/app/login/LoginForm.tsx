"use client";

import { useActionState, useEffect, useId, useState, useTransition, type ReactNode } from "react";
import { passkeyProblem, signInError } from "@/copy/auth";
import { digitsOf } from "@/domain/shared/phone";
import { FingerprintIcon } from "@/ui/icons";
import { PasswordField } from "@/ui/PasswordField";
import { SubmitButton } from "@/ui/SubmitButton";
import { askCode, passkeyFinish, passkeyStart, signIn, signInByCode, signInSecond } from "./actions";

/** How long before another code may be asked for from the same form. */
const ASK_AGAIN_MS = 60_000;

/** The two ways in that are typed. The fingerprint is a third, and is a button of its own. */
type Way = "password" | "code";

function Refused({ text }: { text: string | null }) {
  return text ? (
    <p key={text} role="alert" className="login-error">
      {text}
    </p>
  ) : null;
}

function Heading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="login-head">
      <h1 className="login-title">{title}</h1>
      <p className="login-lede">{children}</p>
    </div>
  );
}

function CodeField({ send, autoFocus, required }: { send?: boolean; autoFocus?: boolean; required: boolean }) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        الرمز
      </label>
      <div className="field-box">
        <input
          id={id}
          name="code"
          className="field-input num login-code"
          dir="ltr"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={12}
          placeholder="000000"
          required={required}
          autoFocus={autoFocus}
          // Six digits are the whole answer: send them without making the person reach for the button.
          onInput={send ? (event) => digitsOf(event.currentTarget.value).length === 6 && event.currentTarget.form?.requestSubmit() : undefined}
        />
      </div>
    </div>
  );
}

export function LoginForm({ demo, passkeys, byWhatsapp }: { demo: boolean; passkeys: boolean; byWhatsapp: boolean }) {
  const [way, setWay] = useState<Way>("password");
  const [email, setEmail] = useState("");
  const [remember, setRemember] = useState(true);
  const [awaiting, setAwaiting] = useState(false);
  const [first, firstAction] = useActionState(signIn, undefined);
  const [second, secondAction] = useActionState(signInSecond, undefined);
  const [byCode, codeAction] = useActionState(signInByCode, undefined);
  const emailId = useId();
  const [canKey, setCanKey] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [keyRefused, setKeyRefused] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  const [asking, startAsking] = useTransition();

  /** Asks for a code on WhatsApp. The answer is the same whether the email has an account or not. */
  function askForCode() {
    startAsking(async () => {
      await askCode(email);
      setAsked(true);
      setTimeout(() => setAsked(false), ASK_AGAIN_MS);
    });
  }

  useEffect(() => {
    setCanKey(passkeys && typeof window.PublicKeyCredential === "function");
  }, [passkeys]);

  /** The device asks for a fingerprint, a face or its own lock, and its answer says who is there. */
  async function enterByFingerprint() {
    setKeyRefused(null);
    setWaiting(true);
    try {
      const asked = await passkeyStart(remember);
      if (!asked.options) return setKeyRefused(signInError(asked.error ?? "BAD_PASSKEY"));
      let answer;
      try {
        const { startAuthentication } = await import("@simplewebauthn/browser");
        answer = await startAuthentication({ optionsJSON: asked.options });
      } catch (error) {
        return setKeyRefused(passkeyProblem(error, "enter"));
      }
      const result = await passkeyFinish(answer);
      if (result?.error) setKeyRefused(signInError(result.error));
    } finally {
      setWaiting(false);
    }
  }

  useEffect(() => {
    if (first?.second) setAwaiting(true);
  }, [first]);
  useEffect(() => {
    if (second && !second.second) setAwaiting(false);
  }, [second]);

  if (awaiting) {
    return (
      <form action={secondAction} className="login-form" key="second">
        <Heading title="خطوة أخيرة">اكتب الأرقام الستة من تطبيق المصادقة.</Heading>
        <CodeField send autoFocus required />
        <Refused text={second?.error ? signInError(second.error, "second") : null} />
        <SubmitButton className="btn btn--coral">ادخل</SubmitButton>
        <button type="button" className="login-switch" onClick={() => setAwaiting(false)}>
          رجوع
        </button>
      </form>
    );
  }

  const emailField = (
    <div className="field">
      <label className="field-label" htmlFor={emailId}>
        البريد
      </label>
      <div className="field-box">
        <input
          id={emailId}
          name="email"
          type="email"
          className="field-input field-ltr"
          dir="ltr"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={200}
          required={!demo}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
    </div>
  );
  const rememberField = (
    <label className="check">
      <input type="checkbox" name="remember" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
      <span>تذكرني على هذا الجهاز</span>
    </label>
  );
  const demoNote = demo && <p className="login-note">عرض تجريبي: اضغط «ادخل» لفتح البيانات التجريبية.</p>;

  if (way === "code") {
    return (
      <form action={codeAction} className="login-form" key="code">
        <Heading title="أهلاً بعودتك">{byWhatsapp ? "ادخل برمز يصلك على واتساب، أو بالرمز من تطبيق المصادقة." : "ادخل بالرمز من تطبيق المصادقة."}</Heading>
        {emailField}
        {byWhatsapp && (
          <button type="button" className="btn btn--white" disabled={asking || asked || !email.trim()} aria-busy={asking} onClick={askForCode}>
            {asked ? "طلبنا لك الرمز" : "أرسل الرمز إلى واتساب"}
          </button>
        )}
        {asked && (
          <p role="status" className="login-note">
            إن كان لهذا البريد حساب برقم جوال، يصله الرمز من رقم الشركة خلال لحظات. صالح 5 دقائق.
          </p>
        )}
        <CodeField required={!demo} />
        {rememberField}
        <Refused text={byCode?.error ? signInError(byCode.error, "code") : null} />
        <SubmitButton className="btn btn--coral">ادخل</SubmitButton>
        {demoNote}
        <button type="button" className="login-switch" onClick={() => setWay("password")}>
          ادخل بكلمة المرور
        </button>
      </form>
    );
  }

  const refused = first?.error ?? (second && !second.second ? second.error : undefined);
  return (
    <form action={firstAction} className="login-form" key="password" onSubmit={() => setKeyRefused(null)}>
      <Heading title="أهلاً بعودتك">ادخل لتكمل الطريق.</Heading>
      {emailField}
      <PasswordField label="كلمة المرور" name="password" autoComplete="current-password" required={!demo} />
      {rememberField}
      <Refused text={keyRefused ?? (refused ? signInError(refused, "password") : null)} />
      <SubmitButton className="btn btn--coral">ادخل</SubmitButton>
      {canKey && (
        <button type="button" className="btn btn--white" disabled={waiting} aria-busy={waiting} onClick={enterByFingerprint}>
          <FingerprintIcon />
          {waiting ? "بانتظار جهازك" : "ادخل بالبصمة"}
        </button>
      )}
      {demoNote}
      <button type="button" className="login-switch" onClick={() => setWay("code")}>
        ادخل برمز بدل كلمة المرور
      </button>
    </form>
  );
}
