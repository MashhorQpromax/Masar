"use client";
/** حقل رمز من ستة أرقام: يقبل اللصق والتعبئة التلقائية من الرسائل */
export function CodeInput({ name = "code", autoFocus, value, onChange }: { name?: string; autoFocus?: boolean; value?: string; onChange?: (v: string) => void }) {
  return (
    <input
      name={name} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" dir="ltr" autoFocus={autoFocus}
      aria-label="رمز التحقق" placeholder="······"
      value={value} onChange={onChange ? (e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6)) : undefined}
      onInput={onChange ? undefined : (e) => { e.currentTarget.value = e.currentTarget.value.replace(/\D/g, "").slice(0, 6); }}
      className="input figure !h-14 text-center text-[26px] font-semibold tracking-[0.45em] ps-[0.45em] placeholder:text-slate-300"
    />
  );
}
