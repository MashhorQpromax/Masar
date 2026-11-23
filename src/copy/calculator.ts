/** The wording of the calculator: a first answer from a few facts, with nothing kept. */
import type { Capacity, Match, QuickVerdict, RecordStanding } from "@/domain/eligibility";
import { capRuleText } from "./eligibility";
import { counted, money, months, type CountForms } from "./format";

export const RECORD_STANDING: Record<RecordStanding, string> = {
  clean: "نظيف",
  late: "عليه تأخر",
  default: "عليه تعثر",
  unknown: "غير معروف",
};

export const QUICK_VERDICT: Record<QuickVerdict, string> = {
  eligible: "مؤهل",
  conditional: "مؤهل بشروط",
  not_eligible: "غير مؤهل الآن",
};

const TAKING: CountForms = { one: "جهة واحدة تقبل", two: "جهتان تقبلان", few: "جهات تقبل", many: "جهة تقبل" };
const OTHERS: CountForms = { one: "جهة أخرى تقبل", two: "جهتان أخريان تقبلان", few: "جهات أخرى تقبل", many: "جهة أخرى تقبل" };
const REFUSING: CountForms = { one: "جهة لا تقبل الآن", two: "جهتان لا تقبلان الآن", few: "جهات لا تقبل الآن", many: "جهة لا تقبل الآن" };

/** How many products take the client. */
export const takingText = (n: number): string => (n ? counted(n, TAKING) : "لا جهة تقبل بهذه الأرقام");
/** The ones kept under the first few. */
export const othersText = (n: number): string => counted(n, OTHERS);
export const refusingText = (n: number): string => counted(n, REFUSING);

/** Where the largest amount is, and what it costs every month. */
export function largestOfferText(m: Match): string {
  const terms = `بقسط ${money(m.installment)} لمدة ${months(m.tenor)}`;
  // With an amount asked for, the installment is the one of that amount, not of the largest.
  return m.offerPrincipal < m.maxPrincipal ? `عند ${m.product.lenderName}. المطلوب ${money(m.offerPrincipal)} ${terms}.` : `عند ${m.product.lenderName}، ${terms}.`;
}

/** The rule that holds the new installment. */
export const heldByText = (c: Capacity): string => `القسط الجديد يحكمه ${capRuleText(c.rule, c.capUsed, c)}.`;

/** What an installment falls to once the client retires. */
export const afterRetirementText = (installment: number): string => `بعد التقاعد ${money(installment)}`;

/** That the installment steps down, said beside a lender whose row already shows the installment after. */
export const stepsDownText = (monthsToRetirement: number): string => `يتقاعد بعد ${months(monthsToRetirement)}، وينزل القسط بعدها.`;

/** The most a product would lend, when less was asked for. */
export const upToText = (amount: number): string => `حتى ${money(amount)}`;
