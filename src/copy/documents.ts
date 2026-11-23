/**
 * The wording of a client's papers: what each one is called, where it stands, and what to tell the
 * client who still owes some. The engine returns codes; this file turns them into Arabic.
 */
import type { FileKind, PaperCategory, PaperStatus } from "@/domain/documents";
import type { Nationality } from "@/domain/eligibility";
import type { Sector } from "@/domain/shared/sector";
import { documentLabel } from "./eligibility";
import { counted, type CountForms } from "./format";

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

/** What a paper is called. One a person added carries the name they gave it. */
export function paperLabel(paper: { code: string; label: string | null }, who: { sector: Sector; nationality: Nationality }): string {
  if (paper.label) return paper.label;
  return DEAL_PAPER[paper.code] ?? documentLabel(paper.code, { financeType: "mortgage", ...who });
}

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

/**
 * The message a person sends the client to ask for what is owed. It names the papers and nothing
 * else: no amounts, no fees, nothing about the deal.
 */
export function askText(clientName: string, owed: { label: string; note: string | null }[]): string {
  const first = clientName.trim().split(/\s+/)[0] ?? "";
  const lines = owed.map((paper, index) => `${index + 1}. ${paper.label}${paper.note ? ` (نحتاجه من جديد: ${paper.note})` : ""}`);
  return [`السلام عليكم${first ? ` ${first}` : ""}،`, "لإكمال ملفك نحتاج:", ...lines, "أرسلها هنا صوراً واضحة أو ملفات PDF. شكراً لك."].join("\n");
}

const PAPER_ERROR: Record<string, string> = {
  DEMO: "هذا عرض ببيانات وهمية. رفع الملفات يعمل مع البيانات الحقيقية.",
  NO_FILE: "اختر ملفاً.",
  FILE_TOO_LARGE: "الملف أكبر من 4 ميجابايت. صغّره أو قسّمه ثم ارفعه.",
  FILE_TYPE: "نقبل ملفات PDF والصور فقط.",
  FILE_LIMIT: "هذا المستند فيه 12 ملفاً، وهو الحد. احذف ما لا يلزم ثم ارفع.",
  PAPER_EMPTY: "لا ملف في هذا المستند بعد.",
  PAPER_HAS_FILES: "احذف ملفات المستند أولاً.",
  NOT_FOUND: "هذا المستند لم يعد موجوداً. حدّث الصفحة.",
  INVALID_INPUT: "تحقق مما كتبته ثم حاول مرة أخرى.",
  UNREADABLE: "تعذرت قراءة الصورة. جرّب صورة أخرى.",
};

/** What to tell a person when a paper could not be saved. */
export const paperError = (code: string): string => PAPER_ERROR[code] ?? "تعذر الحفظ. حاول مرة أخرى.";

export const PAPER_ERROR_CODES = Object.keys(PAPER_ERROR);
