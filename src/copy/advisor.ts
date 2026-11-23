/**
 * The wording of the advisor: what a lender may ask for beyond its terms, and the ways to a larger
 * amount. The engine returns codes and numbers; this file turns them into Arabic.
 */
import {
  bankShortName,
  MEDICAL_AGE_AT_END,
  MEDICAL_AMOUNT,
  type Condition,
  type ConditionCode,
  type ConditionLevel,
  type ConditionSource,
  type Effort,
  type Obligation,
  type WayOut,
  type WayOutCode,
} from "@/domain/eligibility";
import { SAMA } from "@/domain/finance";
import { ltr, money, months, percent } from "./format";

export const CONDITION_LEVEL: Record<ConditionLevel, string> = { block: "مانع", warn: "تنبيه", info: "للعلم" };
export const CONDITION_SOURCE: Record<ConditionSource, string> = { SAMA: "ساما", MARKET: "ممارسة السوق" };
export const EFFORT: Record<Effort, string> = { easy: "سهل", medium: "متوسط", hard: "صعب" };

const CONDITION_TITLE: Record<ConditionCode, string> = {
  MEDICAL: "تقرير أو فحص طبي",
  YOUNG_FOR_MORTGAGE: "عمر صغير للعقاري",
  ENDS_AFTER_RETIREMENT: "التمويل يتجاوز سن التقاعد",
  STEP_DOWN: "قسط ينزل بعد التقاعد",
  RESIDENT: "اشتراطات المقيم",
  RESIDENT_MORTGAGE: "عقاري لغير سعودي",
  EMPLOYER_NOT_LISTED: "جهة عمل غير مصنفة",
  SHORT_SERVICE: "خدمة قصيرة",
  GOSI_MATCH: "مطابقة الراتب مع التأمينات",
  ALLOWANCES: "البدلات جزء كبير من الراتب",
  SELF_EMPLOYED: "صاحب عمل حر",
  MILITARY: "عسكري",
  RETIRED: "متقاعد",
  RECORD_LATE: "تأخر سداد في سمة",
  RECORD_DEFAULT: "تعثر قائم في سمة",
  RECORD_UNKNOWN: "تقرير سمة لم يُقرأ",
  TRANSFER_LOCK: "قرض قائم مرتبط بتحويل الراتب",
  CARDS: "البطاقات الائتمانية",
  TOP_UP: "تمويل إضافي بدل قرض جديد",
  SECOND_HOME: "ليس المسكن الأول",
  HOUSING_SUPPORT: "تحقق من استحقاق سكني",
  VALUATION: "التقييم وحالة العقار",
  CAR_COSTS: "تكاليف السيارة",
  CARD_LIMIT: "حد البطاقة",
  LIVING_COSTS: "تكاليف المعيشة",
  ONE_AT_A_TIME: "طلب بعد طلب",
};

/** A condition in a few words. */
export const conditionTitle = (condition: Condition): string => CONDITION_TITLE[condition.code];

/** Joins reasons the way they are said: "أ، وب، وج". */
const listed = (parts: string[]): string => parts.map((part, i) => (i ? `و${part}` : part)).join("، ");

