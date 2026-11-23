/**
 * The wording of a client's papers: what each one is called, where it stands, and what to tell the
 * client who still owes some. The engine returns codes; this file turns them into Arabic.
 */
import { INBOX_PAPER, type FileKind, type PaperCategory, type PaperStatus } from "@/domain/documents";
import type { Nationality } from "@/domain/eligibility";
import type { Sector } from "@/domain/shared/sector";
import type { FactReading, RelyProblem } from "@/domain/documents";
import type { PaperFact } from "@/domain/eligibility";
import { documentLabel, PAPER_FACT } from "./eligibility";
import { counted, ltr, money, type CountForms } from "./format";

export const PAPER_STATUS: Record<PaperStatus, string> = {
  missing: "ناقص",
  received: "وصل",
  verified: "سليم",
  rejected: "يُعاد",
};

export const PAPER_CATEGORY: Record<PaperCategory, string> = {
  identity: "الهوية",
  obligations: "الالتزامات",
  income: "الدخل",
  collateral: "العقار",
  business: "النشاط",
  deal: "أوراق الصفقة",
  extra: "مستندات أضفناها",
};

/** The mark on a paper the office brings itself, so nobody asks the client for it. */
export const BY_OFFICE = "علينا";

/** The papers a deal produces along its road. A lender never asks for them: the company keeps them. */
const DEAL_PAPER: Record<string, string> = {
  agreement: "الاتفاقية الموقعة مع العميل",
  clearance: "مخالصات التنفيذ والتعثرات",
  payoff_letter: "خطاب مخالصة العقاري وفك الرهن",
  transfer_deed: "صك العقار بعد الإفراغ لطرفنا",
};

/** The tray of pictures and documents a client sent by WhatsApp, before a person puts each under its paper. */
export const TRAY = "وصل في واتساب";

/** What a paper is called. One a person added carries the name they gave it. */
export function paperLabel(paper: { code: string; label: string | null }, who: { sector: Sector; nationality: Nationality }): string {
  if (paper.label) return paper.label;
  if (paper.code === INBOX_PAPER) return TRAY;
  return DEAL_PAPER[paper.code] ?? documentLabel(paper.code, { financeType: "mortgage", ...who });
}

/** The papers a figure is written down from, by the short name each goes by in a sentence. */
const SOURCE_PAPER: Record<string, string> = {
  id: "الهوية",
  salary_cert: "تعريف الراتب",
  payslip: "مسير الرواتب",
  gosi: "برنت التأمينات",
  pension: "تعريف المعاش",
};

/** A paper as the source of a figure: "تعريف الراتب". */
export const sourcePaper = (paper: { code: string; label: string | null }): string => paper.label ?? SOURCE_PAPER[paper.code] ?? "مستند";

/** A figure of the file or of a paper, as it is read: an amount, or a year. */
export const factValue = (fact: PaperFact, value: number): string => (fact === "birthYear" ? ltr(value) : money(value));

/** What a person is asked to write down from a paper, over its field. */
export const STATED_FIELD: Record<PaperFact, string> = {
  totalSalary: "الراتب الإجمالي في المستند",
  basicSalary: "الراتب الأساسي في المستند",
  birthYear: "سنة الميلاد في المستند",
};

/** What was written down from a paper, in a line under it: "الراتب الإجمالي 19,800 · الأساسي 14,500". */
export function statedLine(stated: Partial<Record<PaperFact, number>>): string {
  const SHORT: Record<PaperFact, string> = { totalSalary: "الراتب الإجمالي", basicSalary: "الأساسي", birthYear: "سنة الميلاد" };
  return (Object.keys(SHORT) as PaperFact[]).flatMap((fact) => (stated[fact] != null ? [`${SHORT[fact]} ${factValue(fact, stated[fact]!)}`] : [])).join(" · ");
}

/** A fact the file and the checked papers state differently, with what each says. */
export function conflictText(conflict: Pick<FactReading, "fact" | "file"> & { stated: readonly { code: string; label: string | null; value: number }[] }): string {
  const papers = conflict.stated.map((statement) => `في ${sourcePaper(statement)} ${factValue(conflict.fact, statement.value)}`);
  const name = PAPER_FACT[conflict.fact];
  if (conflict.file == null) return `${name}: غير مدخل في الملف، و${papers.join("، و")}.`;
  return `${name}: في الملف ${factValue(conflict.fact, conflict.file)}، و${papers.join("، و")}.`;
}

