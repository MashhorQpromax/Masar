/**
 * Numbers, dates and counts as Arabic text.
 *
 * Digits are Latin and always read left to right. A number placed inside an Arabic sentence is
 * wrapped in direction isolates, so a sign or a percent mark stays on the correct side.
 */

const LRI = "⁦";
const PDI = "⁩";

/** Text that must read left to right inside right-to-left text. */
export const ltr = (text: string | number): string => `${LRI}${text}${PDI}`;

const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Whole riyals with thousands separators, without direction marks. A negative amount takes a true minus sign. */
export const plainMoney = (amount: number): string => grouped.format(Math.round(amount) || 0).replace("-", "\u2212");

/** Whole riyals with thousands separators, safe inside a sentence. */
export const money = (amount: number): string => ltr(plainMoney(amount));

/** A percentage, safe inside a sentence. Whole numbers show without decimals. */
export const percent = (value: number): string => ltr(`${Number.isInteger(value) ? value : value.toFixed(1)}%`);

const TIME_ZONE = "Asia/Riyadh";
const longDay = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long", timeZone: TIME_ZONE });
const shortDay = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "long", timeZone: TIME_ZONE });

/** "الأحد 22 نوفمبر" */
export const dayLong = (date: Date): string => longDay.format(date).replace("،", "");

/** "22 نوفمبر" */
export const dayShort = (date: Date): string => shortDay.format(date);

const yearDay = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "long", year: "numeric", timeZone: TIME_ZONE });

/** A day with its year, for something that may be long past: "5 أكتوبر 2025". */
export const dayFull = (date: Date): string => yearDay.format(date);

/** A day as short as it can be said without doubt: with its year only when that is not this year. */
export const dayOf = (date: Date, now: Date): string => (yearDay.formatToParts(date).find((p) => p.type === "year")?.value === yearDay.formatToParts(now).find((p) => p.type === "year")?.value ? dayShort(date) : dayFull(date));

const fullDay = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** A day written as yyyy/mm/dd, the way SIMAH prints it, read out: "20 نوفمبر 2026". Returned as it came when it is not one. */
export function dayOfRecord(text: string): string {
  const parts = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(text);
  if (!parts) return ltr(text);
  return fullDay.format(new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), 12)));
}

export interface CountForms {
  /** One: "يوم واحد" */
  one: string;
  /** Two: "يومان" */
  two: string;
  /** Three to ten, plural: "أيام" */
  few: string;
  /** Eleven and more, singular: "يوماً" */
  many: string;
}

/** A counted noun with the agreement Arabic requires. */
export function counted(n: number, forms: CountForms): string {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  return n >= 3 && n <= 10 ? `${n} ${forms.few}` : `${n} ${forms.many}`;
}

const DAYS: CountForms = { one: "يوم واحد", two: "يومان", few: "أيام", many: "يوماً" };
const DAYS_AFTER_PREPOSITION: CountForms = { one: "يوم", two: "يومين", few: "أيام", many: "يوماً" };

/** "3 أيام" */
export const days = (n: number): string => counted(n, DAYS);

/** A span of months as it reads after a preposition: "بعد شهرين", "منذ 14 شهراً". */
export const months = (n: number): string => counted(n, { one: "شهر", two: "شهرين", few: "أشهر", many: "شهراً" });

/** When something happens: "اليوم", "غداً", "بعد يومين", "بعد 9 أيام". */
export function inDays(n: number): string {
  if (n <= 0) return "اليوم";
  if (n === 1) return "غداً";
  return `بعد ${counted(n, DAYS_AFTER_PREPOSITION)}`;
}

/** A deadline: "اليوم", "خلال يوم", "خلال يومين", or "متأخر 3 أيام" when it has passed. */
export function dueIn(n: number): string {
  if (n < 0) return `متأخر ${counted(-n, { one: "يوماً", two: "يومين", few: "أيام", many: "يوماً" })}`;
  if (n === 0) return "اليوم";
  return `خلال ${counted(n, DAYS_AFTER_PREPOSITION)}`;
}

/** True when a deadline has passed. */
export const isLate = (n: number): boolean => n < 0;

const FEMININE_WORDS = ["", "", "", "ثلاث", "أربع", "خمس", "ست", "سبع", "ثماني", "تسع", "عشر"];

/** A count of feminine nouns in words for small numbers: "أربع صفقات", "صفقتان", "12 صفقة". */
export function countedInWords(n: number, forms: CountForms): string {
  if (n >= 3 && n <= 10) return `${FEMININE_WORDS[n]} ${forms.few}`;
  return counted(n, forms);
}

/** First letter of a name, for an avatar. */
export const initial = (name: string): string => name.trim().charAt(0);

/** Digits and separators typed on an Arabic keyboard, as their Latin forms. */
export const latinDigits = (text: string): string =>
  text
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\u066b/g, ".")
    .replace(/\u066c/g, ",");

/**
 * What a person typed into a number field, reduced to a plain number text: digits, and one decimal
 * point when decimals are allowed. Returns "" when nothing usable was typed.
 */
export function numberText(typed: string, decimals = 0): string {
  const text = latinDigits(typed).replace(/[^0-9.]/g, "");
  const [whole = "", ...rest] = text.split(".");
  const integer = whole.replace(/^0+(?=\d)/, "").slice(0, 12);
  if (decimals <= 0 || !text.includes(".")) return integer;
  return `${integer || "0"}.${rest.join("").slice(0, decimals)}`;
}

/** A plain number text with thousands separators in its whole part: "1234567.5" becomes "1,234,567.5". */
export function groupDigits(text: string): string {
  const [whole = "", fraction] = text.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}
