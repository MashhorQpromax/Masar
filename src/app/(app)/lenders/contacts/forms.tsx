"use client";

import { useActionState, useState } from "react";
import { CONTACT_KIND, requestError } from "@/copy/requests";
import type { ContactKind } from "@/domain/request";
import { DayField, SelectField, TextField } from "@/ui/fields";
import { CheckIcon } from "@/ui/icons";
import { SubmitButton } from "@/ui/SubmitButton";
import { confirmContact, saveContact, stopIt, type ContactAnswer } from "./actions";

function Said({ answer, done }: { answer: ContactAnswer; done?: string }) {
  if (answer.error)
    return (
      <p key={answer.error} role="alert" className="said" data-bad>
        {requestError(answer.error)}
      </p>
    );
  return answer.saved && done ? (
    <p role="status" className="said">
      <CheckIcon size={16} />
      {done}
    </p>
  ) : null;
}

const TYPED: Record<ContactKind, "email" | "tel" | "url" | "text"> = {
  email: "email",
  whatsapp: "tel",
  phone: "tel",
  portal: "url",
  visit: "text",
};
const VALUE_LABEL: Record<ContactKind, string> = {
  email: "البريد",
  whatsapp: "رقم الواتساب",
  phone: "الرقم",
  portal: "رابط البوابة",
  visit: "الفرع أو المكتب",
};

/** A new way of reaching a lender: what it is, who answers, and where it came from. */
export function ContactForm({ lenders, today }: { lenders: { id: number; name: string }[]; today: string }) {
  const [answer, send] = useActionState<ContactAnswer, FormData>(saveContact, {});
  const options = Object.fromEntries(lenders.map((l) => [`l${l.id}`, l.name])) as Record<string, string>;
  const [lender, setLender] = useState(lenders[0] ? `l${lenders[0].id}` : "");
  const [kind, setKind] = useState<ContactKind>("email");
  const [value, setValue] = useState("");
  const [person, setPerson] = useState("");
  const [source, setSource] = useState("");
  const [day, setDay] = useState<string | null>(null);
  return (
    <form className="contact-form" action={send}>
      <input type="hidden" name="lenderId" value={lender} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="checkedOn" value={day ?? ""} />
      <SelectField label="الجهة" value={lender} onChange={setLender} options={options} />
      <SelectField label="الوسيلة" value={kind} onChange={setKind} options={CONTACT_KIND} />
      <TextField label={VALUE_LABEL[kind]} name="value" value={value} onChange={setValue} maxLength={200} typed={TYPED[kind]} />
      <TextField label="الشخص أو القسم" name="person" value={person} onChange={setPerson} maxLength={120} placeholder="اختياري" />
      <TextField label="المصدر" name="source" value={source} onChange={setSource} maxLength={200} placeholder="مثلاً: موقع الجهة الرسمي، أو بطاقة الموظف" />
      <DayField label="يوم التحقق" value={day} onChange={setDay} max={today} />
      <SubmitButton className="btn btn--navy" disabled={!lender || value.trim().length < 3 || (day != null && source.trim().length < 3)}>
        احفظ الوسيلة
      </SubmitButton>
      <Said answer={answer} done="حُفظت" />
    </form>
  );
}

/** Someone checked the way still reaches the lender: against what, and on which day. */
export function CheckForm({ contactId, source: before, today }: { contactId: number; source: string | null; today: string }) {
  const [answer, send] = useActionState<ContactAnswer, FormData>(confirmContact.bind(null, contactId), {});
  const [source, setSource] = useState(before ?? "");
  const [day, setDay] = useState<string | null>(today);
  return (
    <details className="know-remove contact-check">
      <summary>تحققت منها</summary>
      <form action={send}>
        <input type="hidden" name="checkedOn" value={day ?? ""} />
        <TextField label="تحققت مقابل" name="source" value={source} onChange={setSource} maxLength={200} placeholder="مثلاً: اتصلت بالرقم الموحد للجهة" />
        <DayField label="يوم التحقق" value={day} onChange={setDay} max={today} />
        <SubmitButton className="btn btn--soft" disabled={source.trim().length < 3 || !day}>
          سجّل التحقق
        </SubmitButton>
        <Said answer={answer} />
      </form>
    </details>
  );
}

/** Stops a way the office no longer uses. What was sent through it still says where. */
export function StopButton({ contactId }: { contactId: number }) {
  const [answer, send] = useActionState<ContactAnswer, FormData>(stopIt.bind(null, contactId), {});
  return (
    <details className="know-remove">
      <summary>أوقفها</summary>
      <form action={send}>
        <SubmitButton className="btn btn--soft">نعم، لم نعد نستخدمها</SubmitButton>
        <Said answer={answer} />
      </form>
    </details>
  );
}
