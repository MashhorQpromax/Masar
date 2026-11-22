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

export function EyeIcon({ size = 20 }: { size?: number }) {
  return (
    <svg {...base(size)}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  );
}

export function EyeOffIcon({ size = 20 }: { size?: number }) {
  return (
    <svg {...base(size)}>
      <path d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.500 9.500 6.500a15.600 15.600 0 0 1-2.400 3.100M6.300 7.700A15.300 15.300 0 0 0 2.500 12S6 18.500 12 18.500a9.300 9.300 0 0 0 4.200-1" />
      <path d="M9.900 10.100a2.800 2.800 0 0 0 3.900 4" />
      <path d="M4 4l16 16" />
    </svg>
  );
}

export function LeaveIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...base(size)}>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M10 8l-4 4 4 4M6 12h9" />
    </svg>
  );
}
