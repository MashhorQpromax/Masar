/**
 * The wording of a project's study: a hotel, a residential or a commercial building that asks for
 * finance against its land and its income. The study returns codes and numbers; this file turns them
 * into Arabic, and says each number the way it was worked out.
 */
import {
  CASH_LTV_LIMIT,
  DEBT_RATE,
  DEBT_YEARS,
  FUND_MIN,
  HOTEL_MARGIN,
  HOTEL_OTHER_REVENUE,
  MIN_DSCR,
  roomRevenue,
  WEAK_LTV,
  yearlyDebtService,
  type AlertLevel,
  type BorrowerType,
  type Deed,
  type Fit,
  type GapCode,
  type ProjectAlert,
  type ProjectFacts,
  type ProjectStudy,
  type ProjectType,
  type ProjectVerdict,
  type Purpose,
  type StructureId,
} from "@/domain/project";
import { counted, ltr, millions, money, months, percent, type CountForms } from "./format";

export const PROJECT_TYPE: Record<ProjectType, string> = {
  hotel: "فندق",
  residential: "سكني",
  commercial: "تجاري",
  mixed: "متعدد الاستخدام",
};

export const BORROWER_TYPE: Record<BorrowerType, string> = {
  individual: "فرد",
  company: "شركة",
};

/** How the land is held, in the few words a choice has room for. */
export const DEED: Record<Deed, string> = {
  registered: "في السجل العقاري",
  electronic: "إلكتروني",
  paper: "ورقي",
};

export const PURPOSE: Record<Purpose, string> = {
  build: "بناء",
  cashout: "سيولة",
  build_cashout: "بناء وسيولة",
};

export const FIT: Record<Fit, string> = {
  high: "الأنسب",
  medium: "ممكن",
  low: "ضعيف",
};

export const ALERT_LEVEL: Record<AlertLevel, string> = {
  block: "مانع",
  warn: "تنبيه",
  info: "للعلم",
};

/** The study's answer in a few words. */
export const PROJECT_VERDICT: Record<ProjectVerdict, string> = {
  needs_info: "تنقصه أوراق قبل الحكم",
  feasible_restructure: "ممكن بعد ترتيب الطلب",
  feasible: "ممكن بالهيكل المقترح",
  weak: "ضعيف بصيغته الحالية",
};

/** The same, short enough for a row in a list. */
export const PROJECT_VERDICT_SHORT: Record<ProjectVerdict, string> = {
  needs_info: "تنقصه أوراق",
  feasible_restructure: "ممكن بترتيب",
  feasible: "ممكن",
  weak: "ضعيف",
};

const BASICS: CountForms = { one: "أمر أساسي واحد", two: "أمران أساسيان", few: "أمور أساسية", many: "أمراً أساسياً" };

/** How many of the file's gaps hold the verdict back. */
export const criticalGaps = (study: Pick<ProjectStudy, "gaps">): number => study.gaps.filter((gap) => gap.critical).length;

/** What the answer means and what to do about it, in a sentence or two. */
export function verdictSay(study: Pick<ProjectStudy, "verdict" | "gaps">): string {
  switch (study.verdict) {
    case "needs_info":
      return `الملف قابل للدراسة، وينقصه ${counted(criticalGaps(study), BASICS)}. لا يُحكم عليه قبل اكتمالها.`;
    case "feasible_restructure":
      return "يُقبل إذا قُسم الطلب: تمويل بناء يُصرف على مراحل، وسيولة محدودة بضمان الأرض.";
    case "feasible":
      return "الطلب في حدود ما تموله الجهات لمشروع مثله.";
    case "weak":
      return `المطلوب فوق ${percent(WEAK_LTV)} من قيمة الأرض، ولا تموله جهة بهذه الصيغة. يحتاج رأس مال من المالك أو شريكاً.`;
  }
}

/** Where the request stands against the land's value, said under the line that shows it. */
export function reachSay(ltv: number): string {
  if (ltv > WEAK_LTV) return `فوق ${percent(WEAK_LTV)} من قيمة الأرض، وهذا أعلى مما تموله الجهات.`;
  if (ltv > CASH_LTV_LIMIT) return `فوق ${percent(CASH_LTV_LIMIT)}، فلا يُعطى كله سيولة بضمان الأرض. يبقى ممكناً إذا رُبط جزء منه بالبناء.`;
  return `في حدود ${percent(CASH_LTV_LIMIT)} من قيمة الأرض، وهو ما تقبله الجهات بضمانها.`;
}

