/**
 * The wording of the credit record: grades, doors, what blocks, what was found and what to do.
 * The engine returns codes and numbers; this file turns them into Arabic. Short sentences, no decoration.
 */
import {
  CREDIT_RULES,
  type Access,
  type Blocker,
  type CreditAction,
  type CreditorType,
  type Door,
  type FacilityStatus,
  type Finding,
  type Grade,
  type JudgmentKind,
  type ParsedReport,
  type ParseWarning,
  type Standing,
} from "@/domain/credit";
import { joinLabel, type DraftSource } from "@/domain/deal";
import { counted, days, ltr, money, months, percent } from "./format";

export const GRADE: Record<Grade, { title: string; note: string }> = {
  A: { title: "ممتاز", note: "مقبول لدى الجميع" },
  B: { title: "جيد", note: "مقبول مع ملاحظات" },
  C: { title: "ضعيف", note: "شركات التمويل غالباً" },
  D: { title: "سيئ", note: "يحتاج معالجة قبل أي تقديم" },
  E: { title: "مغلق", note: "عليه مانع قائم" },
};

export const STANDING: Record<Standing, string> = {
  clean: "نظيف",
  late: "عليه تأخرات",
  default: "عليه تعثر",
};

export const ACCESS: Record<Access, string> = {
  open: "مفتوح",
  conditional: "بشروط",
  closed: "مغلق",
};

export const CREDITOR_TYPE: Record<CreditorType, string> = {
  bank: "بنك",
  finance_company: "شركة تمويل",
  telecom: "اتصالات وخدمات",
  other: "جهة أخرى",
};

export const FACILITY_STATUS: Record<FacilityStatus, string> = {
  current: "منتظم",
  late: "متأخر",
  default: "متعثر",
  settled: "تعثر مسدد",
  closed: "مغلق",
};

export const JUDGMENT_KIND: Record<JudgmentKind, string> = {
  judgment: "حكم",
  enforcement: "قرار تنفيذ",
  bounced_cheque: "شيك مرتجع",
};

const DEFAULTS = { one: "تعثر واحد", two: "تعثران", few: "تعثرات", many: "تعثراً" };
const COMMITMENTS = { one: "التزام واحد", two: "التزامين", few: "التزامات", many: "التزاماً" };
const INQUIRIES = { one: "استعلام واحد", two: "استعلامان", few: "استعلامات", many: "استعلاماً" };

const REASON: Record<Door["reason"], string> = {
  BLOCKER: "على السجل مانع قائم.",
  RECENT_SETTLEMENT_FINANCE_CO: "تعثر لدى شركة تمويل سُدد حديثاً.",
  RECENT_SETTLEMENT_BANK: "تعثر لدى بنك سُدد حديثاً.",
  VERY_RECENT_SETTLEMENT: "التسوية حديثة جداً.",
  RECENT_DELAYS: "تأخرات حديثة في السداد.",
  SETTLED_HISTORY: "في السجل تعثر مسدد.",
  MANY_INQUIRIES: "استعلامات كثيرة في وقت قصير.",
  WITH_SETTLEMENT_LETTER: "بعض الشركات تقبل بخطاب تسوية وانتظام في السداد.",
  ACCEPTABLE: "السجل مقبول.",
};

/** Why a door stands as it does, and when a closed one is expected to open. */
export function doorText(door: Door): { reason: string; reopen: string | null } {
  return {
    reason: REASON[door.reason],
    reopen: door.reopenInMonths ? `يُتوقع أن يفتح بعد ${months(door.reopenInMonths)}.` : null,
  };
}

