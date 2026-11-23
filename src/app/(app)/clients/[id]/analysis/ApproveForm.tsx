"use client";

import { useActionState, useState } from "react";
import { approvalError } from "@/copy/approval";
import { REASON_MAX, REASON_MIN } from "@/domain/analysis";
import { SubmitButton } from "@/ui/SubmitButton";
import { approveRecommendation, type CardAnswer } from "../actions";

/**
 * Approving the recommendation. A complete one is approved with one press; one with something still
 * open asks first for the reason it is approved all the same, and the button waits for it.
 */
export function ApproveForm({ clientId, open }: { clientId: number; open: boolean }) {
  const [answer, send] = useActionState<CardAnswer, FormData>(approveRecommendation.bind(null, clientId), {});
  const [reason, setReason] = useState("");
  const short = open && reason.trim().length < REASON_MIN;

  return (
    <form className="approve" action={send}>
      {open && (
        <label className="decide-ask">
          <span>سبب اعتمادها رغم ما لم يكتمل</span>
          <textarea
            name="reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="مثال: الجهة أكدت الشرط هاتفياً، وخطابها في الطريق"
            minLength={REASON_MIN}
            maxLength={REASON_MAX}
            rows={2}
            required
          />
        </label>
      )}
      <SubmitButton className="btn btn--navy" disabled={short}>
        اعتمد التوصية
      </SubmitButton>
      {answer.error && (
        <p key={answer.error} role="alert" className="said" data-bad>
          {approvalError(answer.error, answer.params)}
        </p>
      )}
    </form>
  );
}
