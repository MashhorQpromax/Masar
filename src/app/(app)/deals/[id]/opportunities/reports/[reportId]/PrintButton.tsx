"use client";

/** Opens the browser's print, where the report is printed or saved as a PDF. */
export function PrintButton() {
  return (
    <button type="button" className="btn btn--navy" onClick={() => window.print()}>
      اطبع أو احفظه PDF
    </button>
  );
}
