"use client";

import { useActionState, useId, useState } from "react";
import { creditError } from "@/copy/credit";
import { Check, Segmented } from "@/ui/fields";
import { CheckIcon } from "@/ui/icons";
import { saveReview, type CreditAnswer } from "./actions";

type Suspension = "yes" | "no" | "keep";

const ANSWERED: Record<Exclude<Suspension, "keep">, string> = { yes: "يوجد", no: "لا يوجد" };
const UNCHECKED: Record<Suspension, string> = { keep: "لم نتحقق", ...ANSWERED };

/**
 * What a person found outside the report: SIMAH shows neither a service suspension nor a travel ban.
 * Saving states the facts as they are. A suspension nobody checked stays marked as assumed.
 */
export function ReviewForm({
  clientId,
  reportId,
  suspension,
  assumed,
  travelBan,
  note,
}: {
  clientId: number;
  reportId: number;
  suspension: boolean;
  /** The suspension was inferred from an unpaid order and nobody has confirmed it. */
  assumed: boolean;
  travelBan: boolean;
  note: string;
}) {
  const [answer, send, busy] = useActionState<CreditAnswer, FormData>(saveReview.bind(null, clientId), {});
  const [stopped, setStopped] = useState<Suspension>(assumed ? "keep" : suspension ? "yes" : "no");
  const [banned, setBanned] = useState(travelBan);
  const noteId = useId();

  return (
    <form action={send} className="review">
      <input type="hidden" name="reportId" value={reportId} />
      <input type="hidden" name="suspension" value={stopped} />
      <input type="hidden" name="travelBan" value={banned ? "yes" : "no"} />
      <div className="field">
        <span className="field-label">إيقاف الخدمات</span>
        {assumed ? (
          <Segmented label="إيقاف الخدمات" value={stopped} onChange={setStopped} options={UNCHECKED} />
        ) : (
          <Segmented label="إيقاف الخدمات" value={stopped as "yes" | "no"} onChange={setStopped} options={ANSWERED} />
        )}
      </div>
      <div className="field">
        <span className="field-label">منع السفر</span>
        <Check label="عليه منع سفر" checked={banned} onChange={setBanned} />
      </div>
      <div className="field" data-wide>
        <label className="field-label" htmlFor={noteId}>
          ملاحظة
        </label>
        <textarea id={noteId} name="note" className="field-input field-area" maxLength={4000} defaultValue={note} placeholder="ما وجدته في أبشر أو ناجز، أو ما اتفقت عليه مع الدائن" />
      </div>
      <div className="review-actions">
        <button type="submit" className="btn btn--navy" disabled={busy} aria-busy={busy}>
          احفظ
        </button>
        {answer.error ? (
          <p key={answer.error} role="alert" className="said" data-bad>
            {creditError(answer.error)}
          </p>
        ) : (
          answer.saved &&
          !busy && (
            <p role="status" className="said">
              <CheckIcon size={16} />
              حُفظت المراجعة
            </p>
          )
        )}
      </div>
    </form>
  );
}
