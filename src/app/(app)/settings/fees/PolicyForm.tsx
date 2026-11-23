"use client";

import { useState, useTransition } from "react";
import { FINANCE_BASE } from "@/copy/editor";
import { policyError, policyText } from "@/copy/fees";
import { policyProblem, type FeePolicy } from "@/domain/deal";
import { NumberField, SelectField } from "@/ui/fields";
import { saveFeePolicy } from "./actions";

/**
 * The fee policy: the two percents a new deal starts from, what the finance percent is counted on, and
 * the range no deal's percent may leave. What it will say is shown as it is typed.
 */
export function PolicyForm({ policy }: { policy: FeePolicy }) {
  const [x, setX] = useState(policy);
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (patch: Partial<FeePolicy>) => {
    setX((prev) => ({ ...prev, ...patch }));
    setSaid(null);
  };
  const problem = policyProblem(x);
  const same = JSON.stringify(x) === JSON.stringify(policy);

  function save() {
    startTransition(async () => {
      const answer = await saveFeePolicy(x);
      setSaid(answer.ok ? { text: "حُفظت. الصفقات الجديدة تبدأ منها، والمحفوظة تبقى على أتعابها.", bad: false } : { text: policyError(answer.error ?? "", answer.params), bad: true });
    });
  }

  return (
    <form
      className="tile form-tile policy"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <h2 className="form-title">ما تبدأ به كل صفقة</h2>
      <div className="fields">
        <NumberField label="على السداد" suffix="%" decimals={1} max={100} value={x.settlePct} onChange={(pct) => set({ settlePct: pct ?? 0 })} />
        <NumberField label="على استخراج التمويل" suffix="%" decimals={1} max={100} value={x.financePct} onChange={(pct) => set({ financePct: pct ?? 0 })} />
        <SelectField label="نسبة التمويل تُحسب على" value={x.financeBase} onChange={(financeBase) => set({ financeBase })} options={FINANCE_BASE} />
      </div>
      <h2 className="form-title">الحدان</h2>
      <div className="fields">
        <NumberField label="أدنى نسبة" suffix="%" decimals={1} max={100} value={x.min} onChange={(pct) => set({ min: pct ?? 0 })} />
        <NumberField label="أعلى نسبة" suffix="%" decimals={1} max={100} value={x.max} onChange={(pct) => set({ max: pct ?? 0 })} hint="لا تُحفظ صفقة بنسبة خارجهما" />
      </div>
      {!same && <p className="due">{problem ? policyError("POLICY_REFUSED", { reason: problem }) : `بعد الحفظ: ${policyText(x)}`}</p>}
      <button type="submit" className="btn btn--navy" disabled={pending || same || problem != null}>
        احفظ السياسة
      </button>
      {said && (
        <p key={said.text} role={said.bad ? "alert" : "status"} className="said" data-bad={said.bad || undefined}>
          {said.text}
        </p>
      )}
    </form>
  );
}
