"use client";

import { useEffect } from "react";
import { PrintIcon } from "@/ui/icons";

/**
 * Puts the analysis on paper, or in a PDF the browser saves. Whatever the page folds away is opened
 * for the print and folded again after it, so the paper holds the whole analysis.
 */
export function PrintButton() {
  useEffect(() => {
    let opened: HTMLDetailsElement[] = [];
    const before = () => {
      opened = [...document.querySelectorAll<HTMLDetailsElement>("details:not([open])")];
      for (const fold of opened) fold.open = true;
    };
    const after = () => {
      for (const fold of opened) fold.open = false;
      opened = [];
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  return (
    <button type="button" className="edit-link an-print" data-soft onClick={() => window.print()}>
      <PrintIcon size={16} />
      اطبع أو احفظ
    </button>
  );
}