/** What the condition means for this client. */
export function conditionDetail(c: Condition): string {
  switch (c.code) {
    case "MEDICAL": {
      const why = [
        c.params.age != null && `العمر ${ltr(c.params.age)}`,
        c.params.ageAtEnd != null && `التمويل ينتهي وعمره ${ltr(c.params.ageAtEnd)} سنة`,
        c.params.largeAmount && `المبلغ فوق ${money(MEDICAL_AMOUNT)}`,
      ].filter((part): part is string => !!part);
      return `التأمين على الحياة شرط في التمويل العقاري. ${listed(why)}، فتطلب جهات كثيرة إفصاحاً صحياً أو فحصاً، وقد ترفع قسط التأمين أو تستثني مرضاً سابقاً.`;
    }
    case "YOUNG_FOR_MORTGAGE":
      return "بعض الجهات تشترط خدمة 12 شهراً فأكثر أو وظيفة ثابتة، وقد تطلب متضامناً.";
    case "ENDS_AFTER_RETIREMENT":
      return `ينتهي التمويل وعمره ${ltr(c.params.ageAtEnd)} سنة. منتجات قرب التقاعد تشترط غالباً خدمة 20 سنة للمدني و17 للعسكري و25 في التأمينات، ويُحسب الاستقطاع على المعاش.`;
    case "STEP_DOWN":
      return `يتقاعد بعد ${months(c.params.months)}، والمعاش المتوقع ${money(c.params.pension)}، فينزل القسط بعدها إلى ${money(c.params.installmentAfter)}. الجهة تحسب ما بعد التقاعد على المعاش، فيقل المبلغ عن حسبة الراتب وحده.`;
    case "RESIDENT":
      return "تُطلب إقامة وعقد عمل يغطيان مدة التمويل أو تعهد من جهة العمل، وقد تطلب الجهة كفيلاً أو تحويل مكافأة نهاية الخدمة.";
    case "RESIDENT_MORTGAGE":
      return `جهات قليلة تقدمه، بنسبة تمويل أقل، ${percent(70)} أو دونها غالباً، وتملّك غير السعودي يحتاج موافقة نظامية.`;
    case "EMPLOYER_NOT_LISTED":
      return "البنوك تعمل بقوائم شركات معتمدة. غير المصنفة تُرفض أو تأخذ نسبة أعلى ومبلغاً أقل، وتُطلب خدمة 12 شهراً واشتراك تأمينات منتظم.";
    case "SHORT_SERVICE":
      return `مدة الخدمة ${months(c.params.months)}. فترة التجربة قد تصل 180 يوماً، وجهات كثيرة تشترط 3 إلى 12 شهراً عند جهة العمل نفسها.`;
    case "GOSI_MATCH":
      return "تقارن الجهة تعريف الراتب ببرنت التأمينات وكشف الحساب، وأي فرق ينزل بالدخل المعتمد إلى الأقل.";
    case "ALLOWANCES":
      return `الأساسي ${money(c.params.basic)} من إجمالي ${money(c.params.total)}. بعض الجهات لا تحتسب بدل السكن السنوي ولا البدلات غير الثابتة، فينزل الدخل المعتمد.`;
    case "SELF_EMPLOYED":
      return "يُطلب سجل تجاري عمره سنتان فأكثر، وقوائم مالية مدققة، وشهادة زكاة، وكشف حساب 12 شهراً. الدخل المعتمد صافي الربح لا الإيرادات.";
    case "MILITARY":
      return "لبعض الجهات منتجات لجهات عسكرية بعينها بنسب أفضل، وقد تطلب تعريفاً بالرتبة وموافقة على الاستقطاع. سن التقاعد قد يكون أبكر بحسب الرتبة.";
    case "RETIRED":
      return "الاستقطاع ربع المعاش، وأقصى عمر عند آخر قسط 70 إلى 75 غالباً، ويُطلب تعريف بالمعاش وكشف حساب.";
    case "RECORD_LATE":
      return "أغلب البنوك تشترط 6 إلى 12 شهراً من الانتظام بعد آخر تأخير، وقد تطلب خطاباً يفسره.";
    case "RECORD_DEFAULT":
      return "يمنع القبول لدى أغلب الجهات حتى السداد والمخالصة وتحديث السجل. التحديث قد يأخذ 30 يوماً.";
    case "RECORD_UNKNOWN":
      return "قد يحمل التقرير التزامات لم تُذكر: بطاقات، أو تقسيط اتصالات، أو تعثراً قديماً، وأي منها يغيّر الحسبة.";
    case "TRANSFER_LOCK": {
      const name = bankShortName(c.params.bank);
      const from = name === c.params.bank ? "بنكه الحالي" : name;
      return `نقل الراتب من ${from} يتطلب غالباً سداد القرض القائم أو شراء المديونية من الجهة الجديدة، مع خطاب إخلاء طرف.${c.params.sameBank ? " والالتزام مسجل عند بنك الراتب نفسه." : ""}`;
    }
    case "CARDS":
      return "تحتسب بعض الجهات البطاقة في الاستقطاع بنسبة من حدّها، ولو كان رصيدها صفراً.";
    case "TOP_UP":
      return "بنك الراتب يقدّم غالباً تمويلاً إضافياً يدمج القرض القائم ويعطي صافي نقد، دون نقل الراتب.";
    case "SECOND_HOME":
      return `الحد النظامي لتمويل المسكن الثاني ${percent(SAMA.ltvSecondHome)} من القيمة، فالدفعة الأولى ${percent(100 - SAMA.ltvSecondHome)}.`;
    case "HOUSING_SUPPORT":
      return `المستفيد من الدعم السكني يرتفع سقف استقطاعه إلى ${percent(SAMA.totalCapLowHousing * 100)} ما دام دخله ${money(SAMA.lowBracket)} أو أقل، ويتحمل الصندوق جزءاً من الأرباح.`;
    case "VALUATION":
      return "يُموَّل الأقل من السعر والتقييم المعتمد. تُطلب صكوك إلكترونية، وقد تُرفض المباني القديمة جداً أو غير المكتملة، والبيع على الخارطة يحتاج ترخيص وافي.";
    case "CAR_COSTS":
      return "التأمين الشامل إلزامي كل سنة، يُضاف إلى القسط أو يُدفع سنوياً، وقد توجد دفعة أولى ودفعة أخيرة.";
    case "CARD_LIMIT":
      return "الحد ضعفا الراتب إلى ثلاثة أضعافه غالباً، ويدخل في نسبة الاستقطاع.";
    case "LIVING_COSTS":
      return "ساما تلزم الجهات بمراعاة المصاريف الأساسية. مع دخل منخفض وعدد معالين كبير قد تنزل الجهة بالمبلغ عن الحد النظامي.";
    case "ONE_AT_A_TIME":
      return "كل طلب يسجّل استعلاماً في سمة، والاستعلامات الكثيرة في مدة قصيرة تُقرأ علامة خطر، وقد ترفض بسببها جهات لاحقة.";
  }
}