/** One blocker as a sentence a person can act on. */
export function blockerText(blocker: Blocker): string {
  switch (blocker.code) {
    case "SUSPENSION":
      return blocker.params.assumed
        ? "إيقاف خدمات مرجّح، فعلى السجل قرار تنفيذ لم يُنفّذ (المادة 46). تحقق من أبشر أو ناجز. لا تقبل أي جهة قبل رفعه."
        : "إيقاف خدمات قائم. لا تقبل أي جهة قبل رفعه.";
    case "TRAVEL_BAN":
      return "منع سفر مرتبط بقضية تنفيذ.";
    case "JUDGMENT": {
      const p = blocker.params;
      const parts = [
        `${JUDGMENT_KIND[p.kind]} قائم${p.creditor ? ` لصالح ${p.creditor}${p.creditorGuessed ? " على الأرجح" : ""}` : ""}`,
        p.amount != null ? `بمبلغ ${money(p.amount)} ريال` : null,
        p.date ? `صدر في ${ltr(p.date)}` : null,
        p.state ? `حالته: ${p.state}` : null,
      ];
      return `${parts.filter(Boolean).join("، ")}.`;
    }
    case "BOUNCED_CHEQUE":
      return `شيك مرتجع غير مسوّى${blocker.params.amount != null ? ` بمبلغ ${money(blocker.params.amount)} ريال` : ""}.`;
    case "ACTIVE_DEFAULT": {
      const p = blocker.params;
      const parts = [
        `تعثر قائم لدى ${p.lender} (${CREDITOR_TYPE[p.creditorType]})`,
        p.remaining != null ? `المتبقي ${money(p.remaining)} ريال` : null,
        p.listedAt ? `مُدرج منذ ${ltr(p.listedAt)}` : null,
        p.state,
        p.enforced ? "ومرفوع به قرار تنفيذ" : null,
      ];
      return `${parts.filter(Boolean).join("، ")}.`;
    }
  }
}

/** One finding as a sentence. */
export function findingText(finding: Finding): string {
  switch (finding.code) {
    case "TOTAL_TO_CLEAR":
      return `المطلوب سداده أو تسويته لفتح الأبواب ${money(finding.params.amount)} ريال تقريباً: قرارات التنفيذ والتعثرات التي لم يُرفع بها قرار، بلا احتساب دين مرتين.`;
    case "FINANCE_CO_DEFAULTS":
      return `${counted(finding.params.count, DEFAULTS)} لدى شركات تمويل. يُقرأ أسوأ من تعثر البنك، والبنوك تنتظر بعده نحو ${months(finding.params.waitMonths)} من التسوية.`;
    case "BANK_DEFAULTS":
      return `${counted(finding.params.count, DEFAULTS)} لدى بنوك. البنوك تنتظر عادة نحو ${months(finding.params.waitMonths)} بعد التسوية والمخالصة.`;
    case "TELECOM_DEFAULTS":
      return `${counted(finding.params.count, DEFAULTS)} في الاتصالات أو الفواتير. وزنه أخف، لكن أغلب الجهات ترفض أي تعثر قائم مهما صغر، فتأكد من سداده قبل التقديم.`;
    case "SETTLED_DEFAULT": {
      const p = finding.params;
      const since = p.monthsAgo == null ? "" : p.monthsAgo < 1 ? " منذ أقل من شهر" : ` منذ ${months(p.monthsAgo)}`;
      return `تعثر مسدد لدى ${p.lender} (${CREDITOR_TYPE[p.creditorType]})${since}${p.amount != null ? `، مبلغه ${money(p.amount)} ريال` : ""}. يبقى ظاهراً في السجل كتاريخ.`;
    }
    case "RECENT_DELAYS": {
      const p = finding.params;
      return `تأخر ${days(CREDIT_RULES.delayDays)} فأكثر على ${counted(p.count, COMMITMENTS)} خلال آخر ${months(p.windowMonths)}. أسوأ تأخر ${days(p.worstDelay)}.`;
    }
    case "OLD_DELAY":
      return `تأخر قديم خارج آخر ${months(finding.params.windowMonths)}، أسوأه ${days(finding.params.worstDelay)}.`;
    case "MANY_INQUIRIES":
      return `${counted(finding.params.count, INQUIRIES)} خلال 6 أشهر. يُقرأ بحثاً مكثفاً عن تمويل، وبعض الجهات ترفض أو تؤجل.`;
    case "CARD_UTILIZATION": {
      const p = finding.params;
      return `استخدام البطاقات ${percent(p.percent)} من الحدود: ${money(p.balance)} من ${money(p.limit)} ريال.`;
    }
    case "SCORE":
      return `الدرجة الائتمانية ${ltr(finding.params.score)}.`;
    case "INSTALLMENTS":
      return `أقساط شهرية قائمة في سمة ${money(finding.params.monthly)} ريال على ${counted(finding.params.facilities, COMMITMENTS)}. تأكد أنها كلها مدخلة في التزامات العميل.`;
    case "CLEAN":
      return "لا تعثرات ولا أحكام ولا تأخرات حديثة.";
  }
}

