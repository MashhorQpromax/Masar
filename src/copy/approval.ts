/** Wording of the approval of a client's analysis: whether it stands, what fell, and why one was refused. */
import { REASON_MIN, type ApprovalPart, type ApprovalRefusal, type ApprovalSummary, type Completeness } from "@/domain/analysis";
import { kindTitle } from "./analysis";
import { counted, dayFull, ltr, money, type CountForms } from "./format";
import { ELIGIBILITY } from "./funding";

/** What an approval rests on, as a person reads that it changed. */
export const APPROVAL_PART: Record<ApprovalPart, string> = {
  file: "ملف العميل",
  record: "تقرير سمة",
  lenders: "شروط الجهة المقترحة",
  result: "نتيجة التحليل",
};

const MISSING: CountForms = { one: "ناقص واحد", two: "ناقصان", few: "نواقص", many: "ناقصاً" };
const UNCONFIRMED: CountForms = { one: "أمر غير مؤكد", two: "أمران غير مؤكدين", few: "أمور غير مؤكدة", many: "أمراً غير مؤكد" };
const CONFLICTS: CountForms = { one: "تعارض واحد", two: "تعارضان", few: "تعارضات", many: "تعارضاً" };

const listed = (parts: string[]): string => parts.join(" و");

/**
 * What is still open in a recommendation, as it reads after "فيها": "3 نواقص وأمر غير مؤكد". With nothing
 * listed and a result that needs verification all the same, "ما يحتاج تحققاً". Empty for a complete one.
 */
export function openText(open: Completeness): string {
  const counts = [
    open.missing > 0 && counted(open.missing, MISSING),
    open.unconfirmed > 0 && counted(open.unconfirmed, UNCONFIRMED),
    open.conflict > 0 && counted(open.conflict, CONFLICTS),
    open.terms && "شروط لم تؤكدها الجهة المقترحة",
  ].filter((part): part is string => !!part);
  return counts.length ? listed(counts) : open.verify ? "ما يحتاج تحققاً" : "";
}

/** What changed since an approval, in the order the parts are told. */
export const changedText = (changed: readonly ApprovalPart[]): string => listed(changed.map((part) => APPROVAL_PART[part]));

/** Who approved, when the account behind an approval is gone. */
const NOBODY = "حساب محذوف";

/** The approval tile: its title and the line under it, for the approval that is the latest, or none. */
export function approvalState(args: {
  latest: { by: string | null; at: Date; complete: boolean; reason: string | null; changed: readonly ApprovalPart[]; open: Completeness } | null;
  now: Completeness;
  pending: boolean;
  /** The person reading may approve. */
  may: boolean;
}): { title: string; text: string; state: "stands" | "fell" | "none" } {
  const { latest, now } = args;
  if (latest && latest.changed.length === 0) {
    const who = `اعتمدها ${latest.by ?? NOBODY} في ${dayFull(latest.at)}.`;
    return {
      state: "stands",
      title: "التوصية معتمدة",
      text: latest.complete ? `${who} كل ما بُني عليه مؤكد، ويسقط الاعتماد إن تغيّر شيء منه.` : `${who} اعتُمدت وفيها ${openText(latest.open)}. السبب: ${latest.reason ?? ""}`,
    };
  }
  const after = args.pending
    ? "لا تُعتمد قبل أن يُقرأ التحليل: أكمل الملف أو سجّل موافقة العميل."
    : now.conflict > 0
      ? `فيها ${openText(now)}. لا تُعتمد قبل أن يُحسم التعارض من صفحة المستندات.`
      : now.complete
      ? args.may
        ? "كل ما بُني عليه مؤكد. الاعتماد يثبت ما قرأه التحليل ووجده الآن."
        : "كل ما بُني عليه مؤكد. يعتمدها مدير النظام."
      : args.may
        ? `فيها ${openText(now)}. لا تُعتمد إلا بسبب مكتوب.`
        : `فيها ${openText(now)}. يعتمدها مدير النظام بسبب مكتوب.`;
  if (latest) return { state: "fell", title: "سقط الاعتماد", text: `تغيّر منذ اعتمادها ${changedText(latest.changed)}. ${after}` };
  return { state: "none", title: "التوصية غير معتمدة", text: after };
}

/** Where an approval sent the client, one lender to a line, with the answer it had then. */
export function sentLines(apply: ApprovalSummary["apply"]): string[] {
  if (!apply.length) return ["لم تقترح جهة."];
  return apply.map((to) => `${to.afterClearing ? "بعد السداد: " : ""}${to.lender}، ${kindTitle(to)} حتى ${money(to.amount)}: ${ELIGIBILITY[to.eligibility]}`);
}

/** A line of the approval log. */
export function approvalLine(approval: { by: string | null; at: Date; complete: boolean; changed: readonly ApprovalPart[] }): string {
  return [
    dayFull(approval.at),
    approval.by ?? NOBODY,
    approval.complete ? "مكتملة" : "مع ما لم يكتمل",
    approval.changed.length === 0 ? "قائم" : `سقط: تغيّر ${changedText(approval.changed)}`,
  ].join(" · ");
}

const REFUSAL: Record<ApprovalRefusal, string> = {
  PENDING: "التحليل لا يُقرأ بعد. أكمل الملف أو سجّل موافقة العميل أولاً.",
  STANDS: "هذه التوصية معتمدة كما هي.",
  CONFLICT: "الملف يخالف مستنداً مراجعاً. احسم التعارض من صفحة المستندات قبل اعتمادها.",
  REASON_NEEDED: `اكتب سبب اعتمادها رغم ما لم يكتمل، ${ltr(REASON_MIN)} حرفاً على الأقل.`,
};

/** What to tell a person when approving failed with this code. */
export function approvalError(code: string, params: Record<string, string> = {}): string {
  if (code === "APPROVAL_REFUSED" && params.reason && params.reason in REFUSAL) return REFUSAL[params.reason as ApprovalRefusal];
  if (code === "FORBIDDEN") return "الاعتماد لمدير النظام وحده.";
  if (code === "NOT_FOUND") return "هذا الملف لم يعد موجوداً.";
  return "تعذر الاعتماد. حاول مرة أخرى.";
}

export const APPROVAL_REFUSALS = Object.keys(REFUSAL) as ApprovalRefusal[];