/** How a conflict is settled, under it. With papers that differ among themselves the file cannot simply follow one. */
export const conflictWay = (reading: Pick<FactReading, "papersAgree">): string =>
  reading.papersAgree ? "إن كان المستند هو الصحيح فاعتمد ما فيه، وإلا فصحّح ما كُتب منه أو أعده." : "المستندات نفسها مختلفة. أعد القديم أو الخاطئ منها، أو صحّح ما كُتب منه.";

const RELY_ERROR: Record<RelyProblem, string> = {
  NOT_STATED: "هذا المستند لم يعد يذكر هذا البيان. حدّث الصفحة.",
  NO_CONFLICT: "لا تعارض الآن: الملف يوافق المستندات.",
  PAPERS_DISAGREE: "المستندات نفسها مختلفة، فاعتماد أحدها لا يحسم. أعد الخاطئ منها أولاً.",
};

/** What a kept file is, in a word. */
export const FILE_KIND: Record<FileKind, string> = { pdf: "PDF", jpeg: "صورة", png: "صورة", webp: "صورة" };

/** A file's name as a person reads it: without the extension, which the kind already says. */
export const fileTitle = (name: string): string => name.replace(/\.[A-Za-z0-9]{1,5}$/, "");

export const PAPER_COUNT: CountForms = { one: "مستند واحد", two: "مستندان", few: "مستندات", many: "مستنداً" };

/** How much of the file is still owed, as it reads under the verdict: "ينقص مستندان". */
export function missingText(missing: number): string {
  return missing === 0 ? "الملف مكتمل" : `ينقص ${counted(missing, PAPER_COUNT)}`;
}

/** The papers still owed in a few words: the first one by name, and how many come with it. */
export function owedBrief(labels: string[]): string {
  const [first, ...rest] = labels;
  if (!first) return "";
  if (!rest.length) return `${first}.`;
  return `${first}، و${counted(rest.length, { one: "مستند آخر", two: "مستندان آخران", few: "مستندات أخرى", many: "مستنداً آخر" })}.`;
}

/** The papers owed as numbered lines. A paper sent back says why it is needed again. */
export function owedLines(owed: { label: string; note: string | null }[]): string[] {
  return owed.map((paper, index) => `${index + 1}. ${paper.label}${paper.note ? ` (نحتاجه من جديد: ${paper.note})` : ""}`);
}

const PAPER_ERROR: Record<string, string> = {
  DEMO: "هذا عرض ببيانات وهمية. رفع الملفات يعمل مع البيانات الحقيقية.",
  NO_FILE: "اختر ملفاً.",
  FILE_TOO_LARGE: "الملف أكبر من 4 ميجابايت. صغّره أو قسّمه ثم ارفعه.",
  FILE_TYPE: "نقبل ملفات PDF والصور فقط.",
  FILE_LIMIT: "هذا المستند فيه 12 ملفاً، وهو الحد. احذف ما لا يلزم ثم ارفع.",
  PAPER_EMPTY: "لا ملف في هذا المستند بعد.",
  PAPER_HAS_FILES: "احذف ملفات المستند أولاً.",
  UPLOAD_LIMIT: "وصلنا عدد كبير من الملفات اليوم. أكمل غداً أو أرسلها لنا في واتساب.",
  LINK_CLOSED: "انتهت صلاحية الرابط. اطلب رابطاً جديداً من مسؤول ملفك.",
  NOT_FOUND: "هذا المستند لم يعد موجوداً. حدّث الصفحة.",
  INVALID_INPUT: "تحقق مما كتبته ثم حاول مرة أخرى.",
  NOT_ON_PAPER: "هذا المستند لا يذكر هذا البيان.",
  OUT_OF_RANGE: "الرقم خارج الحدود المقبولة. تحقق منه ثم حاول مرة أخرى.",
  BASIC_ABOVE_TOTAL: "الراتب الأساسي أكبر من الإجمالي. تحقق من الرقمين.",
  NOT_VERIFIED: "يُكتب ما في المستند بعد التحقق من سلامته.",
  FILE_BASIC_ABOVE_TOTAL: "اعتماده يجعل الراتب الأساسي في الملف أكبر من الإجمالي. صحّح الراتب الآخر في بيانات الصفقة أولاً.",
  FORBIDDEN: "لا تملك صلاحية تعديل بيانات العميل.",
  ...RELY_ERROR,
  UNREADABLE: "تعذرت قراءة الصورة. جرّب صورة أخرى.",
};

/** What to tell a person when a paper could not be saved. */
export const paperError = (code: string): string => PAPER_ERROR[code] ?? "تعذر الحفظ. حاول مرة أخرى.";

export const PAPER_ERROR_CODES = Object.keys(PAPER_ERROR);