const CONDITION_EXIT: Record<ConditionCode, string | null> = {
  MEDICAL: `جهّز تقريراً طبياً حديثاً، أو قصّر المدة لتنتهي قبل سن ${ltr(MEDICAL_AGE_AT_END)}، أو أضف متضامناً أصغر سناً.`,
  YOUNG_FOR_MORTGAGE: "ابدأ ببنك الراتب، وأرفق ما يثبت الاستقرار: عقد دائم أو قرار تثبيت.",
  ENDS_AFTER_RETIREMENT: `قصّر المدة لتنتهي قبل سن ${ltr(SAMA.retirementAge)}، أو اطلب منتج قرب التقاعد من بنك الراتب.`,
  STEP_DOWN: "أضف دخل متضامن، أو ارفع الدفعة الأولى، أو اختر جهة تقبل عمر 70 إلى 75 عند آخر قسط.",
  RESIDENT: "خطاب تعهد من جهة العمل بتحويل الراتب والمستحقات، ومدة لا تتجاوز العقد.",
  RESIDENT_MORTGAGE: `دفعة أولى ${percent(30)} فأكثر، وابدأ بجهة لها برنامج للمقيمين.`,
  EMPLOYER_NOT_LISTED: "اطلب تصنيف الشركة لدى الجهة بخطاب وسجل تجاري وعدد الموظفين، أو ابدأ بشركات التمويل.",
  SHORT_SERVICE: "أرفق برنت التأمينات كاملاً لإثبات خدمة سابقة متصلة. بعض الجهات تضمها إن لم يكن هناك انقطاع.",
  GOSI_MATCH: "تأكد قبل التقديم أن الراتب المسجل في التأمينات يطابق التعريف.",
  ALLOWANCES: "تعريف راتب يوضح أن البدلات شهرية ثابتة، والتقديم لجهات تعتمد الإجمالي.",
  SELF_EMPLOYED: "رتّب القوائم والكشوف قبل التقديم، وابدأ بجهات تمويل المنشآت أو شركات التمويل.",
  MILITARY: "تأكد من سن التقاعد المتوقع للرتبة، وعدّل المدة عليه.",
  RETIRED: null,
  RECORD_LATE: "سدّد المتأخر الآن، واطلب تحديث سمة، وقدّم لجهة تقبل التأخر البسيط.",
  RECORD_DEFAULT: "سدّد المديونية، واستخرج المخالصة، ثم أعد الدراسة بعد ظهور التحديث.",
  RECORD_UNKNOWN: "استخرج تقرير سمة قبل أي وعد للعميل.",
  TRANSFER_LOCK: "اطلب من الجهة الجديدة شراء المديونية ضمن عرضها، أو ابدأ بإعادة التمويل عند بنك الراتب.",
  CARDS: "إلغاء البطاقات غير المستخدمة أو تخفيض حدّها قبل التقديم يرفع القسط المتاح.",
  TOP_UP: null,
  SECOND_HOME: "جهّز الدفعة، أو اختر عقاراً أقل قيمة.",
  HOUSING_SUPPORT: "التحقق من الاستحقاق في منصة سكني قبل التقديم قد يرفع المبلغ كثيراً.",
  VALUATION: "اطلب تقييماً مبدئياً قبل دفع العربون.",
  CAR_COSTS: "قارن التكلفة كاملة لا القسط وحده.",
  CARD_LIMIT: null,
  LIVING_COSTS: null,
  ONE_AT_A_TIME: "قدّم بالتتابع، بحسب ترتيب المطابقة.",
};

/** What to do about a condition, when there is something to do. */
export const conditionExit = (condition: Condition): string | null => CONDITION_EXIT[condition.code];

export const CONDITION_CODES = Object.keys(CONDITION_TITLE) as ConditionCode[];

/** The obligation a lender would buy out, when it carries no lender's name. */
const DEBT: Record<Obligation["kind"], string> = {
  personal: "التمويل الشخصي",
  mortgage: "التمويل العقاري",
  auto: "تمويل السيارة",
  card: "البطاقة",
  other: "التزام آخر",
};

