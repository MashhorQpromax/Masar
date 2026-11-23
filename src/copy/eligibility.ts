/**
 * The wording of eligibility: what a lender checks, what limits an amount, what helps the client,
 * what hurts and what to do next. The engine returns codes and numbers; this file turns them into Arabic.
 */
import type {
  Advice,
  Answer,
  AskedKind,
  CapacityWarning,
  CapRule,
  Check,
  ContractType,
  DocumentCategory,
  FinanceType,
  InquiryWindow,
  Limit,
  MissingFact,
  Nationality,
  NewCondition,
  Obligation,
  Point,
  Sector,
  SpecialKind,
  StudyVerdict,
  Unmet,
} from "@/domain/eligibility";
import { SECTOR } from "./editor";
import { counted, ltr, money, months, percent, type CountForms } from "./format";

export const STUDY_VERDICT: Record<StudyVerdict, string> = {
  eligible: "مؤهل",
  conditional: "مؤهل بشروط",
  not_eligible: "غير مؤهل الآن",
  pending: "ينقص الملف",
};

export const FINANCE_TYPE: Record<FinanceType, string> = {
  personal: "شخصي",
  mortgage: "عقاري",
  auto: "سيارة",
  sme: "منشأة",
  card: "بطاقة",
  project: "مشروع",
};

export const OBLIGATION_KIND: Record<Obligation["kind"], string> = {
  personal: "تمويل شخصي",
  mortgage: "تمويل عقاري",
  auto: "تمويل سيارة",
  card: "بطاقة ائتمانية",
  other: "التزام آخر",
};

export const CHECK_TITLE: Record<Check["key"], string> = {
  salary: "الراتب",
  sector: "جهة العمل",
  nationality: "الجنسية",
  age: "العمر",
  service: "مدة الخدمة",
  simah: "السجل الائتماني",
  transfer: "تحويل الراتب",
  retire: "التقاعد",
  ltv: "الدفعة الأولى",
  dbr: "القسط المتاح",
  special: "شروط الجهة الخاصة",
};

/** How a client is employed. */
export const CONTRACT_TYPE: Record<ContractType, string> = {
  permanent: "دائم",
  fixed_term: "محدد المدة",
  probation: "تحت التجربة",
};

/** A special condition a person answers for each client, named as what the lender asks for. */
export const ASKED_KIND: Record<AskedKind, string> = {
  employer: "جهة عمل معتمدة عندها",
  guarantor: "كفيل",
  collateral: "ضمان أو رهن",
  other: "شرط آخر",
};

/** What a special condition asks for, in a few words: its kind, with what the office wrote beside it. */
export function askedLabel(asked: { kind: AskedKind; text: string | null }): string {
  if (!asked.text) return ASKED_KIND[asked.kind];
  return asked.kind === "other" ? asked.text : `${ASKED_KIND[asked.kind]} (${asked.text})`;
}

const INQUIRIES: CountForms = { one: "استعلام واحد", two: "استعلامان", few: "استعلامات", many: "استعلاماً" };
/** The same count where it follows «أكثر من», which changes how two of them are written. */
const INQUIRIES_AFTER_PREPOSITION: CountForms = { ...INQUIRIES, two: "استعلامين" };
/** What a record holds in a lender's window. A record with none says so in words, not with a zero. */
const inquiriesFound = (count: number, window: number): string => (count === 0 ? `لا استعلام في السجل في آخر ${months(window)}` : `في السجل ${counted(count, INQUIRIES)} في آخر ${months(window)}`);

/** What each kind of special condition is called where one is picked. */
export const SPECIAL_KIND: Record<SpecialKind, string> = {
  min_amount: "أدنى تمويل",
  inquiries: "حد الاستعلامات",
  contract: "نوع العقد",
  employer: "اعتماد جهة العمل",
  guarantor: "كفيل",
  collateral: "ضمان أو رهن",
  other: "شرط آخر",
};

/** What the lender does with a client who does not meet a condition a person answers. */
export const UNMET: Record<Unmet, string> = {
  block: "ترفض من لا يستوفيه",
  action: "تطلبه ممن لا يستوفيه",
};

/** The same choice, in the words a choice has room for. */
export const UNMET_CHOICE: Record<Unmet, string> = {
  block: "مانع",
  action: "مطلوب من العميل",
};

/** The window a lender counts inquiries in. */
export const INQUIRY_WINDOW: Record<`${InquiryWindow}`, string> = {
  "6": "آخر 6 أشهر",
  "12": "آخر 12 شهراً",
};

/** What a person answered about a client and a condition. */
export const ANSWER: Record<Answer, string> = {
  met: "مستوفى",
  unmet: "غير مستوفى",
};

const QUESTIONS: CountForms = { one: "شرط واحد", two: "شرطان", few: "شروط", many: "شرطاً" };

