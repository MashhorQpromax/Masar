// البيانات الأساسية للمنصة: الجهات والمنتجات وقواعد السوق العامة.
// المعايير تقديرية من المصادر العامة — تُحدَّث من صفحة "الجهات والمنتجات" حسب سياسة كل جهة الفعلية.
import type { FinanceType } from "./engine.ts";


const ALL_SALARIED = ["gov", "military", "semi_gov", "private_approved", "retired"];
const WIDE = [...ALL_SALARIED, "private"];
export const LENDERS: [string, "bank" | "finance_company", string | null][] = [
  ["مصرف الراجحي", "bank", "rajhi"],
  ["البنك الأهلي السعودي", "bank", "snb"],
  ["بنك الرياض", "bank", "riyad"],
  ["مصرف الإنماء", "bank", "alinma"],
  ["بنك البلاد", "bank", "albilad"],
  ["البنك السعودي للاستثمار", "bank", "saib"],
  ["إمكان للتمويل", "finance_company", null],
  ["النايفات للتمويل", "finance_company", null],
  ["دار التمليك", "finance_company", null],
  ["عبداللطيف جميل للتمويل", "finance_company", null],
];

export type BaseProduct = {
  l: string; t: FinanceType; n: string; minSal: number; maxAge: number; svc: number; sectors: string[]; tenor: number;
  max: number; rate: number; rt?: "flat" | "reducing"; transfer?: boolean; late?: boolean; ltv?: number; nat?: string[]; minAge?: number;
};
export const PRODUCTS: BaseProduct[] = [
  { l: "مصرف الراجحي", t: "personal", n: "التمويل الشخصي", minSal: 4000, maxAge: 65, svc: 3, sectors: ALL_SALARIED, tenor: 60, max: 2_000_000, rate: 3.4 },
  { l: "البنك الأهلي السعودي", t: "personal", n: "التمويل الشخصي", minSal: 5000, maxAge: 65, svc: 3, sectors: ALL_SALARIED, tenor: 60, max: 2_500_000, rate: 3.2 },
  { l: "بنك الرياض", t: "personal", n: "التمويل الشخصي", minSal: 5000, maxAge: 65, svc: 6, sectors: ALL_SALARIED, tenor: 60, max: 1_500_000, rate: 3.6 },
  { l: "مصرف الإنماء", t: "personal", n: "التمويل الشخصي", minSal: 4000, maxAge: 65, svc: 3, sectors: ALL_SALARIED, tenor: 60, max: 1_500_000, rate: 3.5 },
  { l: "بنك البلاد", t: "personal", n: "تمويل البلاد الشخصي", minSal: 3000, maxAge: 65, svc: 3, sectors: WIDE, tenor: 60, max: 1_000_000, rate: 3.9 },
  { l: "إمكان للتمويل", t: "personal", n: "تمويل نقدي", minSal: 3000, maxAge: 65, svc: 3, sectors: WIDE, tenor: 60, max: 250_000, rate: 6.5, transfer: false, late: true },
  { l: "النايفات للتمويل", t: "personal", n: "تمويل شخصي", minSal: 3000, maxAge: 65, svc: 6, sectors: WIDE, tenor: 60, max: 300_000, rate: 7.5, transfer: false, late: true, nat: ["saudi", "non_saudi"] },
  { l: "مصرف الراجحي", t: "mortgage", n: "التمويل العقاري", minSal: 5000, maxAge: 70, svc: 3, sectors: ALL_SALARIED, tenor: 300, max: 5_000_000, rate: 5.2, rt: "reducing", ltv: 90 },
  { l: "البنك الأهلي السعودي", t: "mortgage", n: "التمويل العقاري", minSal: 6000, maxAge: 70, svc: 6, sectors: ALL_SALARIED, tenor: 300, max: 5_000_000, rate: 5.0, rt: "reducing", ltv: 90 },
  { l: "البنك السعودي للاستثمار", t: "mortgage", n: "سكني المدعوم — وحدة جاهزة", minSal: 4000, maxAge: 75, svc: 3, sectors: ALL_SALARIED, tenor: 300, max: 7_000_000, rate: 4.9, rt: "reducing", ltv: 90 },
  { l: "دار التمليك", t: "mortgage", n: "تمويل المسكن", minSal: 5000, maxAge: 70, svc: 6, sectors: WIDE, tenor: 300, max: 3_000_000, rate: 6.4, rt: "reducing", ltv: 85, transfer: false },
  { l: "مصرف الراجحي", t: "auto", n: "التأجير التمويلي للسيارات", minSal: 4000, maxAge: 65, svc: 3, sectors: ALL_SALARIED, tenor: 60, max: 400_000, rate: 4.2 },
  { l: "عبداللطيف جميل للتمويل", t: "auto", n: "تأجير السيارات", minSal: 3000, maxAge: 65, svc: 3, sectors: WIDE, tenor: 60, max: 400_000, rate: 5.5, transfer: false, late: true, nat: ["saudi", "non_saudi"] },
  { l: "بنك البلاد", t: "sme", n: "تمويل المنشآت الصغيرة", minSal: 0, maxAge: 70, svc: 24, sectors: ["self"], tenor: 60, max: 2_000_000, rate: 6.0, transfer: false },
];

/** [الجهة أو null للعامة، نوع التمويل، النوع، العنوان، التفاصيل] */
export const RULES: [string | null, string | null, "condition" | "exception" | "tip" | "warning", string, string][] = [
  [null, "mortgage", "tip", "اطلب تقييماً مبدئياً قبل العربون", "التمويل يُحسب على الأقل من السعر والتقييم؛ فرق التقييم يدفعه العميل نقداً."],
  [null, "personal", "tip", "التمويل الإضافي لدى بنك الراتب", "إن كان على العميل قرض قائم، بنك الراتب يعطي غالباً تمويلاً إضافياً دون نقل الراتب أو شراء مديونية."],
  ["مصرف الراجحي", "personal", "condition", "منتج قرب التقاعد", "خدمة 20 سنة مدني / 17 عسكري / 25 تأمينات، وحتى 60 للموظف و75 للمتقاعد عند آخر قسط (من موقع الجهة — للتحقق)."],
  ["البنك السعودي للاستثمار", "mortgage", "exception", "لا فحص طبي حتى 2.5 مليون", "التكافل على الحياة مجاني ودون فحص طبي للتمويل حتى 2,500,000 في منتج سكني المدعوم (من موقع الجهة — للتحقق)."],
  ["إمكان للتمويل", "personal", "exception", "يقبل تأخراً بسيطاً في سمة", "مع خطاب تسوية ومرور 3 أشهر انتظام (تجريبي — للتحقق)."],
  [null, null, "warning", "التعثر لدى شركة تمويل أثقل من التعثر لدى بنك", "البنوك تنظر لتعثر شركات التمويل (إمكان، النايفات...) كمؤشر مخاطر أعلى؛ غالباً لا تقبل العميل إلا بعد سداده ومرور فترة أطول (تقديرياً سنتان). سدّد التعثر أولاً واحصل على خطاب مخالصة وتحديث سمة."],
  [null, null, "warning", "الإيقاف الخدمي أو الحكم التنفيذي يغلق كل الجهات", "أي إيقاف خدمات أو قرار تنفيذ (ناجز/محكمة التنفيذ) يمنع التمويل حتى يُرفع ويظهر الرفع في سمة."],
  [null, "personal", "tip", "كثرة الاستعلامات تضر", "أكثر من 3–4 استعلامات في 6 أشهر تجعل البنك يتردد. لا تقدّم لعدة جهات في نفس الوقت؛ ابدأ بالأنسب."],
];
