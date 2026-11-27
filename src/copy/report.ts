/** The words of the office's month. */
import type { LenderMonth, Month, MonthReport } from "@/domain/report";
import { counted, dayOfIso, ltr, money } from "./format";

const monthName = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { month: "long", year: "numeric", timeZone: "UTC" });

/** "نوفمبر 2026" */
export function monthTitle(month: Month): string {
  const [year, number] = month.split("-").map(Number) as [number, number];
  return monthName.format(new Date(Date.UTC(year, number - 1, 15)));
}

const APPROVALS = { one: "موافقة واحدة", two: "موافقتان", few: "موافقات", many: "موافقة" };
const REFUSALS = { one: "رفض واحد", two: "رفضان", few: "حالات رفض", many: "حالة رفض" };
const ANSWERS = { one: "رد واحد", two: "ردان", few: "ردود", many: "رداً" };
const SENT = { one: "طلب واحد", two: "طلبان", few: "طلبات", many: "طلباً" };
const ANSWERED = { one: "طلب واحد", two: "طلبين", few: "طلبات", many: "طلباً" };
const AFTER_DAYS = { one: "يوم", two: "يومين", few: "أيام", many: "يوماً" };

/** What one lender answered in the month: "3 ردود: موافقتان ورفض واحد. كلها مكتوبة." */
export function lenderLine(line: Pick<LenderMonth, "answers" | "approved" | "refused" | "written">): string {
  const said = [line.approved > 0 && counted(line.approved, APPROVALS), line.refused > 0 && counted(line.refused, REFUSALS)].filter(Boolean).join(" و");
  const written = line.written === line.answers ? (line.answers === 1 ? "مكتوب" : "كلها مكتوبة") : line.written === 0 ? "بلا ورقة مكتوبة" : `${ltr(line.written)} منها مكتوبة`;
  return `${counted(line.answers, ANSWERS)}: ${said}. ${written}.`;
}

/**
 * When a deal closed or fell through, and how long after it was opened. A closed deal also says what
 * was collected of its fee, or that nothing was recorded: the figure at the end of its line is the fee
 * as counted.
 */
export function endedLine(deal: { on: string; days: number; collected?: number | null }, closed: boolean): string {
  const when = `${closed ? "أُغلقت" : "أُلغيت"} ${dayOfIso(deal.on)}`;
  const after = deal.days === 0 ? `${when}، يوم فتحها` : `${when}، بعد ${counted(deal.days, AFTER_DAYS)} من فتحها`;
  if (!closed) return after;
  return `${after}. ${deal.collected == null ? "لم يُسجَّل ما حُصّل من أتعابها" : `المحصّل من أتعابها ${money(deal.collected)}`}`;
}

const DEALS_OF = { one: "صفقة واحدة", two: "صفقتين", few: "صفقات", many: "صفقة" };

/**
 * The fees of the month's closed deals: as counted, and as collected where a person recorded it. The
 * two are never added up, and deals with nothing recorded are said, not counted as nothing.
 */
export function feesText(report: Pick<MonthReport, "closed" | "closedFees" | "collectedFees" | "collectedOn">): string {
  const countedFees = `أتعابها المحسوبة ${money(report.closedFees)} ريال`;
  const left = report.closed.length - report.collectedOn;
  if (report.collectedOn === 0) return `${countedFees}. لم يُسجَّل ما حُصّل منها بعد.`;
  if (left === 0) return `${countedFees}، والمحصّل منها ${money(report.collectedFees)}.`;
  return `${countedFees}. المحصّل ${money(report.collectedFees)} من ${counted(report.collectedOn, DEALS_OF)}، والباقي لم يُسجَّل.`;
}

/** The month's requests to lenders. Whether one waits now is said only of the month that holds today. */
export function requestsText(requests: MonthReport["requests"], thisMonth: boolean): string {
  const sent = requests.sent === 0 ? "لم يُرسل طلب إلى جهة" : `أُرسل ${counted(requests.sent, SENT)} إلى الجهات`;
  const answered = requests.answered === 0 ? "ولم يُسجَّل رد على طلب" : `وسُجّل الرد على ${counted(requests.answered, ANSWERED)}`;
  const waiting = thisMonth && requests.waiting > 0 ? ` ينتظر الرد الآن: ${ltr(requests.waiting)}.` : "";
  return `${sent}، ${answered}.${waiting}`;
}

/** Said once under the month: where its figures come from, and what they are not. */
export const MONTH_NOTE = "كل رقم هنا من الصفقات وسجلاتها كما هي في النظام. أتعاب الصفقة المغلقة محسوبة من أرقامها، وما حُصّل منها فعلاً يُسجَّل في ملف الصفقة بعد إغلاقها.";
