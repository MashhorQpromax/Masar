"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LEVER } from "@/copy/compare";
import { STRUCTURE } from "@/copy/deal";
import { FINANCE_BASE } from "@/copy/editor";
import { LEVERS, type FinanceBase, type Lever, type Levers, type Structure } from "@/domain/deal";
import { NumberField, SelectField } from "@/ui/fields";

/** What each lever stands at in the deal, for the form to start from and to show as the estimate. */
export interface LeverStart {
  structure: Structure;
  settlePct: number;
  financePct: number;
  financeBase: FinanceBase;
  bankMortgage: number | null;
  bankPersonal: number | null;
  propertyValue: number | null;
  /** What the engine counts when there is no offer, shown in an empty offer field. */
  estimate: { mortgage: number; personal: number };
}

/**
 * The scenario's levers. Each starts as the deal has it, or as the scenario moved it, and the address
 * of the comparison carries the ones that differ, so a scenario can be shared and opened again.
 */
export function ScenarioForm({ dealId, start, levers }: { dealId: number; start: LeverStart; levers: Levers }) {
  const router = useRouter();
  const [x, setX] = useState({
    structure: levers.structure ?? start.structure,
    settlePct: levers.settlePct ?? start.settlePct,
    financePct: levers.financePct ?? start.financePct,
    financeBase: levers.financeBase ?? start.financeBase,
    discountPct: levers.discountPct ?? null,
    bankMortgage: levers.bankMortgage ?? start.bankMortgage,
    bankPersonal: levers.bankPersonal ?? start.bankPersonal,
    propertyValue: levers.propertyValue ?? start.propertyValue,
  });
  const set = (patch: Partial<typeof x>) => setX((prev) => ({ ...prev, ...patch }));

  function compare() {
    // A lever as the deal has it is no change, and neither is a discount of nothing. An emptied offer is the deal's own.
    const asIs: Record<Lever, unknown> = { ...start, discountPct: null };
    const params = new URLSearchParams();
    for (const lever of LEVERS) {
      const value = lever === "discountPct" && x.discountPct === 0 ? null : x[lever];
      if (value != null && value !== asIs[lever]) params.set(lever, String(value));
    }
    const query = params.toString();
    router.push(`/deals/${dealId}/compare${query ? `?${query}` : ""}`, { scroll: false });
  }

  return (
    <form
      className="cmp-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        compare();
      }}
    >
      <div className="fields">
        <SelectField label={LEVER.structure} value={x.structure} onChange={(structure) => set({ structure })} options={STRUCTURE} />
        <NumberField label={LEVER.settlePct} suffix="%" decimals={1} max={35} value={x.settlePct} onChange={(settlePct) => set({ settlePct: settlePct ?? 0 })} />
        <NumberField label={LEVER.financePct} suffix="%" decimals={1} max={35} value={x.financePct} onChange={(financePct) => set({ financePct: financePct ?? 0 })} />
        <SelectField label={LEVER.financeBase} value={x.financeBase} onChange={(financeBase) => set({ financeBase })} options={FINANCE_BASE} />
        <NumberField label={LEVER.discountPct} suffix="%" max={95} value={x.discountPct} onChange={(discountPct) => set({ discountPct })} placeholder="0" />
        <NumberField label={LEVER.bankMortgage} money value={x.bankMortgage} onChange={(bankMortgage) => set({ bankMortgage })} placeholder={start.estimate.mortgage.toLocaleString("en-US")} />
        <NumberField label={LEVER.bankPersonal} money value={x.bankPersonal} onChange={(bankPersonal) => set({ bankPersonal })} placeholder={start.estimate.personal.toLocaleString("en-US")} />
        <NumberField label={LEVER.propertyValue} money value={x.propertyValue} onChange={(propertyValue) => set({ propertyValue })} />
      </div>
      <button type="submit" className="btn btn--navy">
        قارن
      </button>
    </form>
  );
}
