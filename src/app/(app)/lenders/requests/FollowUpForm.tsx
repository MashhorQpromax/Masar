"use client";

import { useActionState, useState } from "react";
import { requestError } from "@/copy/requests";
import { FOLLOW_UP_RANGE } from "@/domain/request";
import { NumberField } from "@/ui/fields";
import { CheckIcon } from "@/ui/icons";
import { SubmitButton } from "@/ui/SubmitButton";
import { saveFollowUp, type FollowUpAnswer } from "./actions";

/** How long the office waits for a lender before a request shows for a follow-up. */
export function FollowUpForm({ days: before }: { days: number }) {
  const [answer, send] = useActionState<FollowUpAnswer, FormData>(saveFollowUp, {});
  const [days, setDays] = useState<number | null>(before);
  const fits = days != null && days >= FOLLOW_UP_RANGE.min && days <= FOLLOW_UP_RANGE.max;
  return (
    <details className="know-remove follow-set">
      <summary>غيّر المدة</summary>
      <form action={send}>
        <input type="hidden" name="days" value={days ?? ""} />
        <NumberField label="تابع بعد" value={days} onChange={setDays} max={FOLLOW_UP_RANGE.max} suffix="يوم" hint={`من ${FOLLOW_UP_RANGE.min} إلى ${FOLLOW_UP_RANGE.max}`} />
        <SubmitButton className="btn btn--soft" disabled={!fits || days === before}>
          احفظ
        </SubmitButton>
        {answer.error ? (
          <p role="alert" className="said" data-bad>
            {requestError(answer.error)}
          </p>
        ) : (
          answer.saved && (
            <p role="status" className="said">
              <CheckIcon size={16} />
              حُفظت
            </p>
          )
        )}
      </form>
    </details>
  );
}