/** One step of the repair plan, as an instruction. */
export function actionText(action: CreditAction): string {
  switch (action.code) {
    case "LIFT_SUSPENSION":
      return "احصر طلبات التنفيذ في ناجز، وسدّد أو سوِّ مع الدائن، ثم اطلب رفع الإيقاف من محكمة التنفيذ. قد يأخذ الرفع أياماً بعد السداد.";
    case "SETTLE_JUDGMENTS": {
      const p = action.params;
      return `سدّد أو سوِّ ${p.count === 1 ? "قرار التنفيذ" : `قرارات التنفيذ (${ltr(p.count)})`} بمجموع ${money(p.amount)} ريال، ثم اطلب إثبات الانقضاء من ناجز. خصم مقابل السداد الفوري ممكن غالباً.`;
    }
    case "PAY_DEFAULT":
      return `سدّد تعثر ${action.params.lender} (${money(action.params.amount)} ريال) واطلب خطاب مخالصة.`;
    case "REFRESH_REPORT":
      return "اطلب من كل دائن تحديث سمة بعد السداد، ويتم عادة خلال 30 يوماً. ثم استخرج تقريراً جديداً وارفعه هنا.";
    case "PAY_ON_TIME":
      return "انتظام كامل في كل الأقساط من 6 إلى 12 شهراً قبل التقديم للبنوك.";
    case "PAUSE_APPLICATIONS":
      return "أوقف أي تقديم جديد حتى تقل الاستعلامات، ثم قدّم لجهة واحدة في كل مرة.";
    case "LOWER_CARDS":
      return "اخفض رصيد البطاقات إلى ما دون نصف الحد، أو ألغِ غير المستخدم منها.";
    case "RESTUDY_BANKS":
      return `أعد الدراسة للبنوك بعد ${months(action.params.months)} تقريباً.`;
    case "NONE":
      return "لا إجراء مطلوب على السجل الائتماني.";
  }
}

/** The same step in a few words, as a heading. */
export function actionTitle(action: CreditAction): string {
  switch (action.code) {
    case "LIFT_SUSPENSION":
      return "ارفع إيقاف الخدمات";
    case "SETTLE_JUDGMENTS":
      return action.params.count === 1 ? "سدّد قرار التنفيذ" : "سدّد قرارات التنفيذ";
    case "PAY_DEFAULT":
      return `سدّد تعثر ${action.params.lender}`;
    case "REFRESH_REPORT":
      return "حدّث سمة وارفع تقريراً جديداً";
    case "PAY_ON_TIME":
      return "انتظام في السداد";
    case "PAUSE_APPLICATIONS":
      return "أوقف التقديمات الجديدة";
    case "LOWER_CARDS":
      return "اخفض رصيد البطاقات";
    case "RESTUDY_BANKS":
      return `أعد الدراسة بعد ${months(action.params.months)}`;
    case "NONE":
      return "لا إجراء مطلوب";
  }
}

/** How far a reading of the report can be trusted before a person has checked it. */
export const CONFIDENCE: Record<ParsedReport["confidence"], string> = {
  high: "قراءة واثقة",
  medium: "تحتاج مراجعة",
  low: "راجعها يدوياً",
};

const ORDERS_UNPAID = { one: "قرار تنفيذ لم يُنفّذ", two: "قراران لم يُنفّذا", few: "قرارات تنفيذ لم تُنفّذ", many: "قرار تنفيذ لم يُنفّذ" };

