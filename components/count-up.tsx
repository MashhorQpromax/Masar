"use client";
import { useEffect, useRef, useState } from "react";

/** رقم يعدّ صعوداً عند الظهور. يُعرض بقيمته النهائية من الخادم ثم يتحرك مرة واحدة. */
export function CountUp({ value, ms = 900 }: { value: number; ms?: number }) {
  const [v, setV] = useState(value);
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !Number.isFinite(value) || value === 0) { setV(value); return; }
    done.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setV(value * (1 - Math.pow(1 - k, 4)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    setV(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <>{Math.round(v).toLocaleString("en-US")}</>;
}
