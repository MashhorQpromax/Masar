"use client";

import { useActionState, useEffect, useId, useState, type ReactNode } from "react";
import { signInError } from "@/copy/auth";
import { digitsOf } from "@/domain/shared/phone";
import { EyeIcon, EyeOffIcon } from "@/ui/icons";
import { SubmitButton } from "@/ui/SubmitButton";
import { signIn, signInByCode, signInSecond } from "./actions";

/** The two ways in that the form offers. A passkey button joins them when passkeys are ported. */
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

export function LoginForm({ demo }: { demo: boolean }) {
  const [way, setWay] = useState<Way>("password");
  const [email, setEmail] = useState("");
  const [remember, setRemember] = useState(true);
  const [shown, setShown] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const [first, firstAction] = useActionState(signIn, undefined);
  const [second, secondAction] = useActionState(signInSecond, undefined);
  const [byCode, codeAction] = useActionState(signInByCode, undefined);
  const emailId = useId();
  const passwordId = useId();

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
          className="field-input login-ltr"
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
        <Heading title="أهلاً بعودتك">ادخل بالرمز من تطبيق المصادقة.</Heading>
        {emailField}
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
    <form action={firstAction} className="login-form" key="password">
      <Heading title="أهلاً بعودتك">ادخل لتكمل الطريق.</Heading>
      {emailField}
      <div className="field">
        <label className="field-label" htmlFor={passwordId}>
          كلمة المرور
        </label>
        <div className="field-box">
          <input
            id={passwordId}
            name="password"
            type={shown ? "text" : "password"}
            className="field-input login-ltr"
            dir="ltr"
            autoComplete="current-password"
            maxLength={200}
            required={!demo}
          />
          <button type="button" className="login-eye" aria-label={shown ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"} aria-pressed={shown} onClick={() => setShown((now) => !now)}>
            {shown ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
      </div>
      {rememberField}
      <Refused text={refused ? signInError(refused, "password") : null} />
      <SubmitButton className="btn btn--coral">ادخل</SubmitButton>
      {demoNote}
      <button type="button" className="login-switch" onClick={() => setWay("code")}>
        ادخل برمز بدل كلمة المرور
      </button>
    </form>
  );
}
