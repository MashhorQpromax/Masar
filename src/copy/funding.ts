/**
 * The wording of funding routes: which lender would fund a deal, what it asks of the client and why it
 * would refuse. The engine returns codes and numbers; this file turns them into Arabic.
 */
import type { CheckStatus } from "@/domain/eligibility";
import type { FundingRoute, RouteCheck, RouteNote } from "@/domain/funding";
import { checkText } from "./eligibility";
import { months } from "./format";

export const ROUTE_STATUS: Record<CheckStatus, string> = {
  pass: "تقبل العميل",
  warn: "تقبل بشروط",
  fail: "لا تقبل الآن",
};

/** One thing a lender asks or holds against the client. The lender is the subject of the sentence. */
export function routeCheckText(check: RouteCheck): string {
  switch (check.code) {
    case "SALARY_TRANSFER":
      return check.status === "pass" ? "الراتب محوّل عليها." : "تشترط تحويل الراتب إليها.";
    case "TWO_SALARY_TRANSFERS":
      return "الجهتان تشترطان تحويل الراتب، ولا يُحوَّل إلا إلى واحدة.";
    case "RECORD_OPEN":
      return "يبقى في السجل تعثر أو قرار تنفيذ لا تسدده الصفقة.";
    case "RECORD_LATE":
      return check.status === "fail" ? "في السجل تأخر سداد حديث، وهي لا تقبله." : "في السجل تأخر سداد حديث، وتقبله بشروط.";
    case "SETTLED_ACCEPTED":
      return "تقبل العميل بعد سداد تعثره وتحديث سمة.";
    case "SETTLED_UNCONFIRMED":
      return "لم نؤكد معها متى تقبل عميلاً سدّد تعثره.";
    case "SETTLED_WAIT":
      return `لا تقبل من سدّد تعثره إلا بعد مدة، والباقي منها ${months(check.params.months)}.`;
    default:
      return checkText(check);
  }
}

/** A condition with the lender that sets it, when the route has two lenders and the reader must know which. */
export function routeNoteText(note: RouteNote, route: Pick<FundingRoute, "oneLender">): string {
  const text = routeCheckText(note.check);
  const aboutAll = note.check.code === "TWO_SALARY_TRANSFERS" || note.check.code === "RECORD_UNKNOWN" || note.check.code === "RECORD_OPEN";
  return route.oneLender || aboutAll ? text : `${note.lender}: ${text}`;
}

/** Who funds the route, in a few words. */
export function routeLenders(route: Pick<FundingRoute, "mortgage" | "personal" | "oneLender">): { main: string; also: string | null } {
  const mortgage = route.mortgage?.product.lenderName ?? null;
  const personal = route.personal?.product.lenderName ?? null;
  if (mortgage && personal && !route.oneLender) return { main: mortgage, also: `والشخصي من ${personal}` };
  return { main: mortgage ?? personal ?? "", also: null };
}

const APPLY_ERROR: Record<string, string> = {
  NOT_FOUND: "هذه الصفقة لم تعد موجودة.",
  DEAL_ENDED: "الصفقة انتهت، وأرقامها لا تُعدَّل.",
  OFFER_RECORDED: "على الصفقة عرض فعلي من الجهة، ولا يُستبدل بتقدير.",
  ROUTE_GONE: "تغيّرت شروط الجهات. حدّث الصفحة واختر من جديد.",
  ROUTE_REFUSED: "هذه الجهة لا تقبل العميل بشروطها المسجلة.",
  INVALID_INPUT: "شروط هذه الجهة خارج الحدود المقبولة في الصفقة. راجعها في قائمة الجهات.",
  FORBIDDEN: "لا تملك صلاحية هذا التعديل.",
};

/** What to tell a person when a route could not be put on the deal. */
export const routeError = (code: string): string => APPLY_ERROR[code] ?? "تعذر الحفظ. حاول مرة أخرى.";

export const ROUTE_ERROR_CODES = Object.keys(APPLY_ERROR);