/** How many of a client's questions nobody has answered. */
export const askedOpenText = (open: number): string => (open === 0 ? "أُجيب عنها كلها" : open === 1 ? "شرط واحد لم يُجب عنه" : open === 2 ? "شرطان لم يُجب عنهما" : `${counted(open, QUESTIONS)} لم يُجب عنها`);

export const SPECIAL_CONDITIONS: CountForms = { one: "شرط خاص واحد", two: "شرطان خاصان", few: "شروط خاصة", many: "شرطاً خاصاً" };

/** A special condition as it reads in a lender's list. */
export function conditionText(c: NewCondition): string {
  switch (c.kind) {
    case "min_amount":
      return `لا تموّل أقل من ${money(c.amount)}`;
    case "inquiries":
      return c.count === 0 ? `لا تقبل استعلاماً في آخر ${months(c.months)}` : `لا تقبل أكثر من ${counted(c.count, INQUIRIES_AFTER_PREPOSITION)} في آخر ${months(c.months)}`;
    case "contract":
      return `تقبل عقد العمل: ${c.contracts.map((contract) => CONTRACT_TYPE[contract]).join(" أو ")}`;
    default:
      return askedLabel(c);
  }
}

/** The rule that holds the installment, as it reads after "يحكمه". */
export function capRuleText(rule: CapRule, share: number, who: { retired: boolean; mortgage: boolean }): string {
  if (rule === "SALARY_DEDUCTION") return who.retired ? "حد ربع المعاش" : "حد ثلث الراتب";
  if (rule === "NON_REAL_ESTATE") return `حد ${percent(Math.round(share * 100))} للالتزامات غير العقارية`;
  return `السقف الكلي ${percent(Math.round(share * 100))} من الدخل${who.mortgage ? " شاملاً العقاري" : ""}`;
}

export function capacityWarningText(warning: CapacityWarning): string {
  if (warning === "BASIC_SALARY_USED") return "الراتب الإجمالي غير مدخل، فحسبنا على الأساسي. التقدير متحفظ.";
  return "الدخل 25,000 فأكثر، والسقف الكلي فيه بحسب سياسة الجهة. حسبنا على 65%.";
}

const ONLY_FOR: Record<Nationality, string> = { saudi: "المنتج لغير السعوديين فقط.", non_saudi: "المنتج للسعوديين فقط." };

