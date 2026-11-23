"use client";

import { useActionState, useState } from "react";
import { contactError } from "@/copy/clients";
import { SubmitButton } from "@/ui/SubmitButton";
import { decideFile, type CardAnswer } from "./actions";

const WORDS = {
  reject: { open: "ارفض الملف", ask: "سبب الرفض", hint: "مثال: العجز لا يُغلق بأي حل", go: "ارفض الملف", button: "btn btn--coral" },
  reopen: { open: "أعد الملف إلى الدراسة", ask: "ما الذي تغيّر؟", hint: "مثال: وافق العميل على دفع الفرق", go: "أعده إلى الدراسة", button: "btn btn--white" },
} as const;

/**
 * Rejecting a file, or putting a rejected one back under study. The decision opens in place and asks
 * for its reason, so it cannot be taken by a slip of the finger.
 */
export function DecideFile({ clientId, decision }: { clientId: number; decision: "reject" | "reopen" }) {
  const [answer, send] = useActionState<CardAnswer, FormData>(decideFile.bind(null, clientId, decision), {});
  const [reason, setReason] = useState("");
  const words = WORDS[decision];

  return (
    <details className="decide" data-decision={decision}>
      <summary>{words.open}</summary>
      <form action={send}>
        <label className="decide-ask">
          <span>{words.ask}</span>
          <input name="reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={words.hint} maxLength={500} autoComplete="off" required />
        </label>
        <SubmitButton className={words.button}>{words.go}</SubmitButton>
        {answer.error && (
          <p key={answer.error} role="alert" className="said" data-bad>
            {contactError(answer.error)}
          </p>
        )}
      </form>
    </details>
  );
}
