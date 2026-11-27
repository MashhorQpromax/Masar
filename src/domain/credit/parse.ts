/**
 * Reads a SIMAH consumer credit report from the text of its PDF pages.
 *
 * PDF text extraction returns Arabic with its letters in reverse order and its numbers glued
 * together. So the reader looks for the report's fixed phrases spelled backwards, and separates
 * the numbers by the fixed shapes SIMAH prints them in: amounts with two decimals, dates as
 * yyyy/mm/dd.
 *
 * The result is a draft: the analyst reviews it before anything is decided on it. The names of
 * lenders and products are the report's own words and are stored as data, in Arabic.
 *
 * Pure: the same pages and the same day always give the same reading.
 */
import { round0, sum } from "@/domain/shared/num";
import type { CreditReport, CreditorType, Facility, FacilityStatus, Inquiry, Judgment, ReportSummary } from "./types";

/** A phrase as the extraction returns it: letters in reverse order. */
const reversed = (text: string): string => [...text].reverse().join("");

const AMOUNT = /\d+\.\d{2}/g;
const DATE = /\d{4}\/\d{2}\/\d{2}/g;
/** A date followed at once by two amounts, then the rest of the line: a row of the defaults table or of the enforcement table. */
const DATED_ROW = /(\d{4}\/\d{2}\/\d{2})(\d+\.\d{2})(\d+\.\d{2})(.*)$/;

const PRODUCT_HEAD = reversed("حالة المنتج");
const PRODUCT_NAME = reversed("المنتج:");
const DEFAULTED = reversed("منتج متعثر");
const CLOSED = reversed("منتج مغلق");
const MONTHLY = reversed("شهري");
const ENFORCEMENT = reversed("تنفيذ");
const INQUIRER = reversed("المستعلم");
/** How far below a product's heading its figures can be. */
const PRODUCT_BLOCK_LINES = 140;

export const UNKNOWN_LENDER = "غير محدد";
export const UNMATCHED_DEFAULT_LENDER = "غير محدد (من جدول المتعثرات)";
export const UNMATCHED_DEFAULT_PRODUCT = "منتج متعثر";

/** Something in the reading that a person should check. */
export type ParseWarning =
  | { code: "UNMATCHED_DEFAULT"; params: { amount: number } }
  | { code: "ACTIVE_COUNT_MISMATCH"; params: { summary: number; read: number } }
  | { code: "NO_FACILITIES"; params: Record<string, never> }
  | { code: "SUSPENSION_ASSUMED"; params: { orders: number } }
  | { code: "DEFAULTS_TOTAL_MISMATCH"; params: { read: number; summary: number } };

export interface ParsedReport {
  report: CreditReport & { summary: ReportSummary; inquiries: Inquiry[] };
  warnings: ParseWarning[];
  /** How far the reading can be trusted before a person has checked it. */
  confidence: "high" | "medium" | "low";
}

/** Who a debt is owed to, from the lender's name and the product. */
export function creditorTypeOf(lender: string, product = ""): CreditorType {
  if (/الهاتف|اتصالات|موبايلي|زين|سلام|ليبارا|فيرجن|الإنترنت/.test(`${lender} ${product}`)) return "telecom";
  if (/بنك|مصرف|الراجحي|الإنماء|البلاد|الجزيرة|ساب/.test(lender)) return "bank";
  if (/تمويل|المالية|للتمويل|إمكان|امكان|النايفات|تمارا|تابي|كوارا|اليسر|الأولى|تأجير|تساهيل|سهل/.test(lender)) return "finance_company";
  return "other";
}

/** Whole months from one yyyy/mm/dd date to a later one. Never negative. */
export function monthsBetween(from: string, to: string): number {
  const [y1 = 0, m1 = 0] = from.split("/").map(Number);
  const [y2 = 0, m2 = 0] = to.split("/").map(Number);
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1));
}

/**
 * Lenders by the fragments of their names that survive extraction. The extraction scatters the
 * letters of "ال" and "ت", so each name is listed in the spellings it comes out in.
 */