/** A way to a larger amount in a few words. */
export function wayTitle(way: WayOut): string {
  switch (way.code) {
    case "SETTLE":
      if (way.params.kind === "card") return way.params.lender ? `سداد بطاقة ${way.params.lender} وإلغاؤها` : "سداد البطاقة وإلغاؤها";
      return `شراء مديونية ${way.params.lender ?? DEBT[way.params.kind]}`;
    case "CONSOLIDATE":
      return "دمج كل الأقساط عند جهة واحدة";
    case "LONGER_TENOR":
      return "أطول مدة تسمح بها الجهة";
    case "CO_BORROWER":
      return way.params.covers != null ? `متضامن دخله ${money(way.params.income)} تقريباً` : "إضافة متضامن";
    case "HOUSING_SUPPORT":
      return "التسجيل في الدعم السكني";
    case "CLEAR_RECORD":
      return "تسوية سمة ثم إعادة التقديم";
    case "END_AT_RETIREMENT":
      return "مدة تنتهي عند التقاعد";
  }
}

/** What the way does, with its numbers. */
export function wayDetail(way: WayOut): string {
  switch (way.code) {
    case "SETTLE": {
      const { monthly, remaining, net } = way.params;
      const frees = `يحرر ${money(monthly)} من القسط الشهري.`;
      if (!remaining || net == null) return frees;
      return net >= 0
        ? `${frees} المتبقي ${money(remaining)}، وصافي النقد بعد سداده ${money(net)}.`
        : `${frees} المتبقي ${money(remaining)}، وهو أكثر مما يعطيه التمويل الجديد بمبلغ ${money(-net)}.`;
    }
    case "CONSOLIDATE":
      return way.params.remaining ? `جهة واحدة تشتري كل المديونيات، ومجموعها ${money(way.params.remaining)}، بقسط واحد ومدة أطول.` : "جهة واحدة تشتري كل المديونيات بقسط واحد ومدة أطول.";
    case "LONGER_TENOR":
      return `المدة المطلوبة ${months(way.params.tenor)}. المدة الأطول تنزل بالقسط وترفع المبلغ، وتزيد كلفة الأرباح.`;
    case "CO_BORROWER":
      return way.params.covers != null
        ? `هذا أقل دخل لمتضامن يغطي المطلوب، وهو ${money(way.params.covers)}.`
        : `مثال بمتضامن دخله ${money(way.params.income)}. يُقبل في العقاري لدى أغلب البنوك.`;
    case "HOUSING_SUPPORT":
      return `يرفع السقف الكلي إلى ${percent(SAMA.totalCapLowHousing * 100)} للدخل حتى ${money(SAMA.lowBracket)}، والصندوق يدعم الأرباح.`;
    case "CLEAR_RECORD":
      return "هذا أثر السجل النظيف. التحديث يحتاج سداداً ومخالصة وقد يأخذ 30 يوماً، وبعض الجهات تشترط مدة انتظام بعده.";
    case "END_AT_RETIREMENT":
      return `تمويل على ${months(way.params.months)} بقسط ثابت ${money(way.params.installment)}، لا ينزل بعد التقاعد ولا يدخل في اشتراطات المعاش.`;
  }
}

const WAY_STEPS: Record<WayOutCode, string[]> = {
  SETTLE: ["اطلب خطاب مديونية محدثاً.", "اشترط شراء المديونية ضمن عرض الجهة الجديدة.", "استلم خطاب إخلاء الطرف ثم انقل الراتب."],
  CONSOLIDATE: ["اجمع خطابات المديونية لكل الالتزامات.", "اطلب عرض شراء مديونية مجمّعاً.", "السداد مباشرة من الجهة الجديدة."],
  LONGER_TENOR: ["عدّل المدة في الطلب."],
  CO_BORROWER: ["تعريف راتب وكشف حساب للمتضامن.", "سجل المتضامن في سمة نظيف.", "إضافته في عقد التمويل."],
  HOUSING_SUPPORT: ["تحقق من الاستحقاق في منصة سكني.", "استخرج شهادة الاستحقاق.", "اختر منتجاً مدعوماً."],
  CLEAR_RECORD: ["سدّد المتأخر أو المتعثر.", "استخرج خطاب المخالصة.", "اطلب تحديث سمة.", "أعد الدراسة."],
  END_AT_RETIREMENT: ["عدّل المدة في الطلب."],
};
const CARD_STEPS = ["سدّد الرصيد.", "اطلب إلغاء البطاقة وخطاب الإغلاق.", "انتظر تحديث سمة."];

/** The steps of a way out, in order. */
export const waySteps = (way: WayOut): string[] => (way.code === "SETTLE" && way.params.kind === "card" ? CARD_STEPS : WAY_STEPS[way.code]);

export const WAY_OUT_CODES = Object.keys(WAY_STEPS) as WayOutCode[];