/** One condition of a product, said about this client. */
export function checkText(c: Check): string {
  const ok = c.status === "pass";
  switch (c.code) {
    case "SALARY_MISSING":
      return "الراتب غير مدخل.";
    case "SALARY_MIN":
      return ok
        ? `الراتب ${money(c.params.salary)} يكفي، والحد الأدنى ${money(c.params.min)}.`
        : `الراتب ${money(c.params.salary)} أقل من الحد الأدنى ${money(c.params.min)}.`;
    case "SECTOR":
      return ok ? `جهة العمل مقبولة (${SECTOR[c.params.sector]}).` : `المنتج لا يقبل جهة العمل (${SECTOR[c.params.sector]}).`;
    case "NATIONALITY":
      return ok ? "الجنسية مقبولة." : ONLY_FOR[c.params.nationality];
    case "AGE_MISSING":
      return "سنة الميلاد غير مدخلة.";
    case "AGE_BELOW_MIN":
      return `العمر ${ltr(c.params.age)} أقل من الحد الأدنى ${ltr(c.params.min)}.`;
    case "AGE_OVER_MAX":
      return `العمر تجاوز حد الجهة عند نهاية التمويل، وهو ${ltr(c.params.max)} سنة.`;
    case "TENOR_SHORTENED":
      return `قُصّرت المدة إلى ${months(c.params.tenor)} حتى ينتهي التمويل قبل سن ${ltr(c.params.max)}.`;
    case "AGE_AT_END":
      return `ينتهي التمويل وعمره ${ltr(c.params.ageAtEnd)} سنة، وحد الجهة ${ltr(c.params.max)}.`;
    case "SERVICE_NOT_NEEDED":
      return "متقاعد، ولا تُشترط مدة خدمة.";
    case "SERVICE_MISSING":
      return "مدة الخدمة غير مدخلة.";
    case "SERVICE_MIN":
      return ok
        ? `مدة الخدمة ${months(c.params.months)} تكفي، والمطلوب ${months(c.params.min)}.`
        : `مدة الخدمة ${months(c.params.months)} أقل من المطلوب، وهو ${months(c.params.min)}.`;
    case "RECORD_CLEAN":
      return "السجل الائتماني نظيف.";
    case "RECORD_UNKNOWN":
      return "لم يُقرأ تقرير سمة بعد.";
    case "RECORD_LATE":
      return c.status === "fail" ? "في السجل تأخر سداد، والجهة لا تقبله." : "في السجل تأخر سداد، والجهة تقبله بشروط.";
    case "RECORD_DEFAULT":
      return "في السجل تعثر قائم. يلزم السداد والمخالصة أولاً.";
    case "SALARY_TRANSFER":
      return ok ? "الراتب محوّل على الجهة نفسها." : "يتطلب تحويل الراتب إلى الجهة.";
    case "RETIRES_IN_TERM":
      return `يتقاعد بعد ${months(c.params.months)}، والمعاش المتوقع ${money(c.params.pension)}، فينزل القسط بعدها إلى ${money(c.params.installmentAfter)}.`;
    case "DOWN_PAYMENT":
      return c.params.propertyValue
        ? `تموّل الجهة حتى ${percent(c.params.percent)} من ${money(c.params.propertyValue)}، والدفعة الأولى ${money(c.params.down ?? 0)}.`
        : `تموّل الجهة حتى ${percent(c.params.percent)} من قيمة العقار، والدفعة الأولى ${percent(100 - c.params.percent)}.`;
    case "NO_ROOM":
      return "لا قسط متاح ضمن حدود ساما.";
    case "ROOM":
      return `القسط المتاح ${money(c.params.available)}، ويحكمه ${capRuleText(c.params.rule, c.params.share, c.params)}.`;
    case "SPECIAL_LIST":
      return c.params.count ? "للجهة شروط خاصة مسجلة." : "لا شروط خاصة مسجلة للجهة.";
    case "AMOUNT_MIN":
      if (ok) return `المبلغ فوق أدنى تمويل عند الجهة، وهو ${money(c.params.min)}.`;
      return c.status === "warn" ? `أدنى تمويل عند الجهة ${money(c.params.min)}، والمطلوب أقل منه.` : `أدنى تمويل عند الجهة ${money(c.params.min)}، والمتاح للعميل ${money(c.params.amount)}.`;
    case "INQUIRIES":
      // A lender that takes none says so in words: a limit of zero reads as a mistake.
      if (c.params.max === 0) return ok ? `${inquiriesFound(c.params.count, c.params.months)}، والجهة لا تقبل أي استعلام فيها.` : `${inquiriesFound(c.params.count, c.params.months)}، والجهة لا تقبل أي استعلام.`;
      return ok
        ? `${inquiriesFound(c.params.count, c.params.months)}، وحد الجهة ${ltr(c.params.max)}.`
        : `${inquiriesFound(c.params.count, c.params.months)}، والجهة لا تقبل أكثر من ${ltr(c.params.max)}.`;
    case "INQUIRIES_UNKNOWN":
      return "عدد الاستعلامات في سمة غير معروف.";
    case "CONTRACT":
      return ok ? `نوع العقد مقبول (${CONTRACT_TYPE[c.params.contract]}).` : `الجهة لا تقبل نوع العقد (${CONTRACT_TYPE[c.params.contract]}).`;
    case "CONTRACT_MISSING":
      return "نوع عقد العميل غير مدخل.";
    case "ASKED":
      if (ok) return `مستوفى: ${askedLabel(c.params)}.`;
      return c.status === "warn" ? `تشترط الجهة ولم يستوفه العميل بعد: ${askedLabel(c.params)}.` : `العميل لا يستوفي شرط الجهة: ${askedLabel(c.params)}.`;
    case "ASKED_OPEN":
      return `لم يُجب بعد عن شرط الجهة: ${askedLabel(c.params)}.`;
  }
}

/** What kept the amount from being larger. */
export function limitText(limit: Limit): string {
  switch (limit.code) {
    case "INCOME":
      return "يحدّه القسط المتاح";
    case "RETIREMENT":
      return "يحدّه نزول الدخل بعد التقاعد";
    case "LTV":
      return `يحدّه ${percent(limit.percent)} من قيمة العقار`;
    case "PRODUCT_MAX":
      return "يحدّه سقف المنتج";
  }
}

/** Something that helps or hurts with every lender. */
export function pointText(point: Point): string {
  switch (point.code) {
    case "STRONG_EMPLOYER":
      return "جهة عمل حكومية أو شبه حكومية، وهي المفضلة لدى أغلب الجهات.";
    case "APPROVED_EMPLOYER":
      return "جهة عمل خاصة معتمدة لدى الجهات.";
    case "UNAPPROVED_EMPLOYER":
      return "جهة عمل غير معتمدة: خيارات أقل ونسب أعلى.";
    case "CLEAN_RECORD":
      return "سجل ائتماني نظيف.";
    case "LATE_RECORD":
      return "في سمة تأخر سداد.";
    case "DEFAULT_RECORD":
      return "في سمة تعثر يمنع أغلب الجهات.";
    case "DEBT_SHARE":
      return `الالتزامات الحالية ${percent(point.percent)} من الدخل.`;
    case "NO_ROOM":
      return "لا هامش استقطاع ضمن حدود ساما.";
    case "SHORT_SERVICE":
      return "مدة الخدمة أقل من 3 أشهر.";
  }
}