/** Something in the reading of a report that a person should check. */
export function parseWarningText(warning: ParseWarning): string {
  switch (warning.code) {
    case "UNMATCHED_DEFAULT":
      return `تعثر بمبلغ ${money(warning.params.amount)} ريال لم يُطابق بمنتج. راجع الجهة يدوياً.`;
    case "ACTIVE_COUNT_MISMATCH":
      return `ملخص التقرير يذكر ${ltr(warning.params.summary)} من المنتجات النشطة، والمقروء ${ltr(warning.params.read)}. راجع المنتجات.`;
    case "NO_FACILITIES":
      return "تعذرت قراءة تفاصيل المنتجات. أدخلها يدوياً.";
    case "SUSPENSION_ASSUMED":
      return `${counted(warning.params.orders, ORDERS_UNPAID)}. افترضنا إيقاف خدمات (المادة 46). تحقق من أبشر أو ناجز.`;
    case "DEFAULTS_TOTAL_MISMATCH":
      return `مجموع المتعثرات المقروء ${money(warning.params.read)} ريال، وملخص سمة يذكر ${money(warning.params.summary)}. راجع المبالغ.`;
  }
}

const PAYOFF_TITLE: Record<Extract<DraftSource, { from: "obligation" }>["kind"], string> = {
  mortgage: "مخالصة العقاري",
  personal: "مخالصة الشخصي",
  auto: "مخالصة تمويل سيارة",
  card: "مخالصة بطاقة",
};

/** The label a suggested deal item starts with, in the "title — party" form the deal stores. */
export function draftLabel(source: DraftSource): string {
  switch (source.from) {
    case "judgment": {
      const title = `${JUDGMENT_KIND[source.kind]}${source.decisionNo ? ` ${source.decisionNo}` : ""}`;
      return joinLabel(title, `${source.creditor ?? "دائن غير محدد"}${source.date ? ` (${source.date})` : ""}`);
    }
    case "default":
      return joinLabel(`تعثر ${source.lender}`, source.product);
    case "obligation":
      return joinLabel(PAYOFF_TITLE[source.kind], source.lender ?? "");
    case "product":
      return joinLabel(source.product, source.lender);
  }
}

const PRODUCTS = { one: "منتج واحد", two: "منتجان", few: "منتجات", many: "منتجاً" };
const ORDERS = { one: "قرار تنفيذ واحد", two: "قرارا تنفيذ", few: "قرارات تنفيذ", many: "قرار تنفيذ" };

/** What a reading found, said in one line once the report is stored. */
export function readText(read: { facilities: number; judgments: number }): string {
  const found = [read.facilities ? counted(read.facilities, PRODUCTS) : null, read.judgments ? counted(read.judgments, ORDERS) : null].filter(Boolean);
  return found.length ? `قرأنا التقرير: ${found.join(" و")}.` : "قرأنا التقرير.";
}

const UPLOAD_ERROR: Record<string, string> = {
  DEMO: "هذا عرض ببيانات وهمية. رفع التقارير يعمل مع البيانات الحقيقية.",
  NO_FILE: "اختر ملف التقرير.",
  TOO_LARGE: "الملف أكبر من 4 ميجابايت. ارفع التقرير كما نزل من سمة.",
  NOT_PDF: "ارفع التقرير بصيغة PDF كما نزل من سمة.",
  UNREADABLE: "تعذرت قراءة الملف. ارفع التقرير الأصلي من سمة، لا صورة منه.",
  NOT_SIMAH: "لم نجد بيانات سمة في الملف. ارفع التقرير الائتماني الأساسي.",
  NOT_FOUND: "هذا الملف غير موجود.",
  CONSENT_NEEDED: "التقرير لا يُقرأ بلا موافقة العميل. أكّد موافقته ثم ارفعه.",
  INVALID_INPUT: "قرأنا التقرير ولم نستطع حفظه. راجع الملف وحاول مرة أخرى.",
};

/** Why a report was not taken, or why a review was not saved. */
export const creditError = (code: string): string => UPLOAD_ERROR[code] ?? "تعذر الحفظ. حاول مرة أخرى.";

/** What a person confirms before the first report of a client is read. */
export const CONSENT_ASK = "وافق العميل على قراءة تقريره ومعالجة بياناته";

/** What recording that a client took their consent back does, said before it is recorded. */
export const CONSENT_WITHDRAWN = "يُسجَّل السحب في سجل التدقيق، ولا يُقرأ له تقرير جديد ولا يُعتمد تحليله قبل موافقة جديدة.";

/** The codes an upload can answer with, for the test that every one has its sentence. */
export const UPLOAD_ERROR_CODES = Object.keys(UPLOAD_ERROR);
