"use client";

import { useActionState, useId, useRef, useState } from "react";
import { creditError, readText } from "@/copy/credit";
import { REPORT_MAX_BYTES } from "@/domain/credit/rules";
import { CheckIcon, UploadIcon } from "@/ui/icons";
import { uploadReport, type CreditAnswer } from "./actions";

/**
 * One button: pick the report as SIMAH issued it, and it is read. There is nothing else to fill in,
 * so choosing the file sends it.
 */
export function ReportUpload({ clientId, again }: { clientId: number; again?: boolean }) {
  const [answer, send, busy] = useActionState<CreditAnswer, FormData>(uploadReport.bind(null, clientId), {});
  const [tooLarge, setTooLarge] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const id = useId();

  function picked(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    // Checked here first: the server never receives a file it would refuse for its size.
    if (file.size > REPORT_MAX_BYTES) {
      input.value = "";
      return setTooLarge(true);
    }
    setTooLarge(false);
    form.current?.requestSubmit();
  }

  const error = tooLarge ? "TOO_LARGE" : answer.error;
  return (
    <form ref={form} action={send} className="upload">
      <input id={id} className="upload-input" type="file" name="file" accept="application/pdf,.pdf" disabled={busy} onChange={(event) => picked(event.target)} />
      <label htmlFor={id} className={again ? "edit-link" : "btn btn--navy"} data-soft={again || undefined} aria-busy={busy}>
        <UploadIcon size={again ? 16 : 18} />
        {busy ? "نقرأ التقرير" : again ? "ارفع تقريراً أحدث" : "ارفع تقرير سمة"}
      </label>
      {error ? (
        <p key={error} role="alert" className="said" data-bad>
          {creditError(error)}
        </p>
      ) : (
        answer.read && (
          <p role="status" className="said">
            <CheckIcon size={16} />
            {readText(answer.read)}
          </p>
        )
      )}
    </form>
  );
}
