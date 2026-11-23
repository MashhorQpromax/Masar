"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/** A form button that shows it is working and cannot be pressed twice. */
export function SubmitButton({ className, children, disabled = false }: { className: string; children: ReactNode; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending || disabled} aria-busy={pending}>
      {children}
    </button>
  );
}
