"use client";

import { useId, useLayoutEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { groupDigits, numberText } from "@/copy/format";

interface FieldProps {
  label: string;
  /** A short line under the field. */
  hint?: ReactNode;
  /** A unit shown inside the field, after the value. */
  suffix?: string;
  /** An amount in riyals. The unit shows where there is room for it; a narrow screen keeps the room for digits. */
  money?: boolean;
  wide?: boolean;
}

function Field({ id, label, hint, suffix, money, wide, children }: FieldProps & { id: string; children: ReactNode }) {
  return (
    <div className="field" data-wide={wide || undefined}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="field-box">
        {children}
        {money ? <span className="field-suffix" data-money>ريال</span> : suffix && <span className="field-suffix">{suffix}</span>}
      </div>
      {hint && <small className="field-hint">{hint}</small>}
    </div>
  );
}

const significant = (text: string): number => text.replace(/[^0-9.]/g, "").length;

/** Where the caret goes so that it stays after the same digit once separators moved. */
function caretAfter(text: string, digits: number): number {
  if (digits <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    if (/[0-9.]/.test(text[i]!)) seen++;
    if (seen === digits) return i + 1;
  }
  return text.length;
}

const shown = (value: number, decimals: number, grouped: boolean): string =>
  value.toLocaleString("en-US", { maximumFractionDigits: decimals, useGrouping: grouped });

/**
 * A number a person types. Thousands are separated while typing, digits from an Arabic keyboard are
 * accepted, and an empty field is `null`, which is different from zero.
 */
export function NumberField({
  value,
  onChange,
  decimals = 0,
  grouped = true,
  max,
  placeholder,
  disabled,
  ...field
}: FieldProps & {
  value: number | null;
  onChange: (value: number | null) => void;
  decimals?: number;
  grouped?: boolean;
  max?: number;
  placeholder?: string;
  /** Shown and not changeable: the person may see it and not set it. */
  disabled?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  /** The text while the person is typing. Kept apart from the value so "5." can be typed. */
  const [draft, setDraft] = useState<string | null>(null);
  const caret = useRef<number | null>(null);
  const text = draft ?? (value == null ? "" : shown(value, decimals, grouped));

  useLayoutEffect(() => {
    if (caret.current == null || !input.current) return;
    const at = caretAfter(text, caret.current);
    input.current.setSelectionRange(at, at);
    caret.current = null;
  });

  function typed(event: ChangeEvent<HTMLInputElement>) {
    const el = event.target;
    const before = el.value.slice(0, el.selectionStart ?? el.value.length);
    let plain = numberText(el.value, decimals);
    if (max != null && plain !== "" && Number(plain) > max) plain = String(max);
    caret.current = significant(numberText(before, decimals));
    setDraft(grouped ? groupDigits(plain) : plain);
    onChange(plain === "" ? null : Number(plain));
  }

  return (
    <Field id={id} {...field}>
      <input
        ref={input}
        id={id}
        className="field-input num"
        dir="ltr"
        inputMode={decimals ? "decimal" : "numeric"}
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        value={text}
        onChange={typed}
        onFocus={() => setDraft(text)}
        onBlur={() => setDraft(null)}
      />
    </Field>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  maxLength = 120,
  autoFocus,
  name,
  typed = "text",
  ...field
}: FieldProps & {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  autoFocus?: boolean;
  /** The name the value is sent under when the field sits in a form. */
  name?: string;
  /** What is typed: words, or something written left to right with its own keyboard. */
  typed?: "text" | "tel" | "digits" | "email" | "url";
}) {
  const id = useId();
  return (
    <Field id={id} {...field}>
      <input
        id={id}
        name={name}
        className={typed === "text" ? "field-input" : "field-input num"}
        dir={typed === "text" ? undefined : "ltr"}
        inputMode={typed === "tel" ? "tel" : typed === "digits" ? "numeric" : typed === "email" ? "email" : typed === "url" ? "url" : undefined}
        autoComplete="off"
        placeholder={placeholder}
        maxLength={maxLength}
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

/** A day picked from a calendar, kept as an ISO date. Empty is `null`. */
export function DayField({ label, value, onChange, max }: { label: string; value: string | null; onChange: (value: string | null) => void; max?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="field-box">
        <input id={id} type="date" className="field-input num" dir="ltr" max={max} value={value ?? ""} onChange={(event) => onChange(event.target.value || null)} />
      </div>
    </div>
  );
}

export function SelectField<T extends string>({
  value,
  onChange,
  options,
  disabled,
  ...field
}: FieldProps & { value: T; onChange: (value: T) => void; options: Record<T, string>; disabled?: boolean }) {
  const id = useId();
  return (
    <Field id={id} {...field}>
      <select id={id} className="field-input" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as T)}>
        {(Object.keys(options) as T[]).map((key) => (
          <option key={key} value={key}>
            {options[key]}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** One choice out of a few, all visible. */
export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Record<T, string>;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {(Object.keys(options) as T[]).map((key) => (
        <button key={key} type="button" role="radio" aria-checked={key === value} onClick={() => onChange(key)}>
          {options[key]}
        </button>
      ))}
    </div>
  );
}

export function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
