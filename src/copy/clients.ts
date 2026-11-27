/** Wording of the people the office has files for: where a file stands, how a client is reached, and what is said when saving fails. */
import type { ClientNationality, FileState } from "@/domain/clients";
import { STATION } from "./deal";
import { counted, ltr } from "./format";

export const NATIONALITY: Record<ClientNationality, string> = { saudi: "سعودي", non_saudi: "مقيم" };

/** What the identity number of a client is called. */
export const ID_LABEL: Record<ClientNationality, string> = { saudi: "رقم الهوية الوطنية", non_saudi: "رقم الإقامة" };

/** Where a file stands, in a word or two. An open file is at a station of its road. */
export function fileStateText(state: FileState): string {
  switch (state.kind) {
    case "open":
      return STATION[state.station];
    case "done":
      return "اكتملت";
    case "rejected":
      return "مرفوض";
    case "none":
      return "بلا صفقة";
  }
}

/**
 * A mobile number as a person reads it: 055 123 4567 for a Saudi mobile, and the full number with its
 * plus sign for any other. A number that was stored some other way is shown as it is.
 */
export function phoneText(phone: string | null | undefined): string {
  if (!phone) return "";
  const local = /^9665(\d{8})$/.exec(phone) ?? /^05(\d{8})$/.exec(phone);
  if (local) return ltr(`05${local[1]!.slice(0, 1)} ${local[1]!.slice(1, 4)} ${local[1]!.slice(4)}`);
  return ltr(/^\d{11,15}$/.test(phone) ? `+${phone}` : phone);
}

/** A stored number as a person would type it into a field: 0551234567 for a Saudi mobile. */
export function phoneTyped(phone: string | null | undefined): string {
  if (!phone) return "";
  return /^9665\d{8}$/.test(phone) ? `0${phone.slice(3)}` : phone;
}

const FILES = { one: "ملف واحد", two: "ملفان", few: "ملفات", many: "ملفاً" };

/** "6 ملفات" */
export const filesCount = (n: number): string => counted(n, FILES);

const RESULTS = { one: "نتيجة واحدة", two: "نتيجتان", few: "نتائج", many: "نتيجة" };

/** What a search found: "نتيجتان عن «سالم»." */
export const foundText = (n: number, q: string): string => (n === 0 ? `لا أحد باسم «${q}» أو برقمه.` : `${counted(n, RESULTS)} عن «${q}».`);

/** A line on a file that the system wrote: why it was rejected or put back under study. */
export const NOTE_KIND: Record<string, string> = { note: "ملاحظة", status: "قرار الملف" };

const CONTACT_ERROR: Record<string, (params: Record<string, string>) => string> = {
  BAD_PHONE: () => "رقم الجوال غير صحيح. اكتبه بعشرة أرقام تبدأ بـ 05.",
  PHONE_TAKEN: (p) => `هذا الجوال مسجل في الملف ${ltr(p.fileNo ?? "")}. الرقم الواحد لملف واحد.`,
  ID_FORMAT: () => "رقم الهوية عشرة أرقام، أولها 1 للمواطن أو 2 للمقيم.",
  ID_KIND: () => "الهوية الوطنية تبدأ بـ 1 والإقامة تبدأ بـ 2. صحّح الرقم أو الجنسية.",
  ID_CHECK: () => "في رقم الهوية خانة خاطئة. راجعه رقماً رقماً.",
  ID_TAKEN: (p) => `رقم الهوية مسجل في الملف ${ltr(p.fileNo ?? "")}. قد يكون الملف مكرراً.`,
  BAD_EMAIL: () => "البريد الإلكتروني غير صحيح.",
  NOTE_EMPTY: () => "اكتب الملاحظة أولاً.",
  REASON_EMPTY: () => "اكتب السبب أولاً، فهو ما يبقى في الملف.",
  NUMBER_KNOWN: () => "هذا الرقم صار لعميل. حدّث الصفحة.",
  DEAL_ALREADY_OPEN: () => "لهذا العميل صفقة مفتوحة.",
  NOT_FOUND: () => "هذا الملف لم يعد موجوداً. حدّث الصفحة.",
  FORBIDDEN: () => "لا تملك صلاحية هذا التعديل.",
  INVALID_INPUT: () => "تحقق مما كتبته ثم حاول مرة أخرى.",
};

/** What to tell a person when a change to a client's file was refused. */
export const contactError = (code: string, params: Record<string, string> = {}): string => CONTACT_ERROR[code]?.(params) ?? "تعذر الحفظ. حاول مرة أخرى.";

export const CONTACT_ERROR_CODES = Object.keys(CONTACT_ERROR);