/** How the land is held, as a fact on the file. */
export const DEED_FACT: Record<Deed, string> = {
  registered: "مسجل في السجل العقاري",
  electronic: "صك إلكتروني",
  paper: "صك ورقي",
};

/** What the money is for, as a fact on the file. */
export const PURPOSE_FACT: Record<Purpose, string> = {
  build: "بناء",
  cashout: "سيولة بضمان الأرض",
  build_cashout: "بناء وسيولة",
};

/** A project in a line: "فندق في أبحر الشمالية، جدة". Empty when neither is known. */
export function projectLine(facts: Pick<ProjectFacts, "projectType" | "city" | "district">): string {
  const where = [facts.district, facts.city].filter(Boolean).join("، ");
  const what = facts.projectType ? (facts.projectType === "hotel" ? PROJECT_TYPE.hotel : `مشروع ${PROJECT_TYPE[facts.projectType]}`) : where ? "مشروع" : "";
  return [what, where && `في ${where}`].filter(Boolean).join(" ");
}

/** An alert in a few words, with its own number when it has one. */
export function alertTitle(alert: ProjectAlert): string {
  switch (alert.code) {
    case "DEED_UNREGISTERED":
      return alert.deed == null ? "نوع الصك غير محدد" : "الصك ليس في السجل العقاري";
    case "NEAR_HARAM":
      return "في المنطقة المركزية قرب الحرم";
    case "INDIVIDUAL_BORROWER":
      return alert.known ? "المقترض فرد" : "صفة المقترض غير محددة";
    case "HIGH_LAND_PRICE":
      return `سعر المتر ${money(alert.pricePerM2)} ريال`;
    case "CASH_ABOVE_LAND_LIMIT":
      return `المطلوب ${percent(alert.ltv)} من قيمة الأرض`;
    case "ABOVE_BUILD_COST":
      return `${millions(alert.amount)} من الطلب فوق تكلفة البناء`;
    case "EXISTING_LIEN":
      return "الأرض مرهونة";
    case "LOW_COVER":
      return `دخل الفندق يغطي قسط السنة ${ltr(alert.dscr)} مرة`;
  }
}

/** Why the alert matters to a lender. */
export function alertDetail(alert: ProjectAlert): string {
  switch (alert.code) {
    case "DEED_UNREGISTERED":
      return "البنوك ترهن عن طريق السجل العقاري. أرض بلا رقم عقار فيه يتأخر رهنها، ويتعذر في الأحياء التي بدأ فيها التسجيل.";
    case "NEAR_HARAM":
      return "تحقق أن القطعة خارج مشاريع نزع الملكية والتطوير، ومن اشتراطات الارتفاع والاستخدام فيها. وللتملك في مكة المكرمة والمدينة المنورة قيود على غير السعودي.";
    case "INDIVIDUAL_BORROWER":
      return "تمويل التطوير والفنادق يُعطى عادة لمنشأة لها سجل تجاري وقوائم مالية. وقد يُقبل فرد يملك أصلاً قوياً إذا أسس منشأة للمشروع وكفلها.";
    case "HIGH_LAND_PRICE":
      return "البنك يقيّم الأرض بمقيّمَين من قائمته ويأخذ الأقل. تقييم مرتفع كهذا قد ينزل كثيراً، فتنزل معه نسبة التمويل.";
    case "CASH_ABOVE_LAND_LIMIT":
      return `السيولة بضمان أرض خام لا تتجاوز عادة ${percent(40)} إلى ${percent(CASH_LTV_LIMIT)} من تقييم البنك. وما زاد على تكلفة البناء يحتاج مبرراً ومصدر سداد واضحاً.`;
    case "ABOVE_BUILD_COST":
      return "البنك يسأل أين يذهب هذا المبلغ. حدد غرضه: سداد التزامات، أو تجهيز وتشغيل، أو احتياطي.";
    case "EXISTING_LIEN":
      return "يُفك الرهن قبل التمويل، أو تسدده الجهة الجديدة للمرتهن من مبلغ التمويل.";
    case "LOW_COVER":
      return `البنوك تطلب عادة أن يغطي الدخل قسط السنة ${ltr(MIN_DSCR)} مرة فأكثر.`;
  }
}

