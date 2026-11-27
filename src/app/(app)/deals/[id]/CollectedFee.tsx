"use client";

import { useActionState, useState } from "react";
import { collectedError } from "@/copy/fees";
import { COLLECTED_MAX } from "@/domain/deal";
import { NumberField } from "@/ui/fields";
import { SubmitButton } from "@/ui/SubmitButton";
import { recordCollected, type CollectedAnswer } from "./actions";

/**
 * What the office collected of a closed deal's fee: one field. Nothing recorded yet shows the field at
 * once, because it is the one thing left to do on the deal; a recorded amount is changed one fold away.
 * An empty field takes the recorded amount back. A saved amount shows in the line above the field: the
 * page gives this form a new key, so it starts again from what was saved.
 */
export function CollectedFee({ dealId, before }: { dealId: number; before: number | null }) {
  const [answer, send] = useActionState<CollectedAnswer, FormData>(recordCollected.bind(null, dealId), {});
  const [amount, setAmount] = useState<number | null>(before);
  const form = (
    <form className="approve collected" action={send}>
      <input type="hidden" name="amount" value={amount ?? ""} />
      <NumberField label="الأتعاب المحصلة فعلاً" money value={amount} onChange={setAmount} max={COLLECTED_MAX} />
      <SubmitButton className="btn btn--navy" disabled={amount === before}>
        احفظ
      </SubmitButton>
      <small className="field-hint">ما دخل حساب المكتب من أتعاب هذه الصفقة.</small>
      {answer.error && (
        <p key={answer.error} role="alert" className="said" data-bad>
          {collectedError(answer.error, answer.params)}
        </p>
      )}
    </form>
  );
  if (before == null) return form;
  return (
    <details className="more">
      <summary>عدّل المحصّل</summary>
      <div>{form}</div>
    </details>
  );
}
