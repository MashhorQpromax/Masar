/** The words of comparing two scenarios of a deal. */
import type { CompareRow, FinanceBase, Lever, Levers, Structure } from "@/domain/deal";
import { STRUCTURE } from "./deal";
import { FINANCE_BASE } from "./editor";
import { money, percent, plainMoney } from "./format";

export const COMPARE_ROW: Record<CompareRow, string> = {
  mortgage: "التمويل العقاري",
  personal: "التمويل الشخصي",
  obligations: "الالتزامات",
  costs: "الرسوم والتكاليف",
  fee: "أتعابنا",
  clientNet: "يبقى للعميل",
  capital: "رأس مالنا في الصفقة",
};

export const SIDE = { a: "الصفقة كما هي", b: "السيناريو", diff: "الفرق" } as const;

/** Under the comparison: what a scenario is, and is not. */
export const WHAT_IF = "حساب افتراضي: لا يغيّر الصفقة ولا يُعرض على العميل.";

/** The difference on one row, signed, in riyals. */
export function diffText(diff: number): string {
  if (diff === 0) return "لا فرق";
  return diff > 0 ? `+${plainMoney(diff)}` : plainMoney(diff);
}

/** The name of each lever, as the form asks it. */
export const LEVER: Record<Lever, string> = {
  structure: "الهيكل",
  settlePct: "أتعاب السداد %",
  financePct: "أتعاب التمويل %",
  financeBase: "أتعاب التمويل على",
  discountPct: "خصم على التنفيذ والمتعثرات %",
  bankMortgage: "عرض الجهة للعقاري",
  bankPersonal: "عرض الجهة للشخصي",
  propertyValue: "قيمة العقار",
};

/** One moved lever, in a few words. */
export function leverText(lever: Lever, levers: Levers): string {
  const value = levers[lever];
  switch (lever) {
    case "structure":
      return STRUCTURE[value as Structure];
    case "settlePct":
      return `أتعاب السداد ${percent(Number(value))}`;
    case "financePct":
      return `أتعاب التمويل ${percent(Number(value))}`;
    case "financeBase":
      return `أتعاب التمويل على ${FINANCE_BASE[value as FinanceBase]}`;
    case "discountPct":
      return `خصم ${percent(Number(value))} على التنفيذ والمتعثرات`;
    case "bankMortgage":
      return `عرض عقاري ${money(Number(value))}`;
    case "bankPersonal":
      return `عرض شخصي ${money(Number(value))}`;
    case "propertyValue":
      return `قيمة العقار ${money(Number(value))}`;
  }
}

/** What the scenario moves, as its title. */
export function scenarioText(moved: readonly Lever[], levers: Levers): string {
  return moved.length === 0 ? "مثل الصفقة، لم يتغير شيء" : moved.map((lever) => leverText(lever, levers)).join("، ");
}

/** The quick scenarios offered first. */
export const PRESET = {
  structure: (structure: Structure) => `الهيكل: ${STRUCTURE[structure]}`,
  feeMin: (pct: number) => `الأتعاب ${percent(pct)} على كل جزء`,
  discount: (pct: number) => `خصم ${percent(pct)} يغلقها`,
} as const;