/** The way out of an alert. Every alert has one. */
export function alertExit(alert: ProjectAlert): string {
  switch (alert.code) {
    case "DEED_UNREGISTERED":
      return "سجّل العقار في السجل العقاري، أو حدّث الصك، قبل التقديم.";
    case "NEAR_HARAM":
      return "اطلب خطاباً من الأمانة أو هيئة تطوير المنطقة بحالة القطعة واشتراطات البناء.";
    case "INDIVIDUAL_BORROWER":
      return "أسس شركة للمشروع تدخل فيها الأرض حصة عينية، ويكفلها المالك.";
    case "HIGH_LAND_PRICE":
      return "اطلب تقييماً ثانياً من مقيّم معتمد لدى البنك المستهدف قبل أن تعد العميل بمبلغ.";
    case "CASH_ABOVE_LAND_LIMIT":
      return "اقسم الطلب: تمويل بناء يُصرف على مراحل، وسيولة محدودة بضمان الأرض.";
    case "ABOVE_BUILD_COST":
      return "جهّز خطة موقعة تبين مصادر المال وأوجه صرفه.";
    case "EXISTING_LIEN":
      return "اطلب من المرتهن خطاباً بمبلغ السداد.";
    case "LOW_COVER":
      return "اخفض المبلغ، أو أطل المدة، أو زد رأس المال.";
  }
}

const GAP: Record<GapCode, { label: string; why: string }> = {
  BORROWER_TYPE: { label: "صفة المقترض: فرد أم شركة بسجل تجاري", why: "تحدد الجهات والمنتج." },
  DEED_COPY: { label: "صورة الصك وما يثبت رقم العقار في السجل العقاري", why: "شرط للرهن." },
  BUILD_COST: { label: "تكلفة البناء التقديرية من مكتب هندسي", why: "عليها يُبنى تمويل البناء." },
  BUILT_AREA: { label: "مسطحات البناء المسموحة وعدد الأدوار حسب اشتراطات الأمانة", why: "تحدد حجم المشروع وقيمته." },
  ROOMS: { label: "عدد غرف الفندق المخطط", why: "عليه يُحسب دخل الفندق." },
  FEASIBILITY: { label: "دراسة جدوى من مكتب معتمد", why: "تطلبها كل الجهات للمشاريع." },
  PERMIT: { label: "رخصة البناء أو خطاب اشتراطات البناء", why: "لا يُصرف تمويل بناء بلا رخصة." },
  VALUATION_REPORT: { label: "تقرير التقييم كاملاً: اسم المقيّم ورقم ترخيصه وتاريخ التقييم", why: "البنك يعيد التقييم، ويحتاج هذا للموافقة المبدئية." },
  STATEMENTS: { label: `كشف حساب ${months(12)}، والقوائم المالية إن كان المقترض شركة`, why: "تبين الملاءة والسيولة." },
  CREDIT_REPORT: { label: "تقرير سمة للمالك، وسمة التجارية للشركة", why: "شرط عند كل جهة." },
  OWNER_CASH: { label: "ما يضعه المالك من سيولة في المشروع", why: `البنوك تطلب غالباً مساهمة نقدية من ${percent(20)} إلى ${percent(30)} من تكلفة البناء.` },
  USE_OF_FUNDS: { label: "خطة صرف المبلغ: مصادر المال وأوجه صرفه", why: "تبرر المبلغ المطلوب أمام تكلفة البناء." },
  OPERATOR_LETTER: { label: "خطاب نوايا من مشغل فندقي، أو عقد تأجير مسبق", why: "يرفع قبول البنك وصندوق التنمية السياحي كثيراً." },
  NO_EXPROPRIATION: { label: "إفادة من الأمانة أن القطعة خارج نزع الملكية ومشاريع التطوير", why: "تحمي الضمان." },
};

/** Where the papers of a gap stand, said beside it. A gap whose papers are still owed says nothing: it is on the list because of that. */
export const GAP_STANDING: Record<"received" | "rejected", string> = {
  received: "وصل وينتظر المراجعة",
  rejected: "أُعيد وينتظر نسخة سليمة",
};

/** Over the gaps the file answers with checked papers. */
export const HELD_SAY = "ثبت بمستند تحققنا منه";

/** On the papers page: what checking a paper does to the study. */
export const PAPERS_CLOSE_GAPS = "المستند الذي تتحقق منه يُغلق ما يقابله في نواقص الدراسة.";

/** What a rejected project file says where its study would speak. */
export const REJECTED_PROJECT = "الملف مرفوض";
export const REJECTED_PROJECT_SAY = "الدراسة والمستندات محفوظة كما كانت. لا يُعدَّل شيء حتى يُعاد فتح الملف.";

/** A paper or a fact the file still needs. */
export const gapLabel = (code: GapCode): string => GAP[code].label;
/** Why a lender asks for it. */
export const gapWhy = (code: GapCode): string => GAP[code].why;