const KNOWN_LENDERS: [RegExp, string][] = [
  [/أهلي|األهلي|يلهلأا|الهلي/, "البنك الأهلي السعودي"],
  [/راجحي|يحجارلا/, "مصرف الراجحي"],
  [/الرياض|ضايرلا/, "بنك الرياض"],
  [/الإنماء|اإلنماء|ءامنإلا|انماء/, "مصرف الإنماء"],
  [/البلاد|دالبلا|البالد/, "بنك البلاد"],
  [/الجزيرة|ةريزجلا/, "بنك الجزيرة"],
  [/للاستثمار|لالستثمار|رامثتسالل/, "البنك السعودي للاستثمار"],
  [/الفرنسي|يسنرفلا/, "البنك السعودي الفرنسي"],
  [/العربي الوطني|العربي/, "البنك العربي الوطني"],
  [/ساب|الأول/, "البنك السعودي الأول (ساب)"],
  [/المتحدة|ةدحتملا/, "الشركة المتحدة للخدمات المالية"],
  [/إمكان|امكان|ناكمإ/, "إمكان للتمويل"],
  [/النايفات|تافيانلا/, "النايفات للتمويل"],
  [/تمارا|راامت|اراامت/, "تمارا"],
  [/تابي|يبات/, "تابي"],
  [/كوارا|اراوك/, "كوارا للتمويل"],
  [/جميل|ليمج/, "عبداللطيف جميل للتمويل"],
  [/اليسر|رسيلا/, "اليسر للتمويل"],
  [/موبايلي|يليابوم/, "موبايلي"],
  [/زين|نيز/, "زين"],
  [/تصا|اصتلا|اتصاالت|التصا/, "الاتصالات السعودية (STC)"],
];

function lenderIn(text: string): string {
  for (const [pattern, name] of KNOWN_LENDERS) if (pattern.test(text)) return name;
  return text.replace(/\s+/g, " ").trim();
}

function productIn(text: string): string {
  if (/جو[اﻻ]?ل|جولا|الجوال/.test(text)) return "الهاتف الجوال";
  if (/ثابت/.test(text)) return "الهاتف الثابت";
  if (/منزلي|عقاري/.test(text)) return "تمويل منزلي";
  if (/بطاقة/.test(text)) return "بطاقة ائتمان";
  if (/تأجير|تاجير/.test(text)) return "عقد تأجير";
  if (/سيارة/.test(text)) return "تمويل سيارة";
  if (/شخصي/.test(text)) return "قرض شخصي";
  if (/منتجات|ادفع/.test(text)) return "تمويل منتجات/اشتر الآن";
  return "منتج";
}

/** The date printed beside the time the report was issued. */
function reportDateIn(all: string): string | null {
  return all.match(/\d{2}:\d{2}:\d{2}\s*-\s*(\d{4}\/\d{2}\/\d{2})/)?.[1] ?? null;
}

function summaryIn(lines: readonly string[], all: string): ReportSummary {
  const summary: ReportSummary = {};
  for (const line of lines) {
    const leading = line.match(/^(\d+(?:\.\d{2})?)\s*/);
    if (!leading) continue;
    const value = Number(leading[1]);
    // The extraction scatters some letters, so fixed fragments of each phrase are matched, spelled backwards.
    const has = (fragment: string) => line.includes(fragment);
    if (has("ةلوفكملا")) continue;
    if (has("ةطشنلا") && has("ادع") && Number.isInteger(value)) summary.activeCount = value;
    else if (has("رثعتملا") && has("يقبتملا")) summary.defaultedRemaining = value;
    else if (has("رثعتملا") && has("ادع") && Number.isInteger(value)) summary.defaultedCount = value;
    else if (has("ادحلا") && has("يلامجإ")) summary.totalLimits = value;
    else if (has("ةمئاقلا") && has("يلامجإ")) summary.totalOutstanding = value;
  }
  const first = all.match(/(\d{4}\/\d{2}\/\d{2})\s*:\s*[^\n]*?جتنم/);
  if (first) summary.firstProductDate = first[1];
  return summary;
}