export const MISSING_FACT: Record<MissingFact, string> = {
  AGE: "سنة الميلاد",
  TOTAL_SALARY: "الراتب الإجمالي",
  SERVICE: "مدة الخدمة",
  CREDIT_REPORT: "تقرير سمة",
  SALARY_BANK: "بنك الراتب",
  REQUESTED_AMOUNT: "المبلغ المطلوب",
};

/** What to do next. */
export function adviceText(advice: Advice): string {
  switch (advice.code) {
    case "BEST_OPTION":
      return `أفضل خيار الآن: ${advice.lender}، ${advice.product}، بمبلغ ${money(advice.amount)} وقسط ${money(advice.installment)} لمدة ${months(advice.tenor)}.`;
    case "CLEAR_DEFAULTS":
      return "سدّد التعثرات واستخرج المخالصة وحدّث سمة قبل أي تقديم.";
    case "PAY_SMALLEST":
      return `سدّد أصغر التزام (${advice.lender ?? OBLIGATION_KIND[advice.kind]}) أو أعد جدولته ليرتفع القسط المتاح.`;
    case "SALARY_BANK_FIRST":
      return "ابدأ ببنك الراتب، فهو أسرع غالباً وبنسبة أفضل. قارن عرضه بأفضل بديل قبل نقل الراتب.";
    case "APPLY_ORDER":
      return `قدّم بالترتيب: ${advice.lenders.join(" ثم ")}. طلب بعد طلب لا معاً، حتى لا تكثر الاستعلامات في سمة.`;
    case "AMOUNT_ABOVE_POSSIBLE":
      return `المطلوب ${money(advice.requested)} أعلى من الممكن ${money(advice.possible)}. الحلول: متضامن، أو مدة أطول، أو مبلغ أقل.`;
    case "COMPLETE_DATA":
      return `أكمل الناقص: ${advice.missing.map((fact) => MISSING_FACT[fact]).join("، ")}.`;
  }
}

export const DOCUMENT_CATEGORY: Record<DocumentCategory, string> = {
  identity: "الهوية",
  income: "الدخل",
  obligations: "الالتزامات",
  collateral: "الضمان",
  business: "النشاط",
};

const DOCUMENT: Record<string, string> = {
  address: "العنوان الوطني",
  simah: "تقرير سمة حديث",
  obligations: "جداول الأقساط القائمة أو خطابات المديونية",
  salary_cert: "تعريف بالراتب لا يتجاوز شهراً",
  payslip: "مسير الرواتب",
  gosi: "برنت التأمينات الاجتماعية",
  pension: "تعريف بالمعاش التقاعدي",
  zakat: "شهادة الزكاة",
  bank_12: "كشف حساب آخر 12 شهراً",
  family: "سجل الأسرة",
  sakani: "شهادة استحقاق سكني، إن وجدت",
  quote: "عرض سعر السيارة",
  license: "رخصة القيادة",
  feasibility: "دراسة جدوى من مكتب معتمد",
  permit: "رخصة البناء أو خطاب اشتراطات البناء",
  boq: "تكلفة البناء التقديرية والمخططات",
  sources_uses: "خطة استخدام المبلغ",
  lien: "خطاب حالة الرهن، إن كان على الأرض رهن",
  zoning: "إفادة الأمانة بحالة القطعة",
};

/** A required paper by its name. A few read differently by who the client is and what they ask for. */
export function documentLabel(code: string, who: { financeType: FinanceType; sector: Sector; nationality: Nationality }): string {
  const project = who.financeType === "project";
  switch (code) {
    case "id":
      return who.nationality === "saudi" ? "الهوية الوطنية" : "الإقامة سارية المفعول";
    case "bank_3":
      return who.sector === "retired" ? "كشف حساب آخر 3 أشهر" : "كشف حساب آخر 3 إلى 6 أشهر";
    case "cr":
      return project && who.sector !== "self" ? "السجل التجاري للشركة وقوائمها المالية، إن وجدت" : "السجل التجاري";
    case "fin_statements":
      return who.sector === "self" ? "القوائم المالية لآخر سنتين" : "القوائم المالية";
    case "deed":
      return project ? "صك الأرض ورقم الهوية العقارية" : "صك العقار";
    case "valuation":
      return project ? "تقرير التقييم الكامل من مقيّم معتمد" : "تقييم عقاري معتمد";
    default:
      return DOCUMENT[code] ?? code;
  }
}