interface StructureWording {
  title: string;
  how: string;
  needs: string[];
  /** Who to take it to. Kinds of lender and well-known names, never a promise that one accepts. */
  ask: string[];
}

const STRUCTURE: Record<StructureId, StructureWording> = {
  dev: {
    title: "تمويل تطوير من بنك",
    how: `البنك يمول ${percent(60)} إلى ${percent(70)} من تكلفة المشروع كلها، الأرض والبناء، وتُحسب الأرض حصة المالك. يُصرف على دفعات مع تقدم البناء بإشراف استشاري، وبفترة سماح حتى يكتمل، ثم يُسدد من دخل المشروع.`,
    needs: ["شركة للمشروع بسجل تجاري", "رخصة بناء", "دراسة جدوى", "مقاول مصنف وعقد مقاولة", "تقييم من مقيّمي البنك", "رهن الأرض والمشروع"],
    ask: ["مصرف الراجحي", "البنك الأهلي السعودي", "بنك الرياض", "مصرف الإنماء", "البنك السعودي الفرنسي", "بنك البلاد"],
  },
  tdf: {
    title: "صندوق التنمية السياحي مع بنك",
    how: "الصندوق يمول مشاريع الضيافة مباشرة أو مشاركة مع بنك، بشروط أيسر وفترة سماح أطول. النسب والسقوف تؤخذ من الصندوق نفسه.",
    needs: ["دراسة جدوى سياحية", "مشغل أو علامة فندقية", "ترخيص من وزارة السياحة", "مساهمة المالك: الأرض وسيولة"],
    ask: ["صندوق التنمية السياحي", "بنك يشاركه التمويل"],
  },
  cashout: {
    title: "سيولة بضمان الأرض",
    how: `تُرهن الأرض مقابل سيولة تقارب ${percent(40)} إلى ${percent(CASH_LTV_LIMIT)} من تقييم البنك، لا من تقييم العميل. تناسب جزء السيولة من الطلب، وتحتاج مصدر سداد واضحاً: دخلاً آخر أو بيعاً.`,
    needs: ["صك مسجل", "تقييم البنك", "مصدر سداد مثبت", "ضمانات شخصية"],
    ask: ["قطاع الشركات في البنوك", "شركات التمويل العقاري، بنسب أقل وتكلفة أعلى"],
  },
  jv: {
    title: "شراكة مع مطوّر",
    how: "المالك يقدم الأرض، والمطوّر يمول ويبني ويشغّل، ويتقاسمان الدخل أو الوحدات. لا دين على المالك، ويتنازل عن جزء من العائد.",
    needs: ["تقييم يتفق عليه الطرفان", "عقد شراكة محكم", "سجل أعمال المطوّر"],
    ask: ["مطوّرون عقاريون يعملون في مدينة المشروع", "شركات التشغيل الفندقي، إن كان فندقاً"],
  },
  fund: {
    title: "صندوق استثمار عقاري",
    how: `مدير صندوق مرخص من هيئة السوق المالية ينشئ صندوقاً خاصاً تدخل فيه الأرض حصة عينية، ويجمع باقي التكلفة من مستثمرين، ويقترض باسم الصندوق. يستحق ذلك من ${millions(FUND_MIN)} فأكثر.`,
    needs: ["مدير صندوق مرخص", "تقييمان معتمدان", "مشروع كبير الحجم"],
    ask: ["شركات إدارة الأصول المرخصة"],
  },
  prelease: {
    title: "تأجير مسبق لمشغل فندقي",
    how: "عقد تأجير طويل قبل البناء يجعل للمشروع دخلاً مضموناً. يُخصم العقد لدى البنك أو يُقدَّم ضماناً، فترتفع نسبة التمويل.",
    needs: ["عقد تأجير موثق", "ملاءة المستأجر"],
    ask: ["مشغلو الفنادق", "شركات الحج والعمرة، في مكة المكرمة والمدينة المنورة", "البنوك، بخصم الإيجارات"],
  },
};

export const structureTitle = (id: StructureId): string => STRUCTURE[id].title;
/** How the way works, in two or three sentences. */
export const structureHow = (id: StructureId): string => STRUCTURE[id].how;
/** What it asks of the owner. */
export const structureNeeds = (id: StructureId): string[] => STRUCTURE[id].needs;
/** Who to take it to. */
export const structureAsk = (id: StructureId): string[] => STRUCTURE[id].ask;

/** A ratio of the study with the sum it came from. */
export interface RatioLine {
  key: "ltv" | "ltc" | "equity";
  label: string;
  /** In percent. */
  value: number;
  /** The division behind it, said in words. */
  from: string;
}

