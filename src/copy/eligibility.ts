/**
 * The wording of eligibility: what a lender checks, what limits an amount, what helps the client,
 * what hurts and what to do next. The engine returns codes and numbers; this file turns them into Arabic.
 */
import type {
  Advice,
  CapacityWarning,
  CapRule,
  Check,
  DocumentCategory,
  FinanceType,
  Limit,
  MissingFact,
  Nationality,
  Obligation,
  Point,
  Sector,
  StudyVerdict,
} from "@/domain/eligibility";
import { SECTOR } from "./editor";
import { ltr, money, months, percent } from "./format";

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
};

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
