// رسومات مسار الأصلية: لغة واحدة من الأقواس والمثلثات النجدية وخط ذهبي واحد.
import type { CSSProperties } from "react";

const d = (delay: number, draw?: number) => ({ "--delay": `${delay}s`, ...(draw ? { "--draw": `${draw}s` } : {}) }) as CSSProperties;

const ROUTE = "M-10 474 C 30 474, 50 509, 96 509 H 504 C 530 509, 548 509, 574 500";

/** لوحة الدخول: جسر بين ضفتين، والمسار الذهبي يرسم نفسه */
export function HeroArt({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 640 760" className={className} preserveAspectRatio="xMidYMax slice" aria-hidden>
      <defs>
        <radialGradient id="h-glow" cx="30%" cy="24%" r="75%"><stop offset="0" stopColor="#14503f" /><stop offset="50%" stopColor="#0a3329" /><stop offset="100%" stopColor="#06231c" /></radialGradient>
        <pattern id="h-dots" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#ecdfc2" opacity=".16" /></pattern>
        <linearGradient id="h-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" /><stop offset=".6" stopColor="#fff" stopOpacity="0" /></linearGradient>
        <mask id="h-mask"><rect width="640" height="760" fill="url(#h-fade)" /></mask>
        <linearGradient id="h-water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#082a22" /><stop offset="1" stopColor="#06231c" /></linearGradient>
      </defs>
      <rect width="640" height="760" fill="url(#h-glow)" />
      <rect width="640" height="460" fill="url(#h-dots)" mask="url(#h-mask)" />

      <g className="float">
        <circle cx="186" cy="190" r="118" fill="none" stroke="#c29a4b" strokeOpacity=".08" />
        <circle cx="186" cy="190" r="88" fill="none" stroke="#c29a4b" strokeOpacity=".16" />
        <circle cx="186" cy="190" r="58" fill="#c29a4b" className="pop" style={d(0.2)} />
        <circle cx="186" cy="190" r="45" fill="none" stroke="#06231c" strokeOpacity=".22" strokeWidth="1.5" />
        <path d="M166 204 C 176 204, 176 178, 186 178 S 196 196, 206 176" fill="none" stroke="#06231c" strokeOpacity=".45" strokeWidth="3" strokeLinecap="round" pathLength={1} className="draw" style={d(0.9, 0.9)} />
      </g>

      <path d="M0 470 C 90 430, 190 446, 300 474 S 520 492, 640 440 V760 H0z" fill="#0b3a2e" />
      <path d="M0 500 C 140 470, 260 500, 380 506 S 560 486, 640 500 V760 H0z" fill="#0a3329" />

      {/* الضفة اليمنى: بيت نجدي */}
      <g className="fade" style={d(0.3)}>
        <path d="M500 520 V300 h12 v-14 h14 v14 h14 v-14 h14 v14 h14 v-14 h14 v14 h14 v-14 h14 v14 h30 V520z" fill="#0f4637" />
        <path d="M500 520 V300 h12 v-14 h14 v14 h14 v-14 h14 v14 h14 v-14 h14 v14 h14 v-14 h14 v14 h30" fill="none" stroke="#ecdfc2" strokeOpacity=".5" strokeWidth="1.5" />
        <path d="M500 334 H640" stroke="#ecdfc2" strokeOpacity=".22" strokeWidth="1.2" />
        <g fill="#ecdfc2" opacity=".72">
          <path d="M540 372 l7 -11 l7 11z" /><path d="M558 372 l7 -11 l7 11z" /><path d="M576 372 l7 -11 l7 11z" /><path d="M594 372 l7 -11 l7 11z" />
          <path d="M549 390 l7 -11 l7 11z" /><path d="M567 390 l7 -11 l7 11z" /><path d="M585 390 l7 -11 l7 11z" />
          <path d="M558 408 l7 -11 l7 11z" /><path d="M576 408 l7 -11 l7 11z" />
          <path d="M567 426 l7 -11 l7 11z" />
        </g>
        <path d="M548 520 V474 a26 26 0 0 1 52 0 V520z" fill="#c29a4b" />
        <path d="M558 520 V476 a16 16 0 0 1 32 0 V520" fill="none" stroke="#06231c" strokeOpacity=".3" strokeWidth="1.5" />
        <g stroke="#ecdfc2" strokeOpacity=".6" strokeWidth="1.6" fill="none" strokeLinecap="round">
          <path d="M470 520 C 468 480, 474 452, 470 424" />
          <path d="M470 424 C 452 412, 438 416, 428 430" /><path d="M470 424 C 456 402, 440 398, 426 404" /><path d="M470 424 C 470 400, 478 388, 492 384" />
          <path d="M470 424 C 486 408, 500 410, 508 422" /><path d="M470 424 C 488 420, 498 430, 500 444" /><path d="M470 424 C 456 426, 448 438, 448 450" />
        </g>
      </g>

      {/* الضفة اليسرى */}
      <g className="fade" style={d(0.3)}>
        <path d="M0 520 V452 h64 v22 h36 V520z" fill="#0f4637" />
        <path d="M0 452 h64 v22 h36 V520" fill="none" stroke="#ecdfc2" strokeOpacity=".42" strokeWidth="1.5" />
        <path d="M20 520 v-26 a12 12 0 0 1 24 0 v26" fill="none" stroke="#ecdfc2" strokeOpacity=".5" strokeWidth="1.5" />
      </g>

      {/* الجسر */}
      <g stroke="#ecdfc2" strokeLinecap="round" fill="none">
        <g strokeOpacity=".32" strokeWidth="1.2" className="fade" style={d(1.4)}>
          <path d="M100 504 H500" />
          <path d="M120 504v10M140 504v10M160 504v10M180 504v10M200 504v10M220 504v10M240 504v10M260 504v10M280 504v10M300 504v10M320 504v10M340 504v10M360 504v10M380 504v10M400 504v10M420 504v10M440 504v10M460 504v10M480 504v10" />
        </g>
        <path d="M96 517 H504" strokeWidth="6" strokeOpacity=".95" pathLength={1} className="draw" style={d(0.5, 1.2)} />
        <path d="M100 530 H500" strokeWidth="1.5" strokeOpacity=".55" pathLength={1} className="draw" style={d(0.7, 1.2)} />
        <g strokeWidth="5" strokeOpacity=".9">
          <path d="M200 530 V640" pathLength={1} className="draw" style={d(0.8, 0.7)} /><path d="M300 530 V640" pathLength={1} className="draw" style={d(0.95, 0.7)} /><path d="M400 530 V640" pathLength={1} className="draw" style={d(1.1, 0.7)} />
        </g>
        <g strokeWidth="2.2" strokeOpacity=".9">
          <path d="M100 616 A50 60 0 0 1 200 616" pathLength={1} className="draw" style={d(0.9, 0.9)} /><path d="M200 616 A50 60 0 0 1 300 616" pathLength={1} className="draw" style={d(1.05, 0.9)} />
          <path d="M300 616 A50 60 0 0 1 400 616" pathLength={1} className="draw" style={d(1.2, 0.9)} /><path d="M400 616 A50 60 0 0 1 500 616" pathLength={1} className="draw" style={d(1.35, 0.9)} />
        </g>
        <g strokeWidth="1.2" strokeOpacity=".38" className="fade" style={d(1.8)}>
          <path d="M110 616 A40 49 0 0 1 190 616" /><path d="M210 616 A40 49 0 0 1 290 616" /><path d="M310 616 A40 49 0 0 1 390 616" /><path d="M410 616 A40 49 0 0 1 490 616" />
        </g>
      </g>
      <g fill="#c29a4b" className="fade" style={d(1.7)}><path d="M194 546 l6 -9 l6 9z" /><path d="M294 546 l6 -9 l6 9z" /><path d="M394 546 l6 -9 l6 9z" /></g>

      <path d="M0 640 H640 V760 H0z" fill="url(#h-water)" />
      <g stroke="#ecdfc2" strokeLinecap="round" fill="none" strokeOpacity=".14" strokeWidth="1.5">
        <path d="M100 664 A50 34 0 0 0 200 664" /><path d="M200 664 A50 34 0 0 0 300 664" /><path d="M300 664 A50 34 0 0 0 400 664" /><path d="M400 664 A50 34 0 0 0 500 664" />
      </g>
      <g stroke="#ecdfc2" strokeLinecap="round" strokeWidth="1.5">
        <path d="M40 654 H150" strokeOpacity=".22" /><path d="M190 654 H420" strokeOpacity=".22" /><path d="M470 654 H600" strokeOpacity=".22" />
        <path d="M90 682 H250" strokeOpacity=".13" /><path d="M310 682 H560" strokeOpacity=".13" />
        <path d="M30 712 H120" strokeOpacity=".09" /><path d="M200 712 H470" strokeOpacity=".09" /><path d="M520 712 H610" strokeOpacity=".09" />
      </g>

      {/* المسار الذهبي */}
      <path d={ROUTE} pathLength={1} className="draw" style={d(1.9, 2.4)} fill="none" stroke="#c29a4b" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <g fill="#fbfaf7">
        <circle cx="96" cy="509" r="5.5" className="pop" style={d(2.5)} /><circle cx="300" cy="509" r="5.5" className="pop" style={d(3.1)} /><circle cx="504" cy="509" r="5.5" className="pop" style={d(3.7)} />
      </g>
      <circle r="4" fill="#fbfaf7" className="traveler" style={{ offsetPath: `path("${ROUTE}")` } as CSSProperties} />
    </svg>
  );
}

