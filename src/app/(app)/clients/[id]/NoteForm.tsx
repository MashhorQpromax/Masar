"use client";

import { useActionState, useEffect, useState } from "react";
import { contactError } from "@/copy/clients";
import { SubmitButton } from "@/ui/SubmitButton";
import { leaveNote, type CardAnswer } from "./actions";

/** A note for whoever opens the file next. */
export function NoteForm({ clientId }: { clientId: number }) {
  const [answer, send] = useActionState<CardAnswer, FormData>(leaveNote.bind(null, clientId), {});
  const [body, setBody] = useState("");

  useEffect(() => {
    if (answer.done) setBody("");
  }, [answer]);

  return (
    <form action={send} className="note-add">
      <textarea name="body" className="note-text" value={body} onChange={(event) => setBody(event.target.value)} placeholder="اكتب ملاحظة تبقى في الملف" aria-label="ملاحظة جديدة" maxLength={1000} rows={2} />
      <SubmitButton className="btn btn--soft">أضفها</SubmitButton>
      {answer.error && (
        <p key={answer.error} role="alert" className="said" data-bad>
          {contactError(answer.error)}
        </p>
      )}
    </form>
  );
}
