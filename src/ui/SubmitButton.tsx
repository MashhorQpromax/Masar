"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/** A form button that shows it is working and cannot be pressed twice. */
export function SubmitButton({ className, children }: { className: string; children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {children}
    </button>
  );
}