/** One product per heading, with the figures found on the lines below it. */
function facilitiesIn(lines: readonly string[], reference: string): Facility[] {
  const facilities: Facility[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i]!;
    if (!head.includes(PRODUCT_HEAD) || !head.includes(PRODUCT_NAME)) continue;
    const state: FacilityStatus = head.includes(DEFAULTED) ? "default" : head.includes(CLOSED) ? "closed" : "current";
    const name = reversed(head);
    const product = productIn(name);
    const lender = lenderIn(name);

    let issued: string | null = null;
    let limit: number | null = null;
    let ends: string | null = null;
    let balance: number | null = null;
    let overdue: number | null = null;
    let lastUpdate: string | null = null;
    let lastPayDate: string | null = null;
    let installment: number | null = null;
    for (let k = i + 1; k < Math.min(lines.length, i + PRODUCT_BLOCK_LINES); k++) {
      const line = lines[k]!;
      if (line.includes(PRODUCT_HEAD)) break;
      // Issue date, limit, then the number of installments and the installment glued together, "monthly", end date.
      const opening = line.match(/^(\d{4}\/\d{2}\/\d{2})(\d+\.\d{2})\d*?(?:\.\d{2})?\s*/);
      if (!issued && opening && line.includes(MONTHLY)) {
        issued = opening[1]!;
        limit = Number(opening[2]);
        ends = line.match(new RegExp(`${MONTHLY}(\\d{4}\\/\\d{2}\\/\\d{2})`))?.[1] ?? null;
        continue;
      }
      // Balance, overdue amount, date of the last update, last payment and its date, next due date, salary assignment.
      const standing = line.match(/^(\d+\.\d{2})(\d+\.\d{2})(\d{4}\/\d{2}\/\d{2})/);
      if (balance == null && standing && /(معن|لا)$/.test(line)) {
        balance = Number(standing[1]);
        overdue = Number(standing[2]);
        lastUpdate = standing[3]!;
        lastPayDate = (line.match(DATE) ?? [])[1] ?? null;
        continue;
      }
      // Last payment, down payment, financed amount, highest installment, then the contract's nature and average installment.
      if (installment == null && /^\d+\.\d{2}\d+\.\d{2}\d+\.\d{2}\d+\.\d{2}/.test(line)) {
        const amounts = line.match(AMOUNT) ?? [];
        installment = Number(amounts[3] ?? 0) || Number(amounts[amounts.length - 1] ?? 0) || 0;
      }
    }

    const facility: Facility = {
      lender: lender || UNKNOWN_LENDER,
      creditorType: creditorTypeOf(lender, product),
      product,
      limit,
      balance: state === "closed" ? 0 : balance,
      installment: state === "current" ? installment : 0,
      status: state === "current" && (overdue ?? 0) > 0 ? "late" : state,
      overdue,
      openedAt: issued,
      endAt: ends,
      lastUpdate,
      lastPayDate,
    };
    if (state === "default") {
      facility.defaultAmount = balance;
      facility.defaultMonthsAgo = lastUpdate ? monthsBetween(lastUpdate, reference) : null;
    }
    facilities.push(facility);
  }
  return facilities;
}

/**
 * The table of defaulted products gives what the product blocks do not: when the default was
 * listed, what is left of it, and whether it has been paid. Each row is matched to the product
 * with the same amount. A row that matches none is kept as a default of its own, with a warning.
 */
function readDefaultsTable(lines: readonly string[], facilities: Facility[], reference: string, warnings: ParseWarning[]): void {
  for (const line of lines) {
    const row = line.match(DATED_ROW);
    if (!row) continue;
    const tail = reversed(row[4]!);
    if (!/مدفوع|غير مدفوع/.test(tail)) continue;
    const listed = row[1]!;
    const amount = Number(row[2]);
    const now = Number(row[3]);
    const paid = /مدفوع بالكامل/.test(tail);
    const state = tail.replace(/[\d/]/g, "").trim();
    const paidOn = line.match(/(\d{4}\/\d{2}\/\d{2})\s*$/)?.[1] ?? null;
    const facility = facilities.find(
      (f) =>
        (f.status === "default" || f.status === "closed") &&
        f.balance != null &&
        (Math.abs((f.defaultAmount ?? f.balance) - amount) < 1 || Math.abs((f.balance ?? 0) - now) < 1),
    );
    if (facility) {
      facility.defaultAmount = amount;
      facility.defaultListedAt = listed;
      facility.defaultMonthsAgo = monthsBetween(listed, reference);
      facility.defaultNow = paid ? 0 : now;
      facility.defaultState = state;
      if (paid) {
        facility.status = "settled";
        facility.settledMonthsAgo = paidOn ? monthsBetween(paidOn, reference) : null;
      }
    } else {
      facilities.push({
        lender: UNMATCHED_DEFAULT_LENDER,
        creditorType: "other",
        product: UNMATCHED_DEFAULT_PRODUCT,
        status: paid ? "settled" : "default",
        defaultAmount: amount,
        defaultNow: paid ? 0 : now,
        defaultListedAt: listed,
        defaultMonthsAgo: monthsBetween(listed, reference),
        defaultState: state,
      });
      warnings.push({ code: "UNMATCHED_DEFAULT", params: { amount } });
    }
  }
}

/** Decisions of the enforcement courts. An order counts as open unless its state says it was carried out or closed. */
function enforcementOrdersIn(lines: readonly string[], reference: string): Judgment[] {
  const orders: Judgment[] = [];
  for (const line of lines) {
    if (!line.includes(ENFORCEMENT)) continue;
    const row = line.match(DATED_ROW);
    if (!row) continue;
    const state = reversed(row[4]!).trim();
    const active = /عدم تنفيذ|قائم|جاري/.test(state) || !/منفذ|تم التنفيذ|مسدد|منتهي|مغلق/.test(state);
    const decisionNo = line.match(/^\d{4}\/\d{2}\/\d{2}(\d{8,})/)?.[1] ?? null;
    orders.push({
      kind: "enforcement",
      amount: Number(row[2]),
      remaining: Number(row[3]),
      active,
      monthsAgo: monthsBetween(row[1]!, reference),
      date: row[1]!,
      state,
      decisionNo,
      creditor: null,
    });
  }
  return orders;
}

