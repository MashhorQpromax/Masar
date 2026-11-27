/** Wording of the office's fee policy and of a deal's fee: what it is, and why a change was refused. */
import { collectedGap, FEE_REASON_MIN, type CollectedRefusal, type Fee, type FeeCollection, type FeeDue, type FeePart, type FeePlan, type FeePolicy, type FeeTerms, type PlanFigure, type PlanRefusal, type PolicyProblem } from "@/domain/deal";
import { FINANCE_BASE } from "./editor";
import { dayFull, ltr, money, percent } from "./format";

/** A deal's fee in one line: "10% على السداد و12% على كامل التمويل". */
export function feeText(fee: Pick<Fee, "settlePct" | "financePct" | "financeBase" | "settleIncludesPayoff" | "fixed">): string {
  const parts = [`${percent(fee.settlePct)} على السداد${fee.settleIncludesPayoff ? " والمخالصات" : ""}`, `${percent(fee.financePct)} على ${FINANCE_BASE[fee.financeBase]}`];
  if (fee.fixed > 0) parts.push(`مبلغ مقطوع ${money(fee.fixed)}`);
  return parts.join(" و");
}

/** The range a deal's percents stay in. */
export const rangeText = (policy: Pick<FeePolicy, "min" | "max">): string => `الحدود من ${percent(policy.min)} إلى ${percent(policy.max)}`;

/** When the fee falls due, as the settings offer it. */
export const FEE_DUE: Record<FeeDue, string> = {
  disbursement: "عند صرف التمويل",
  approval: "عند موافقة الجهة",
  agreement: "عند توقيع الاتفاق",
};

/** How the fee is collected, as the settings offer it. */
export const FEE_COLLECTION: Record<FeeCollection, string> = {
  deducted: "خصماً من التمويل",
  transfer: "بتحويل من العميل",
};

/** The terms a fee is owed on, in one clause: "تُستحق عند صرف التمويل وتُخصم منه". */
export const termsText = (terms: FeeTerms): string => `تُستحق ${FEE_DUE[terms.due]} ${terms.collection === "deducted" ? "وتُخصم منه" : "ويسددها العميل بتحويل"}`;

/** The policy in one sentence, as the settings page and the editor tell it. */
export const policyText = (policy: FeePolicy): string => `تبدأ كل صفقة جديدة بـ ${feeText({ ...policy, settleIncludesPayoff: false, fixed: 0 })}. ${rangeText(policy)}. ${termsText(policy)}.`;

/** Asked beside the fee once it differs from what the deal had, or from the policy. */
export const FEE_REASON_ASK = "سبب تعديل الأتعاب";
export const FEE_REASON_HINT = `يُحفظ في سجل التدقيق مع النسبة قبل التعديل وبعده، ${ltr(FEE_REASON_MIN)} أحرف على الأقل.`;

/** Beside the fee of someone who may change a deal but not its fee. */
export const FEE_LOCKED = "تعديل الأتعاب لمن يملك صلاحيتها.";

const POLICY_PROBLEM: Record<PolicyProblem, string> = {
  RANGE: "الحد الأدنى أعلى من الأعلى، أو أحدهما خارج صفر إلى مئة.",
  START_OUTSIDE: "النسبة التي تبدأ بها الصفقات خارج الحدين.",
  TERMS: "الخصم من التمويل يكون عند صرفه. اجعل الاستحقاق عند الصرف، أو اختر التحويل.",
};

/** What to tell the manager when the policy was not kept. */
export function policyError(code: string, params: Record<string, string> = {}): string {
  if (code === "POLICY_REFUSED" && params.reason && params.reason in POLICY_PROBLEM) return POLICY_PROBLEM[params.reason as PolicyProblem];
  if (code === "FORBIDDEN") return "سياسة الأتعاب لمدير النظام وحده.";
  if (code === "INVALID_INPUT") return "في النسب قيمة غير مقبولة. راجعها ثم احفظ.";
  return "تعذر الحفظ. حاول مرة أخرى.";
}

export const POLICY_PROBLEMS = Object.keys(POLICY_PROBLEM) as PolicyProblem[];

/** The figures of a fee plan, as a person reads that one moved. */
export const PLAN_FIGURE: Record<PlanFigure, string> = {
  fee: "أتعاب المكتب",
  clientNet: "ما يبقى للعميل",
  financing: "التمويل الجديد",
  capital: "رأس المال",
};

/** Who approved, when the account behind an approval is gone. */
const NOBODY = "حساب محذوف";

/** What moved in a plan since it was approved. */
export function movesText(moves: { figures: { name: PlanFigure; then: number; now: number }[]; fee: readonly FeePart[]; lenders?: boolean }): string {
  const lenders = moves.lenders ? "شروط الجهة التي تقوم عليها الصفقة" : "";
  if (moves.figures.length) return [...moves.figures.map((f) => `${PLAN_FIGURE[f.name]} من ${money(f.then)} إلى ${money(f.now)}`), lenders].filter(Boolean).join("، و");
  if (moves.fee.length) return lenders ? `الأتعاب نفسها، و${lenders}` : "الأتعاب نفسها";
  return lenders || "رقم في الصفقة لم يغيّر الأتعاب ولا ما يبقى للعميل";
}

