/** Wording of the office's fee policy and of a deal's fee: what it is, and why a change was refused. */
import { FEE_REASON_MIN, type Fee, type FeePolicy, type PolicyProblem } from "@/domain/deal";
import { FINANCE_BASE } from "./editor";
import { ltr, money, percent } from "./format";

/** A deal's fee in one line: "10% على السداد و12% على كامل التمويل". */
export function feeText(fee: Pick<Fee, "settlePct" | "financePct" | "financeBase" | "settleIncludesPayoff" | "fixed">): string {
  const parts = [`${percent(fee.settlePct)} على السداد${fee.settleIncludesPayoff ? " والمخالصات" : ""}`, `${percent(fee.financePct)} على ${FINANCE_BASE[fee.financeBase]}`];
  if (fee.fixed > 0) parts.push(`مبلغ مقطوع ${money(fee.fixed)}`);
  return parts.join(" و");
}

/** The range a deal's percents stay in. */
export const rangeText = (policy: Pick<FeePolicy, "min" | "max">): string => `الحدود من ${percent(policy.min)} إلى ${percent(policy.max)}`;

/** The policy in one sentence, as the settings page and the editor tell it. */
export const policyText = (policy: FeePolicy): string => `تبدأ كل صفقة جديدة بـ ${feeText({ ...policy, settleIncludesPayoff: false, fixed: 0 })}. ${rangeText(policy)}.`;

/** Asked beside the fee once it differs from what the deal had, or from the policy. */
export const FEE_REASON_ASK = "سبب تعديل الأتعاب";
export const FEE_REASON_HINT = `يُحفظ في سجل التدقيق مع النسبة قبل التعديل وبعده، ${ltr(FEE_REASON_MIN)} أحرف على الأقل.`;

/** Beside the fee of someone who may change a deal but not its fee. */
export const FEE_LOCKED = "تعديل الأتعاب لمن يملك صلاحيتها.";

const POLICY_PROBLEM: Record<PolicyProblem, string> = {
  RANGE: "الحد الأدنى أعلى من الأعلى، أو أحدهما خارج صفر إلى مئة.",
  START_OUTSIDE: "النسبة التي تبدأ بها الصفقات خارج الحدين.",
};

/** What to tell the manager when the policy was not kept. */
export function policyError(code: string, params: Record<string, string> = {}): string {
  if (code === "POLICY_REFUSED" && params.reason && params.reason in POLICY_PROBLEM) return POLICY_PROBLEM[params.reason as PolicyProblem];
  if (code === "FORBIDDEN") return "سياسة الأتعاب لمدير النظام وحده.";
  if (code === "INVALID_INPUT") return "في النسب قيمة غير مقبولة. راجعها ثم احفظ.";
  return "تعذر الحفظ. حاول مرة أخرى.";
}

export const POLICY_PROBLEMS = Object.keys(POLICY_PROBLEM) as PolicyProblem[];
