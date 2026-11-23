"use client";

import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";
import { accountError } from "@/copy/auth";
import { PasswordField } from "@/ui/PasswordField";
import { confirmPassword } from "./actions";

/**
 * The password is asked again before something that decides who may enter changes: a person's own
 * ways in, or someone else's account. Closing the box changes nothing.
 */
export function Gate({ say, onDone, onClose }: { say: string; onDone: () => void; onClose: () => void }) {
  const box = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [typed, setTyped] = useState("");
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, start] = useTransition();

  useEffect(() => {
    box.current?.showModal();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    setRefused(null);
    start(async () => {
      const answer = await confirmPassword(typed);
      if (answer.error) return setRefused(accountError(answer.error));
      onDone();
    });
  }

  return (
    <dialog ref={box} className="ask" aria-labelledby={title} onClose={onClose}>
      <form onSubmit={submit} className="ask-form">
        <h2 id={title} className="ask-title">
          أكّد أنك أنت
        </h2>
        <p className="ask-say">{say}</p>
        <PasswordField label="كلمة المرور" autoComplete="current-password" required autoFocus value={typed} onChange={(event) => setTyped(event.target.value)} />
        {refused && (
          <p key={refused} role="alert" className="said" data-bad>
            {refused}
          </p>
        )}
        <div className="ask-actions">
          <button type="submit" className="btn btn--navy" disabled={busy} aria-busy={busy}>
            تأكيد
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => box.current?.close()}>
            إلغاء
          </button>
        </div>
      </form>
    </dialog>
  );
}
