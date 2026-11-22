import type { SVGProps } from "react";

const base = (size: number): SVGProps<SVGSVGElement> => ({
  viewBox: "0 0 24 24",
  width: size,
  height: size,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
});

/** The brand mark: a road from the coral start to the sun. */
export function Mark({ size = 40 }: { size?: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
      <rect width="40" height="40" rx="12" fill="#0f2a43" />
      <path d="M30 13c-5 0-5 7-10 7s-5 7-10 7" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="30" cy="13" r="3.2" fill="#ff5a3c" />
      <circle cx="10" cy="27" r="3.2" fill="#ffc233" />
    </svg>
  );
}

export function RoadIcon({ size = 22 }: { size?: number }) {
  return (
    <svg {...base(size)}>
      <path d="M18 7c-4 0-4 5-6 5s-2 5-6 5" />
      <circle cx="18" cy="7" r="1.6" fill="currentColor" />
      <circle cx="6" cy="17" r="1.6" fill="currentColor" />
    </svg>
  );
}

export function DealsIcon({ size = 22 }: { size?: number }) {
  return (
    <svg {...base(size)}>
      <rect x="4" y="8" width="16" height="11" rx="3" />
      <path d="M8 4.5h8" />
    </svg>
  );
}

/** Points back along the reading direction: to the right in Arabic. */
export function BackIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...base(size)}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function ChevronIcon({ size = 20 }: { size?: number }) {
  return (
    <svg {...base(size)}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function PlusIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...base(size)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function CloseIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...base(size)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function PenIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...base(size)}>
      <path d="M4 20h4L19 9l-4-4L4 16v4z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}
