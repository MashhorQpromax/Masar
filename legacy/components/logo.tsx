// علامة مسار: قوس جسر وخط ذهبي يعبره
export function Mark({ className = "size-9", light }: { className?: string; light?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9.5" fill={light ? "#fbfaf7" : "#0a4a3b"} fillOpacity={light ? 0.1 : 1} />
      <path d="M9 24v-6.500a7 7 0 0 1 14 0V24" fill="none" stroke={light ? "#fbfaf7" : "#ecdfc2"} strokeOpacity=".9" strokeWidth="2.200" strokeLinecap="round" />
      <path d="M5.500 9.500h16" stroke="#c29a4b" strokeWidth="2.400" strokeLinecap="round" />
      <circle cx="25.500" cy="9.500" r="2.300" fill="#c29a4b" />
    </svg>
  );
}

export function Logo({ light, compact }: { light?: boolean; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <Mark light={light} className={compact ? "size-8" : "size-9"} />
      <div className={`font-display font-bold leading-none ${compact ? "text-[17px]" : "text-[19px]"} ${light ? "text-white" : "text-ink"}`}>مسار</div>
    </div>
  );
}