/** The fee plan tile: its title and the line under it, for the latest approval, or none. */
export function planState(args: {
  latest: { by: string | null; at: Date; plan: Pick<FeePlan, "amounts" | "clientNet">; stands: boolean; moves: Parameters<typeof movesText>[0] } | null;
  /** The deal closes, so its plan may be approved. */
  closing: boolean;
  may: boolean;
}): { state: "stands" | "fell" | "none"; title: string; text: string } {
  const { latest } = args;
  if (latest?.stands) {
    return {
      state: "stands",
      title: "خطة الأتعاب معتمدة",
      text: `اعتمدها ${latest.by ?? NOBODY} في ${dayFull(latest.at)}: أتعاب ${money(latest.plan.amounts.total)}، ويبقى للعميل ${money(latest.plan.clientNet)}. تسقط إن تغيّر رقم في الصفقة أو شرط جهتها.`,
    };
  }
  const after = !args.closing
    ? "لا تُعتمد صفقة لا تُغلق: فيها عجز، أو ينقصها ما يُحكم به."
    : args.may
      ? "الاعتماد يحفظ منها نسخة لا تتغير."
      : "يعتمدها مدير النظام.";
  if (latest) return { state: "fell", title: "سقط اعتماد الأتعاب", text: `تغيّر منذ اعتمادها ${movesText(latest.moves)}. ${after}` };
  return { state: "none", title: "خطة الأتعاب غير معتمدة", text: after };
}

/** A line of the fee plan's log: the day, who, what was approved, and whether it stands. */
export function planLine(approval: { by: string | null; at: Date; plan: Pick<FeePlan, "amounts" | "clientNet">; stands: boolean }): string {
  return [dayFull(approval.at), approval.by ?? NOBODY, `أتعاب ${money(approval.plan.amounts.total)}`, `للعميل ${money(approval.plan.clientNet)}`, approval.stands ? "قائم" : "سقط"].join(" · ");
}

const PLAN_REFUSAL: Record<PlanRefusal, string> = {
  NOT_CLOSING: "الصفقة لا تُغلق، فلا تُعتمد أتعابها.",
  BLOCKED: "على جهة الصفقة شرط مؤكد يمنع العميل أو رفضٌ منها، فلا تُعتمد الخطة عليها.",
  STANDS: "هذه الخطة معتمدة كما هي.",
};

/** What to tell a person when approving a plan failed with this code. */
export function planError(code: string, params: Record<string, string> = {}): string {
  if (code === "PLAN_REFUSED" && params.reason && params.reason in PLAN_REFUSAL) return PLAN_REFUSAL[params.reason as PlanRefusal];
  if (code === "FORBIDDEN") return "اعتماد الأتعاب لمدير النظام وحده.";
  if (code === "DEAL_ENDED") return "الصفقة انتهت، وأرقامها لا تُعتمد.";
  if (code === "NOT_FOUND") return "هذه الصفقة لم تعد موجودة.";
  return "تعذر الاعتماد. حاول مرة أخرى.";
}

export const PLAN_REFUSALS = Object.keys(PLAN_REFUSAL) as PlanRefusal[];

/**
 * What the office collected of a closed deal's fee, beside the fee as counted: one line on the deal.
 * Nothing recorded yet is said as such, and zero is said as nothing collected.
 */
export function collectedText(counted: number | null, collected: number | null): string {
  if (collected == null) return "لم يُسجَّل بعد ما حُصّل من أتعابها.";
  if (collected === 0) return "لم يُحصَّل شيء من أتعابها.";
  const said = `حُصّل من أتعابها ${money(collected)} ريال`;
  const gap = collectedGap(counted, collected);
  if (gap == null) return `${said}.`;
  if (gap === 0) return `${said}، كما حُسبت.`;
  return gap < 0 ? `${said}، أقل من المحسوب بـ ${money(-gap)}.` : `${said}، أكثر من المحسوب بـ ${money(gap)}.`;
}

const COLLECTED_REFUSAL: Record<CollectedRefusal, string> = {
  NOT_CLOSED: "تُسجَّل الأتعاب المحصلة بعد إغلاق الصفقة.",
  AMOUNT: "اكتب المبلغ المحصل بالريال.",
};

/** What to tell a person when recording the collected fee failed with this code. */
export function collectedError(code: string, params: Record<string, string> = {}): string {
  if (code === "COLLECTED_REFUSED" && params.reason && params.reason in COLLECTED_REFUSAL) return COLLECTED_REFUSAL[params.reason as CollectedRefusal];
  if (code === "FORBIDDEN") return "تسجيل الأتعاب المحصلة لمن يملك تعديل الأتعاب.";
  if (code === "NOT_FOUND") return "هذه الصفقة لم تعد موجودة.";
  return "تعذر الحفظ. حاول مرة أخرى.";
}

export const COLLECTED_REFUSALS = Object.keys(COLLECTED_REFUSAL) as CollectedRefusal[];
