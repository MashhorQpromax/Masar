"use client";

import { useState, useTransition } from "react";
import { LENDER_TYPE, lenderError } from "@/copy/lenders";
import type { LenderType } from "@/domain/eligibility";
import { Segmented, TextField } from "@/ui/fields";
import { CheckIcon } from "@/ui/icons";
import { saveLender, type TermsAnswer } from "./actions";

/** A lender the office started dealing with: its name and whether it is a bank. Its products come next. */
export function LenderForm() {
  const [name, setName] = useState("");
  const [type, setType] = useState<LenderType>("bank");
  const [answer, setAnswer] = useState<TermsAnswer & { name?: string }>({});
  const [busy, run] = useTransition();

  return (
    <form
      className="lender-form"
      onSubmit={(event) => {
        event.preventDefault();
        const added = name.trim();
        run(async () => {
          const result = await saveLender({ name: added, type });
          setAnswer({ ...result, name: added });
          if (result.saved) setName("");
        });
      }}
    >
      <TextField
        label="اسم الجهة"
        value={name}
        onChange={(value) => {
          setName(value);
          setAnswer({});
        }}
        maxLength={80}
        placeholder="كما تكتبه الجهة عن نفسها"
      />
      <div className="field">
        <span className="field-label">نوعها</span>
        <Segmented label="نوعها" value={type} onChange={setType} options={LENDER_TYPE} />
      </div>
      <button type="submit" className="btn btn--navy" disabled={busy || name.trim().length < 2} aria-busy={busy}>
        أضف الجهة
      </button>
      {answer.error ? (
        <p key={answer.error} role="alert" className="said" data-bad>
          {lenderError(answer.error, answer.params)}
        </p>
      ) : (
        answer.saved &&
        !busy && (
          <p role="status" className="said">
            <CheckIcon size={16} />
            أُضيفت {answer.name}. أضف منتجها الأول من بطاقتها.
          </p>
        )
      )}
    </form>
  );
}
