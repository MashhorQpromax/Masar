"use client";

import { useState, useTransition } from "react";
import { lenderError, RATE_TYPE } from "@/copy/lenders";
import type { RateType } from "@/domain/finance";
import type { ProductTerms } from "@/server/lenders/input";
import { Check, NumberField, Segmented } from "@/ui/fields";
import { CheckIcon } from "@/ui/icons";
import { saveProductTerms, type TermsAnswer } from "./actions";

type AfterDefault = "unknown" | "now" | "wait";
const AFTER_DEFAULT: Record<AfterDefault, string> = { unknown: "لم نؤكد", now: "تقبل فوراً", wait: "تنتظر مدة" };

/** The terms of one product, as a person corrects them after asking the lender. */
export function ProductForm({ productId, mortgage, initial }: { productId: number; mortgage: boolean; initial: ProductTerms }) {
  const [terms, setTerms] = useState(initial);
  const [after, setAfter] = useState<AfterDefault>(initial.settledDefaultWaitMonths == null ? "unknown" : initial.settledDefaultWaitMonths === 0 ? "now" : "wait");
  const [answer, setAnswer] = useState<TermsAnswer>({});
  const [busy, start] = useTransition();
  const set = (patch: Partial<ProductTerms>) => {
    setTerms((current) => ({ ...current, ...patch }));
    setAnswer({});
  };
  // An emptied number keeps the form from saving until it is filled again.
  const num = (key: "rate" | "maxAmount" | "maxTenor" | "maxAgeAtMaturity" | "minSalary" | "minServiceMonths") => (value: number | null) => set({ [key]: value ?? Number.NaN });
  const shown = (value: number) => (Number.isNaN(value) ? null : value);
  const wait = after === "unknown" ? null : after === "now" ? 0 : terms.settledDefaultWaitMonths || null;
  const complete = Object.values(terms).every((value) => typeof value !== "number" || !Number.isNaN(value)) && (after !== "wait" || !!wait);

  return (
    <form
      className="terms"
      onSubmit={(event) => {
        event.preventDefault();
        start(async () => setAnswer(await saveProductTerms(productId, { ...terms, settledDefaultWaitMonths: wait })));
      }}
    >
      <div className="fields">
        <NumberField label="الهامش السنوي" suffix="%" decimals={2} max={30} value={shown(terms.rate)} onChange={num("rate")} />
        <div className="field">
          <span className="field-label">نوع الهامش</span>
          <Segmented label="نوع الهامش" value={terms.rateType as RateType} onChange={(rateType) => set({ rateType })} options={RATE_TYPE} />
        </div>
        <NumberField label="أقصى مبلغ" money max={10_000_000_000} value={shown(terms.maxAmount)} onChange={num("maxAmount")} />
        <NumberField label="أقصى مدة" suffix="شهراً" max={420} value={shown(terms.maxTenor)} onChange={num("maxTenor")} />
        <NumberField label="أقصى عمر عند آخر قسط" suffix="سنة" grouped={false} max={90} value={shown(terms.maxAgeAtMaturity)} onChange={num("maxAgeAtMaturity")} />
        <NumberField label="أدنى راتب" money max={10_000_000} value={shown(terms.minSalary)} onChange={num("minSalary")} />
        <NumberField label="أدنى مدة خدمة" suffix="شهراً" max={720} value={shown(terms.minServiceMonths)} onChange={num("minServiceMonths")} />
        {mortgage && <NumberField label="نسبة التمويل من قيمة العقار" suffix="%" decimals={1} max={100} value={terms.maxLtv} onChange={(maxLtv) => set({ maxLtv })} />}
      </div>
      <div className="terms-asks">
        <Check label="تشترط تحويل الراتب" checked={terms.requiresSalaryTransfer} onChange={(requiresSalaryTransfer) => set({ requiresSalaryTransfer })} />
        <Check label="تقبل تأخر السداد في سمة" checked={terms.acceptsLateSimah} onChange={(acceptsLateSimah) => set({ acceptsLateSimah })} />
      </div>
      <div className="terms-after">
        <div className="field">
          <span className="field-label">من سدّد تعثره</span>
          <Segmented
            label="من سدّد تعثره"
            value={after}
            onChange={(next) => {
              setAfter(next);
              setAnswer({});
            }}
            options={AFTER_DEFAULT}
          />
        </div>
        {after === "wait" && (
          <NumberField label="مدة الانتظار بعد السداد" suffix="شهراً" max={120} value={terms.settledDefaultWaitMonths || null} onChange={(settledDefaultWaitMonths) => set({ settledDefaultWaitMonths })} />
        )}
      </div>
      <div className="terms-save">
        <Check label="أكّدنا هذه الشروط مع الجهة" checked={terms.verified} onChange={(verified) => set({ verified })} />
        <button type="submit" className="btn btn--navy" disabled={busy || !complete} aria-busy={busy}>
          احفظ
        </button>
        {answer.error ? (
          <p key={answer.error} role="alert" className="said" data-bad>
            {lenderError(answer.error)}
          </p>
        ) : (
          answer.saved &&
          !busy && (
            <p role="status" className="said">
              <CheckIcon size={16} />
              حُفظت الشروط
            </p>
          )
        )}
      </div>
    </form>
  );
}
