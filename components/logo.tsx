export function Logo({ light }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="size-9" aria-hidden>
        <rect width="32" height="32" rx="9" fill={light ? "#ffffff" : "#0a654e"} fillOpacity={light ? 0.1 : 1} />
        <path d="M7 22 C 12 22, 12 10, 17 10 S 22 18, 25 10" stroke="#c8a04a" strokeWidth="2.6" fill="none" strokeLinecap="round" />
        <circle cx="25" cy="10" r="2.2" fill="#fff" />
      </svg>
      <div>
        <div className={`font-bold text-lg leading-none ${light ? "text-white" : "text-ink"}`}>مسار</div>
        <div className={`text-[10px] mt-0.5 ${light ? "text-brand-100/70" : "text-slate-500"}`}>منصة دراسة التمويل</div>
      </div>
    </div>
  );
}
