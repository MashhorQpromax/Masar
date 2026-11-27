"use client";

import { useActionState, useEffect, useState } from "react";
import { contactError, ID_LABEL, NATIONALITY } from "@/copy/clients";
import type { ClientNationality } from "@/domain/clients";
import { Segmented, TextField } from "@/ui/fields";
import { CheckIcon } from "@/ui/icons";
import { SubmitButton } from "@/ui/SubmitButton";
import { saveContact, type CardAnswer } from "./actions";

export interface ContactDraft {
  phone: string;
  nationality: ClientNationality;
  nationalId: string;
  employer: string;
  city: string;
  email: string;
}

const MESSAGES = { one: "رسالة واحدة", two: "رسالتان", few: "رسائل", many: "رسالة" };
const joined = (n: number): string => (n === 1 ? MESSAGES.one : n === 2 ? MESSAGES.two : n <= 10 ? `${n} ${MESSAGES.few}` : `${n} ${MESSAGES.many}`);

/**
 * How a client is reached and who they are on paper. What was typed stays in the fields when the
 * save is refused, with the reason beside the button.
 */
export function ContactForm({ clientId, contact }: { clientId: number; contact: ContactDraft }) {
  const [answer, send] = useActionState<CardAnswer, FormData>(saveContact.bind(null, clientId), {});
  const [draft, setDraft] = useState(contact);
  const set = <K extends keyof ContactDraft>(key: K, value: ContactDraft[K]) => setDraft((before) => ({ ...before, [key]: value }));
  const changed = (Object.keys(contact) as (keyof ContactDraft)[]).some((key) => draft[key].trim() !== contact[key]);

  // The fields follow what is kept: after a save they show it as it was stored (a phone typed with
  // spaces comes back plain), and so does a change made from elsewhere. A refresh of the page that
  // changed nothing here leaves what is being typed alone, and so does a refusal.
  const kept = JSON.stringify(contact);
  useEffect(() => {
    setDraft(contact);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kept]);
  useEffect(() => {
    if (answer.done) setDraft(contact);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer]);

  return (
    <form action={send} className="contact">
      <div className="fields fields--contact">
        <TextField label="الجوال" name="phone" typed="tel" value={draft.phone} onChange={(phone) => set("phone", phone)} placeholder="05xxxxxxxx" maxLength={20} />
        <div className="field">
          <span className="field-label">الجنسية</span>
          <Segmented label="الجنسية" value={draft.nationality} onChange={(nationality) => set("nationality", nationality)} options={NATIONALITY} />
          <input type="hidden" name="nationality" value={draft.nationality} />
        </div>
        <TextField label={ID_LABEL[draft.nationality]} name="nationalId" typed="digits" value={draft.nationalId} onChange={(nationalId) => set("nationalId", nationalId)} maxLength={14} />
        <TextField label="المدينة" name="city" value={draft.city} onChange={(city) => set("city", city)} maxLength={60} />
        <TextField label="جهة العمل" name="employer" wide value={draft.employer} onChange={(employer) => set("employer", employer)} />
        <TextField label="البريد الإلكتروني" name="email" typed="email" wide value={draft.email} onChange={(email) => set("email", email)} maxLength={160} />
      </div>
      <div className="contact-foot">
        <SubmitButton className="btn btn--navy">احفظ</SubmitButton>
        {answer.error ? (
          <p key={answer.error + JSON.stringify(answer.params)} role="alert" className="said" data-bad>
            {contactError(answer.error, answer.params)}
          </p>
        ) : (
          answer.done &&
          !changed && (
            <p role="status" className="said">
              <CheckIcon size={16} />
              {answer.adopted ? `حُفظت، وانضمت إلى ملفه ${joined(answer.adopted)} وصلت من هذا الرقم.` : "حُفظت."}
            </p>
          )
        )}
      </div>
    </form>
  );
}
