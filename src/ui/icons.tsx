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

/** A building with a pediment: the lenders. */
export function LendersIcon({ size = 22 }: { size?: number }) {
  return (
    <svg {...base(size)}>
      <path d="M4 9.5 12 5l8 4.5" />
      <path d="M6.5 12v5M12 12v5M17.5 12v5" />
      <path d="M4.5 19.5h15" />
    </svg>
  );
}

/** Two people, one a step behind: everyone the office has a file for. */
export function ClientsIcon({ size = 22 }: { size?: number }) {
  return (
    <svg {...base(size)}>
      <circle cx="9.5" cy="8.5" r="3.2" />
      <path d="M3.5 19c.5-3.2 2.9-5 6-5s5.5 1.8 6 5" />
      <path d="M16 5.8a3 3 0 0 1 0 5.4" />
      <path d="M18 14.6c1.4.7 2.3 2.2 2.5 4.4" />
    </svg>
  );
}

/** A speech bubble: what clients wrote. */
export function InboxIcon({ size = 22 }: { size?: number }) {
  return (
    <svg {...base(size)}>
      <path d="M7.5 4.5h9A3.5 3.5 0 0 1 20 8v4.5a3.5 3.5 0 0 1-3.5 3.5H12l-4.5 3.5V16A3.5 3.5 0 0 1 4 12.5V8a3.5 3.5 0 0 1 3.5-3.5z" />
    </svg>
  );
}

export function SearchIcon({ size = 20 }: { size?: number }) {
  return (
    <svg {...base(size)}>
      <circle cx="11" cy="11" r="6" />
      <path d="M15.5 15.5 20 20" />
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
      <path d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a15.6 15.6 0 0 1-2.4 3.1M6.3 7.7A15.3 15.3 0 0 0 2.5 12S6 18.5 12 18.5a9.3 9.3 0 0 0 4.2-1" />
      <path d="M9.9 10.1a2.8 2.8 0 0 0 3.9 4" />
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

/** Three ridges of a fingertip. Drawn a little finer than the other icons, so the ridges stay apart when small. */
export function FingerprintIcon({ size = 20 }: { size?: number }) {
  return (
    <svg {...base(size)} strokeWidth={1.6}>
      <path d="M12 11.2v3c0 2.1-.5 4-1.4 5.6" />
      <path d="M8.1 18.5c.5-1.4.7-2.8.7-4.3v-3a3.2 3.2 0 0 1 6.4 0v2.3c0 2.2-.3 4.2-.9 6" />
      <path d="M5.6 15v-3.8a6.4 6.4 0 0 1 12.8 0v2.8c0 1.1-.1 2.2-.3 3.2" />
    </svg>
  );
}

export function CopyIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...base(size)}>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" />
    </svg>
  );
}

export function CheckIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...base(size)}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/** A sheet going up: bring a file in. */
export function UploadIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...base(size)}>
      <path d="M12 16V5" />
      <path d="M7.5 9.5L12 5l4.5 4.5" />
      <path d="M5 19h14" />
    </svg>
  );
}

/** A sheet leaving a printer: put the page on paper. */
export function PrintIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...base(size)}>
      <path d="M7.5 9V4.5h9V9" />
      <path d="M7.5 17H5.5a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 5.5 9h13a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5h-2" />
      <path d="M7.5 14h9v5.5h-9z" />
    </svg>
  );
}
