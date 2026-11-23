"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { CONSENT_WAY, requestError } from "@/copy/requests";
import type { ConsentWay } from "@/domain/request";
import { DayField, Segmented, SelectField, TextField } from "@/ui/fields";
import { CheckIcon } from "@/ui/icons";
import { SubmitButton } from "@/ui/SubmitButton";
import { approve, close, giveConsent, markSent, prepare, withdrawConsent, type RequestAnswer } from "./actions";

/** What came of a step: a refusal in words, with the open request it points at when there is one. */
function Said({ answer, done }: { answer: RequestAnswer; done?: string }) {
  if (answer.error) {
    const open = answer.params?.request;
    return (
      <p key={answer.error} role="alert" className="said" data-bad>
        {requestError(answer.error, answer.params)}
        {open && answer.params?.deal && (
          <>
            {" "}
            <Link className="note-link" href={`/deals/${answer.params.deal}/requests#r${open}`}>
              افتح الطلب
            </Link>
          </>
        )}
      </p>
    );
  }
  return answer.saved && done ? (
    <p role="status" className="said">
      <CheckIcon size={16} />
      {done}
    </p>
  ) : null;
}

/** Prepares the request to one lender on one opportunity. */
export function PrepareButton({ dealId, routeKey, lenderId }: { dealId: number; routeKey: string; lenderId: number }) {
  const [answer, send] = useActionState<RequestAnswer, FormData>(prepare.bind(null, dealId, routeKey, lenderId), {});
  return (
    <form className="req-step" action={send}>
      <SubmitButton className="btn btn--soft">جهّز الطلب</SubmitButton>
      <Said answer={answer} />
    </form>
  );
}

/** The manager signs what the lender will be told. */
export function ApproveButton({ dealId, requestId }: { dealId: number; requestId: number }) {
  const [answer, send] = useActionState<RequestAnswer, FormData>(approve.bind(null, dealId, requestId), {});
  return (
    <form className="req-step" action={send}>
      <SubmitButton className="btn btn--navy">اعتمد الرسالة</SubmitButton>
      <Said answer={answer} />
    </form>
  );
}

/** A person sent the approved message: through which way, and on which day. */
export function SendForm({ dealId, requestId, contacts, today }: { dealId: number; requestId: number; contacts: { id: number; label: string }[]; today: string }) {
  const [answer, send] = useActionState<RequestAnswer, FormData>(markSent.bind(null, dealId, requestId), {});
  const options = Object.fromEntries(contacts.map((c) => [`c${c.id}`, c.label])) as Record<string, string>;
  const [contact, setContact] = useState(contacts[0] ? `c${contacts[0].id}` : "");
  const [day, setDay] = useState<string | null>(today);
  return (
    <form className="req-send" action={send}>
      <input type="hidden" name="contactId" value={contact} />
      <input type="hidden" name="sentOn" value={day ?? ""} />
      <SelectField label="أُرسل عبر" value={contact} onChange={setContact} options={options} />
      <DayField label="يوم الإرسال" value={day} onChange={setDay} max={today} />
      <SubmitButton className="btn btn--navy" disabled={!contact || !day}>
        سجّل الإرسال
      </SubmitButton>
      <Said answer={answer} />
    </form>
  );
}

/** Closes a request still open, with a short reason. */
export function CloseForm({ dealId, requestId }: { dealId: number; requestId: number }) {
  const [answer, send] = useActionState<RequestAnswer, FormData>(close.bind(null, dealId, requestId), {});
  const [reason, setReason] = useState("");
  return (
    <details className="know-remove req-close">
      <summary>أغلق الطلب</summary>
      <form action={send}>
        <TextField label="السبب" name="reason" value={reason} onChange={setReason} maxLength={200} placeholder="مثلاً: قدّمنا من فرع الجهة" />
        <SubmitButton className="btn btn--soft">نعم، أغلقه</SubmitButton>
        <Said answer={answer} />
      </form>
    </details>
  );
}

/** Records that the client agreed to their data going to one lender. */
export function ConsentForm({ dealId, clientId, lenders, today }: { dealId: number; clientId: number; lenders: { id: number; name: string }[]; today: string }) {
  const [answer, send] = useActionState<RequestAnswer, FormData>(giveConsent.bind(null, dealId, clientId), {});
  const options = Object.fromEntries(lenders.map((l) => [`l${l.id}`, l.name])) as Record<string, string>;
  const [lender, setLender] = useState(lenders[0] ? `l${lenders[0].id}` : "");
  const [way, setWay] = useState<ConsentWay>("written");
  const [day, setDay] = useState<string | null>(today);
  const [note, setNote] = useState("");
  return (
    <form className="req-consent" action={send}>
      <input type="hidden" name="lenderId" value={lender} />
      <input type="hidden" name="way" value={way} />
      <input type="hidden" name="givenOn" value={day ?? ""} />
      <SelectField label="الجهة" value={lender} onChange={setLender} options={options} />
      <div className="field">
        <span className="field-label">وافق</span>
        <Segmented label="كيف وافق" value={way} onChange={setWay} options={CONSENT_WAY} />
      </div>
      <DayField label="يوم الموافقة" value={day} onChange={setDay} max={today} />
      <TextField label="ملاحظة" name="note" value={note} onChange={setNote} maxLength={300} placeholder="أين هي: رسالة، نموذج موقّع، اتصال" />
      <SubmitButton className="btn btn--navy" disabled={!lender || !day}>
        سجّل الموافقة
      </SubmitButton>
      <Said answer={answer} done="سُجّلت الموافقة" />
    </form>
  );
}

/** The client takes back their consent for one lender. */
export function WithdrawButton({ dealId, clientId, consentId, lender }: { dealId: number; clientId: number; consentId: number; lender: string }) {
  const [answer, send] = useActionState<RequestAnswer, FormData>(withdrawConsent.bind(null, dealId, clientId, consentId), {});
  return (
    <details className="know-remove">
      <summary aria-label={`اسحب موافقة المشاركة مع ${lender}`}>اسحب</summary>
      <form action={send}>
        <SubmitButton className="btn btn--soft">نعم، سحب العميل موافقته</SubmitButton>
        <Said answer={answer} />
      </form>
    </details>
  );
}

/** The message, ready to paste into the lender's email or chat. */
export function CopyMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn--soft req-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2400);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "نُسخت" : "انسخ الرسالة"}
    </button>
  );
}