const INK = "#0a4a3b";
const SAND = "#e7e1d3";
const GOLD = "#c29a4b";

/** رسمات صغيرة للحالات الفارغة */
export function Spot({ kind = "path", className = "w-40" }: { kind?: "path" | "bridge" | "docs" | "chat" | "search" | "lost"; className?: string }) {
  const line = { fill: "none", stroke: INK, strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const gold = { fill: "none", stroke: GOLD, strokeWidth: 2.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 200 140" className={className} aria-hidden>
      <path d="M8 118 C 50 100, 92 112, 130 116 S 178 108, 194 114" {...line} strokeOpacity=".25" />
      {kind === "path" && <>
        <circle cx="52" cy="40" r="15" fill={SAND} />
        <path d="M128 116 V74 a22 22 0 0 1 44 0 V116z" fill={SAND} /><path d="M128 116 V74 a22 22 0 0 1 44 0 V116" {...line} />
        <path d="M140 116 V78 a10 10 0 0 1 20 0 V116" {...line} strokeOpacity=".4" />
        <g fill={INK} opacity=".7"><path d="M141 56 l5 -8 l5 8z" /><path d="M153 56 l5 -8 l5 8z" /></g>
        <path d="M10 104 C 40 104, 48 86, 78 92 S 112 112, 150 104" {...gold} pathLength={1} className="draw" style={d(0.15, 1.1)} />
        <circle cx="150" cy="104" r="4.5" fill={GOLD} className="pop" style={d(1.1)} />
      </>}
      {kind === "bridge" && <>
        <path d="M14 116 V88 h30 V116M156 116 V88 h30 V116" {...line} /><path d="M14 88 h30 V116 H14zM156 88 h30 V116 h-30z" fill={SAND} opacity=".7" />
        <path d="M44 116 A28 30 0 0 1 100 116" {...line} /><path d="M100 116 A28 30 0 0 1 156 116" {...line} strokeDasharray="3 6" strokeOpacity=".5" />
        <path d="M100 82 V116" {...line} strokeWidth="2.6" />
        <path d="M30 80 H104" {...gold} pathLength={1} className="draw" style={d(0.15, 0.9)} />
        <path d="M114 80 H170" {...gold} strokeDasharray="2 7" strokeOpacity=".55" />
        <circle cx="104" cy="80" r="4.5" fill={GOLD} className="pop" style={d(0.9)} />
        <circle cx="150" cy="38" r="13" fill={SAND} />
      </>}
      {kind === "docs" && <>
        <path d="M70 116 V44 a30 30 0 0 1 60 0 V116z" fill={SAND} /><path d="M70 116 V44 a30 30 0 0 1 60 0 V116" {...line} />
        <path d="M82 116 V58 h36 V116" fill="#fbfaf7" /><path d="M82 116 V58 h36 V116" {...line} />
        <path d="M90 72 h20M90 82 h20M90 92 h12" {...line} strokeOpacity=".4" />
        <path d="M88 104 l6 6 l14 -15" {...gold} pathLength={1} className="draw" style={d(0.3, 0.6)} />
        <g fill={INK} opacity=".7"><path d="M95 36 l5 -8 l5 8z" /></g>
      </>}
      {kind === "chat" && <>
        <path d="M38 36 h74 a12 12 0 0 1 12 12 v26 a12 12 0 0 1 -12 12 H66 l-16 14 v-14 h-12 a12 12 0 0 1 -12 -12 V48 a12 12 0 0 1 12 -12z" fill={SAND} />
        <path d="M38 36 h74 a12 12 0 0 1 12 12 v26 a12 12 0 0 1 -12 12 H66 l-16 14 v-14 h-12 a12 12 0 0 1 -12 -12 V48 a12 12 0 0 1 12 -12z" {...line} />
        <g fill={INK} opacity=".75"><path d="M52 68 l6 -10 l6 10z" /><path d="M69 68 l6 -10 l6 10z" /><path d="M86 68 l6 -10 l6 10z" /></g>
        <path d="M134 70 h30 a10 10 0 0 1 10 10 v16 a10 10 0 0 1 -10 10 h-4 v10 l-12 -10 h-14" {...line} strokeOpacity=".5" />
        <path d="M140 90 h24" {...gold} pathLength={1} className="draw" style={d(0.3, 0.6)} />
      </>}
      {kind === "search" && <>
        <circle cx="92" cy="62" r="34" fill={SAND} /><circle cx="92" cy="62" r="34" {...line} />
        <path d="M118 88 l26 26" {...line} strokeWidth="5" />
        <path d="M66 70 C 78 58, 90 74, 100 64 S 114 60, 118 66" {...gold} pathLength={1} className="draw" style={d(0.2, 0.9)} />
        <g fill={INK} opacity=".6"><path d="M84 52 l5 -8 l5 8z" /></g>
      </>}
      {kind === "lost" && <>
        <path d="M14 116 V86 h34 V116z" fill={SAND} /><path d="M14 116 V86 h34 V116" {...line} />
        <path d="M48 116 A26 28 0 0 1 100 116" {...line} />
        <path d="M152 116 V86 h34 V116z" fill={SAND} /><path d="M186 116 V86 h-34 V116" {...line} />
        <path d="M24 78 H96" {...gold} pathLength={1} className="draw" style={d(0.15, 0.8)} />
        <path d="M100 78 C 112 78, 112 96, 104 108" {...gold} strokeDasharray="2 7" strokeOpacity=".6" />
        <path d="M118 62 l10 10 M128 62 l-10 10" {...line} strokeWidth="2.2" />
        <circle cx="46" cy="36" r="13" fill={SAND} />
      </>}
    </svg>
  );
}
