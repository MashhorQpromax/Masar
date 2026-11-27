"use client";

import { useState, useTransition } from "react";
import { CONTRACT_TYPE, INQUIRY_WINDOW, SPECIAL_KIND, UNMET_CHOICE } from "@/copy/eligibility";
import { lenderError } from "@/copy/lenders";
import { CONDITION_TEXT_MAX, CONTRACT_TYPES, INQUIRIES_MAX, type ContractType, type SpecialKind, type Unmet } from "@/domain/eligibility";
import { NumberField, Segmented, SelectField, TextField } from "@/ui/fields";
import { CheckIcon } from "@/ui/icons";
import { saveCondition, type TermsAnswer } from "./actions";

/** What is written beside a condition a person answers, by its kind. */
const WORDS: Record<"employer" | "guarantor" | "collateral" | "other", string> = {
  employer: "القائمة أو التصنيف المطلوب",
  guarantor: "من يُقبل كفيلاً",
  collateral: "الضمان المطلوب",
  other: "الشرط بكلمات الجهة",
};

/**
 * Adds one special condition to a product. The person picks what the lender asks for and writes only
 * what that kind needs: an amount, a count, the contracts it takes, or the lender's own words.
 */
export function ConditionForm({ productId }: { productId: number }) {
  const [kind, setKind] = useState<SpecialKind>("min_amount");
  const [amount, setAmount] = useState<number | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [window, setWindow] = useState<"6" | "12">("6");
  const [contracts, setContracts] = useState<ContractType[]>([]);
  const [text, setText] = useState("");
  const [unmet, setUnmet] = useState<Unmet>("block");
  const [answer, setAnswer] = useState<TermsAnswer>({});
  const [busy, run] = useTransition();
  const changed = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setAnswer({});
  };

  const asked = kind === "employer" || kind === "guarantor" || kind === "collateral" || kind === "other";
  const input =
    kind === "min_amount"
      ? amount != null && amount >= 1000 && { kind, amount }
      : kind === "inquiries"
        ? count != null && { kind, count, months: Number(window) }
        : kind === "contract"
          ? contracts.length > 0 && contracts.length < CONTRACT_TYPES.length && { kind, contracts }
          : (kind !== "other" || text.trim().length >= 3) && { kind, text, unmet };

  function save() {
    if (!input) return;
    run(async () => {
      const result = await saveCondition(productId, input);
      setAnswer(result);
      if (result.saved) {
        setAmount(null);
        setCount(null);
        setContracts([]);
        setText("");
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
      <div className="cond-what">
        <SelectField label="شرط جديد" value={kind} onChange={changed(setKind)} options={SPECIAL_KIND} />
        {kind === "min_amount" && <NumberField label="أدنى مبلغ تموّله" money max={10_000_000_000} value={amount} onChange={changed(setAmount)} />}
        {kind === "inquiries" && <NumberField label="أقصى عدد تقبله" grouped={false} max={INQUIRIES_MAX} value={count} onChange={changed(setCount)} />}
        {asked && <TextField label={WORDS[kind]} value={text} onChange={changed(setText)} maxLength={CONDITION_TEXT_MAX} />}
      </div>
      {kind === "inquiries" && (
        <div className="field">
          <span className="field-label">تُعد الاستعلامات في</span>
          <Segmented label="تُعد الاستعلامات في" value={window} onChange={changed(setWindow)} options={INQUIRY_WINDOW} />
        </div>
      )}
      {kind === "contract" && (
        <fieldset className="terms-chips">
          <legend className="field-label">العقود التي تقبلها</legend>
          {CONTRACT_TYPES.map((contract) => (
            <label key={contract} className="ask-chip">
              <input type="checkbox" checked={contracts.includes(contract)} onChange={(event) => changed(setContracts)(CONTRACT_TYPES.filter((each) => (each === contract ? event.target.checked : contracts.includes(each))))} />
              <span>{CONTRACT_TYPE[contract]}</span>
            </label>
          ))}
        </fieldset>
      )}
      {asked && (
        <div className="field">
          <span className="field-label">من لا يستوفيه</span>
          <Segmented label="من لا يستوفيه" value={unmet} onChange={changed(setUnmet)} options={UNMET_CHOICE} />
        </div>
      )}
      <div className="terms-save">
        <button type="submit" className="btn btn--soft" disabled={busy || !input} aria-busy={busy}>
          أضف الشرط
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
              {answer.dropped ? "أُضيف. القائمة تغيّرت، فتأكيدها يُطلب من جديد." : "أُضيف الشرط"}
            </p>
          )
        )}
      </div>
    </form>
  );
}
