"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { paperError } from "@/copy/documents";
import { SubmitButton } from "@/ui/SubmitButton";
import { addPaperByName, type PaperAnswer } from "./actions";

/** A paper by name: what one lender, or this file alone, asks for beyond the usual. */
export function AddPaper({ home }: { home: string }) {
  const [answer, send] = useActionState<PaperAnswer, FormData>(addPaperByName.bind(null, home), {});
  const form = useRef<HTMLFormElement>(null);
  const id = useId();

  useEffect(() => {
    if (answer.done) form.current?.reset();
  }, [answer]);

  return (
    <form ref={form} action={send} className="paper-add">
      <div className="field">
        <label className="field-label" htmlFor={id}>
          اسم المستند
        </label>
        <div className="field-box">
          <input id={id} className="field-input" name="label" required minLength={2} maxLength={80} placeholder="مثال: فحص طبي" autoComplete="off" />
        </div>
      </div>
      <SubmitButton className="btn btn--soft">أضفه</SubmitButton>
      {answer.error && (
        <p key={answer.error} role="alert" className="said" data-bad>
          {paperError(answer.error)}
        </p>
      )}
    </form>
  );
}