/** The three shares a lender looks at first. One is left out while what it divides by is not known. */
export function ratioLines(facts: Pick<ProjectFacts, "landValue" | "equityCash">, study: Pick<ProjectStudy, "requested" | "ltv" | "ltc" | "equityPct" | "totalCost">): RatioLine[] {
  const lines: RatioLine[] = [];
  if (study.ltv != null && facts.landValue) lines.push({ key: "ltv", label: "المطلوب من قيمة الأرض", value: study.ltv, from: `${millions(study.requested)} من ${millions(facts.landValue)}` });
  if (study.ltc != null && study.totalCost) lines.push({ key: "ltc", label: "المطلوب من تكلفة المشروع", value: study.ltc, from: `${millions(study.requested)} من ${millions(study.totalCost)}، الأرض والبناء` });
  if (study.equityPct != null && study.totalCost) lines.push({ key: "equity", label: "حصة المالك من التكلفة", value: study.equityPct, from: facts.equityCash ? `الأرض و${millions(facts.equityCash)} سيولة` : "الأرض وحدها، بلا سيولة" });
  return lines;
}

/** One step of working out what a hotel earns against what its debt costs. */
export interface IncomeStep {
  label: string;
  /** How the figure was reached. */
  how: string;
  /** The figure with its unit: an amount, or the cover as a number of times. Safe inside a sentence. */
  value: string;
}

/**
 * A hotel's income against a year of its debt, one step at a time. Empty when the rooms, the price of
 * a night or the share of nights sold is not known.
 */
export function incomeSteps(facts: Pick<ProjectFacts, "projectType" | "keys" | "adr" | "occupancy">, study: Pick<ProjectStudy, "requested" | "noi" | "dscr">): IncomeStep[] {
  if (facts.projectType !== "hotel" || !facts.keys || !facts.adr || !facts.occupancy || study.noi == null) return [];
  const rooms = roomRevenue(facts.keys, facts.adr, facts.occupancy);
  const steps: IncomeStep[] = [
    { label: "إيراد الغرف في السنة", how: `${ltr(facts.keys)} غرفة، الليلة ${money(facts.adr)} ريال، والإشغال ${percent(facts.occupancy)} من ${ltr(365)} ليلة.`, value: millions(rooms) },
    { label: "مع المطاعم والخدمات", how: `تزيد ${percent(HOTEL_OTHER_REVENUE * 100)} على إيراد الغرف.`, value: millions(rooms * (1 + HOTEL_OTHER_REVENUE)) },
    { label: "يبقى بعد تكاليف التشغيل", how: `${percent(HOTEL_MARGIN * 100)} من الإيراد، تقدير لفنادق مثله.`, value: millions(study.noi) },
  ];
  if (study.dscr != null && study.requested > 0) {
    steps.push(
      { label: "قسط السنة على المبلغ المطلوب", how: `بهامش ${percent(DEBT_RATE * 100)} سنوياً على ${ltr(DEBT_YEARS)} سنوات بعد فترة السماح.`, value: millions(yearlyDebtService(study.requested)) },
      { label: "الدخل يغطي القسط", how: `البنوك تطلب ${ltr(MIN_DSCR)} مرة فأكثر.`, value: `${ltr(study.dscr)} مرة` },
    );
  }
  return steps;
}

const SAVE_ERROR: Record<string, (params: Record<string, string>) => string> = {
  INVALID_INPUT: () => "في المكتوب ما لا يصح. راجعه ثم احفظ.",
  NOT_FOUND: () => "لم يعد هذا الملف موجوداً.",
  NOT_A_PROJECT: () => "هذا الملف ليس ملف مشروع.",
  FILE_REJECTED: () => "الملف مرفوض. أعد فتحه من ملف المالك ثم عدّل.",
  BAD_PHONE: () => "رقم الجوال غير صحيح. اكتبه بعشرة أرقام تبدأ بـ 05، أو اتركه فارغاً.",
  PHONE_TAKEN: (p) => `هذا الجوال مسجل في الملف ${ltr(p.fileNo ?? "")}. افتح ذلك الملف بدل ملف جديد.`,
  FORBIDDEN: () => "لا تملك صلاحية هذا.",
};

/** Why a project was not saved. */
export const projectError = (code: string, params: Record<string, string> = {}): string => SAVE_ERROR[code]?.(params) ?? "تعذر الحفظ. حاول مرة أخرى.";

export const PROJECT_ERROR_CODES = Object.keys(SAVE_ERROR);
