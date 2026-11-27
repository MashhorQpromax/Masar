"use client";

import { useId, useState, type InputHTMLAttributes } from "react";
import { EyeIcon, EyeOffIcon } from "./icons";

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "id" | "className" | "dir">;

/** A password box with a button that shows what was typed. Passwords always read left to right. */
export function PasswordField({ label, hint, ...input }: { label: string; hint?: string } & InputProps) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="field-box">
        <input id={id} type={shown ? "text" : "password"} className="field-input field-ltr" dir="ltr" maxLength={200} {...input} />
        <button type="button" className="field-eye" aria-label={shown ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"} aria-pressed={shown} onClick={() => setShown((now) => !now)}>
          {shown ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}
