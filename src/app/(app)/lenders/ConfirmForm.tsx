"use client";

import { useState, useTransition } from "react";
import { lenderError, SOURCE_KIND, SOURCE_REFERENCE, TERM_NAME } from "@/copy/lenders";
import { REFERENCE_MAX, REFERENCE_MIN, type SourceKind, type Term } from "@/domain/eligibility";
import { DayField, Segmented, TextField } from "@/ui/fields";
import { CheckIcon } from "@/ui/icons";
import { confirmProductTerms, type TermsAnswer } from "./actions";

/**
 * Confirms terms of one product with the source that states them. The person picks what the source
 * speaks for, says what kind of source it is and what names it. Nothing is picked for them: a term is
 * confirmed only because somebody read it in the source.
 */
export function ConfirmForm({ productId, terms, open, today }: { productId: number; terms: Term[]; open: Term[]; today: string }) {
  const [picked, setPicked] = useState<Term[]>([]);
  const [kind, setKind] = useState<SourceKind>("lender_document");
  const [reference, setReference] = useState("");
  const [day, setDay] = useState<string | null>(today);
  const [answer, setAnswer] = useState<TermsAnswer>({});
  const [busy, run] = useTransition();
  const changed = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setAnswer({});
  };
  const complete = picked.length > 0 && reference.trim().length >= REFERENCE_MIN && day != null;
  const allOpen = open.length > 0 && open.every((term) => picked.includes(term));

  function save() {
    run(async () => {
      const result = await confirmProductTerms(productId, { terms: picked, kind, reference, confirmedOn: day ?? undefined });
      setAnswer(result);
      if (result.saved) {
        setPicked([]);
        setReference("");
      }
    });
  }

  return (
    <form
      className="confirm"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <fieldset className="terms-chips">
        <legend className="field-label">ما الذي يذكره المصدر؟</legend>
        {terms.map((term) => (
          <label key={term} className="ask-chip" data-open={open.includes(term) || undefined}>
            <input type="checkbox" checked={picked.includes(term)} onChange={(event) => changed(setPicked)(terms.filter((each) => (each === term ? event.target.checked : picked.includes(each))))} />
            <span>{TERM_NAME[term]}</span>
          </label>
        ))}
        {open.length > 1 && (
          <button type="button" className="chip-all" aria-pressed={allOpen} onClick={() => changed(setPicked)(allOpen ? picked.filter((term) => !open.includes(term)) : terms.filter((term) => open.includes(term) || picked.includes(term)))}>
            كل ما لم يؤكَّد
          </button>
        )}
      </fieldset>
      <div className="field">
        <span className="field-label">نوع المصدر</span>
        <Segmented label="نوع المصدر" value={kind} onChange={changed(setKind)} options={SOURCE_KIND} />
      </div>
      <div className="confirm-what">
        <TextField label={SOURCE_REFERENCE[kind]} value={reference} onChange={changed(setReference)} maxLength={REFERENCE_MAX} typed={kind === "lender_website" ? "url" : "text"} />
        <DayField label="يوم التأكد" value={day} onChange={changed(setDay)} max={today} />
      </div>
      <div className="terms-save">
        <button type="submit" className="btn btn--navy" disabled={busy || !complete} aria-busy={busy}>
          أكّد
        </button>
        {answer.error ? (
          <p key={`${answer.error}${answer.params?.problem ?? ""}`} role="alert" className="said" data-bad>
            {lenderError(answer.error, answer.params)}
          </p>
        ) : (
          answer.saved &&
          !busy && (
            <p role="status" className="said">
              <CheckIcon size={16} />
              أُكّد بمصدره
            </p>
          )
        )}
      </div>
    </form>
  );
}