/** Who asked for the record and when. The section runs from its heading to the enforcement decisions. */
function inquiriesIn(lines: readonly string[]): Inquiry[] {
  const inquiries: Inquiry[] = [];
  let inside = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!inside && line.includes(INQUIRER)) {
      inside = true;
      continue;
    }
    if (inside && (line.includes("اررقلا") || line.includes("رارقلا") || line.includes(ENFORCEMENT))) break;
    if (!inside) continue;
    const row = line.match(/^(\d{4}\/\d{2}\/\d{2})(.*)$/);
    if (!row) continue;
    let rest = row[2]!;
    // The amount ends the line, or sits on one of the next lines.
    let amount: number | null = null;
    let carried = "";
    const closing = rest.match(/(\d+\.\d{2})$/);
    if (closing) amount = Number(closing[1]);
    else {
      for (let k = i + 1; k < Math.min(lines.length, i + 4); k++) {
        const next = lines[k]!;
        const found = next.match(/(\d+\.\d{2})$/);
        if (found && !/^\d{4}\//.test(next)) {
          amount = Number(found[1]);
          carried = next;
          break;
        }
      }
    }
    rest = `${rest} ${carried}`.replace(/\d+\.\d{2}$/, "").replace(/[A-Z0-9_-]{6,}/g, " ");
    const text = reversed(rest).replace(/\s+/g, " ").trim();
    inquiries.push({ date: row[1]!, lender: lenderIn(text), product: productIn(text), amount });
  }
  return inquiries;
}

/**
 * Reads the pages of a SIMAH report.
 * @param pages the text of each page, as extracted from the PDF
 * @param today the day of the reading, as yyyy/mm/dd
 */
export function parseSimahPages(pages: readonly string[], today: string): ParsedReport {
  const all = pages.map((page) => page.normalize("NFKC").replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))).join("\n");
  const lines = all
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const warnings: ParseWarning[] = [];

  const reportDate = reportDateIn(all);
  // Ages are counted back from the day the report was issued, or from today when the report does not say.
  const reference = reportDate ?? today;
  const summary = summaryIn(lines, all);
  const facilities = facilitiesIn(lines, reference);
  readDefaultsTable(lines, facilities, reference, warnings);
  const judgments = enforcementOrdersIn(lines, reference);
  const inquiries = inquiriesIn(lines);

  const activeRead = facilities.filter((f) => f.status === "current" || f.status === "late").length;
  if (summary.activeCount != null && summary.activeCount !== activeRead) {
    warnings.push({ code: "ACTIVE_COUNT_MISMATCH", params: { summary: summary.activeCount, read: activeRead } });
  }
  if (!facilities.length) warnings.push({ code: "NO_FACILITIES", params: {} });
  const confidence: ParsedReport["confidence"] = !facilities.length ? "low" : warnings.length ? "medium" : "high";

  // An order left unpaid five days after notice brings a service suspension under article 46, so one is assumed until Absher or Najiz says otherwise.
  const openOrders = judgments.filter((j) => j.active);
  if (openOrders.length) warnings.push({ code: "SUSPENSION_ASSUMED", params: { orders: openOrders.length } });

  const unpaid = facilities.filter((f) => f.status === "default");
  if (unpaid.length && summary.defaultedRemaining != null) {
    // The report's own total adds the unpaid defaults and the open enforcement orders.
    const read = sum(unpaid, (f) => f.defaultNow ?? f.balance ?? 0) + sum(openOrders, (j) => j.remaining ?? j.amount ?? 0);
    if (Math.abs(read - summary.defaultedRemaining) > 5) {
      warnings.push({ code: "DEFAULTS_TOTAL_MISMATCH", params: { read: round0(read), summary: round0(summary.defaultedRemaining) } });
    }
  }

  return {
    report: {
      reportMonthsAgo: reportDate ? monthsBetween(reportDate, today) : null,
      reportDate,
      score: null,
      facilities,
      judgments,
      serviceSuspension: openOrders.length > 0,
      suspensionAssumed: openOrders.length > 0,
      inquiries6m: inquiries.filter((q) => monthsBetween(q.date, reference) < 6).length,
      inquiries12m: inquiries.filter((q) => monthsBetween(q.date, reference) < 12).length,
      inquiries,
      summary,
      notes: null,
    },
    warnings,
    confidence,
  };
}
