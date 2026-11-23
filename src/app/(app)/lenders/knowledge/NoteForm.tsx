"use client";

import { useId, useState, useTransition } from "react";
import { FINANCE_TYPE } from "@/copy/eligibility";
import { knowledgeError, RULE_KIND, RULE_KIND_HINT } from "@/copy/knowledge";
import type { FinanceType } from "@/domain/eligibility";
import type { RuleKind } from "@/domain/knowledge";
import { Segmented, SelectField, TextField } from "@/ui/fields";
import { CheckIcon } from "@/ui/icons";
import { saveNote, type NoteAnswer } from "./actions";

const EVERY = "all";
type Kinds = Partial<Record<FinanceType, string>>;

/** Something a person learned about a lender, written down for whoever handles the next client. */
export function NoteForm({ lenders, kinds }: { lenders: { id: number; name: string }[]; kinds: FinanceType[] }) {
  const [kind, setKind] = useState<RuleKind>("condition");
  const [lender, setLender] = useState(EVERY);
  const [financeType, setFinanceType] = useState<FinanceType | typeof EVERY>(EVERY);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [answer, setAnswer] = useState<NoteAnswer>({});
  const [busy, start] = useTransition();
  const bodyId = useId();
  const touched = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setAnswer({});
  };

  const lenderOptions: Record<string, string> = { [EVERY]: "كل الجهات", ...Object.fromEntries(lenders.map((l) => [`l${l.id}`, l.name])) };
  const kindOptions = { [EVERY]: "كل الأنواع", ...(Object.fromEntries(kinds.map((k) => [k, FINANCE_TYPE[k]])) as Kinds) } as Record<FinanceType | typeof EVERY, string>;
  const ready = title.trim().length >= 3;

  return (
    <form
      className="know-form"
      onSubmit={(event) => {
        event.preventDefault();
        start(async () => {
          const said = await saveNote({
            lenderId: lender === EVERY ? null : Number(lender.slice(1)),
            financeType: financeType === EVERY ? null : financeType,
            kind,
            title,
            body: body || null,
          });
          setAnswer(said);
          if (said.saved) {
            setTitle("");
            setBody("");
          }
        });
      }}
    >
      <div className="field">
        <span className="field-label">نوعها</span>
        <Segmented label="نوع الملاحظة" value={kind} onChange={touched(setKind)} options={RULE_KIND} />
        <p className="know-hint">{RULE_KIND_HINT[kind]}</p>
      </div>
      <div className="fields">
        <SelectField label="الجهة" value={lender} onChange={touched(setLender)} options={lenderOptions} />
        <SelectField label="التمويل" value={financeType} onChange={touched(setFinanceType)} options={kindOptions} />
      </div>
      <TextField label="العنوان" value={title} onChange={touched(setTitle)} placeholder="تطلب فحصاً طبياً لمن فوق 55" maxLength={120} />
      <div className="field">
        <label className="field-label" htmlFor={bodyId}>
          التفاصيل
        </label>
        <textarea id={bodyId} className="note-text" value={body} onChange={(event) => touched(setBody)(event.target.value)} placeholder="متى ينطبق، وما الذي نجح" maxLength={600} rows={3} />
      </div>
      <div className="know-save">
        <button type="submit" className="btn btn--navy" disabled={busy || !ready} aria-busy={busy}>
          احفظها
        </button>
        {answer.error ? (
          <p key={answer.error} role="alert" className="said" data-bad>
            {knowledgeError(answer.error)}
          </p>
        ) : (
          answer.saved &&
          !busy && (
            <p role="status" className="said">
              <CheckIcon size={16} />
              حُفظت الملاحظة
            </p>
          )
        )}
      </div>
    </form>
  );
}
