import type { FinanceType, LenderType, Nationality, Sector } from "@/domain/eligibility";
import type { RateType } from "@/domain/finance";

/**
 * The catalogue a new database starts with: the lenders the company deals with, a product for each
 * kind of finance they offer, and what the market is known to do.
 *
 * The terms are indicative, gathered from public sources. Each product stays marked unconfirmed until
 * someone confirms it with the lender, and the screens say so wherever its numbers are shown.
 */
export const BASE_LENDERS: { name: string; type: LenderType; bankCode: string | null }[] = [
  { name: "مصرف الراجحي", type: "bank", bankCode: "rajhi" },
  { name: "البنك الأهلي السعودي", type: "bank", bankCode: "snb" },
  { name: "بنك الرياض", type: "bank", bankCode: "riyad" },
  { name: "مصرف الإنماء", type: "bank", bankCode: "alinma" },
  { name: "بنك البلاد", type: "bank", bankCode: "albilad" },
  { name: "البنك السعودي للاستثمار", type: "bank", bankCode: "saib" },
  { name: "إمكان للتمويل", type: "finance_company", bankCode: null },
  { name: "النايفات للتمويل", type: "finance_company", bankCode: null },
  { name: "دار التمليك", type: "finance_company", bankCode: null },
  { name: "عبداللطيف جميل للتمويل", type: "finance_company", bankCode: null },
];

const SALARIED: Sector[] = ["gov", "military", "semi_gov", "private_approved", "retired"];
const WIDE: Sector[] = [...SALARIED, "private"];
const ANYONE: Nationality[] = ["saudi", "non_saudi"];

export interface BaseProduct {
  lender: string;
  financeType: FinanceType;
  name: string;
  minSalary: number;
  minAge?: number;
  maxAgeAtMaturity: number;
  minServiceMonths: number;
  sectors: Sector[];
  nationalities?: Nationality[];
  maxTenor: number;
  maxAmount: number;
  rate: number;
  rateType?: RateType;
  requiresSalaryTransfer?: boolean;
  acceptsLateSimah?: boolean;
  maxLtv?: number;
}

export const BASE_PRODUCTS: BaseProduct[] = [
  { lender: "مصرف الراجحي", financeType: "personal", name: "التمويل الشخصي", minSalary: 4000, maxAgeAtMaturity: 65, minServiceMonths: 3, sectors: SALARIED, maxTenor: 60, maxAmount: 2_000_000, rate: 3.4 },
  { lender: "البنك الأهلي السعودي", financeType: "personal", name: "التمويل الشخصي", minSalary: 5000, maxAgeAtMaturity: 65, minServiceMonths: 3, sectors: SALARIED, maxTenor: 60, maxAmount: 2_500_000, rate: 3.2 },
  { lender: "بنك الرياض", financeType: "personal", name: "التمويل الشخصي", minSalary: 5000, maxAgeAtMaturity: 65, minServiceMonths: 6, sectors: SALARIED, maxTenor: 60, maxAmount: 1_500_000, rate: 3.6 },
  { lender: "مصرف الإنماء", financeType: "personal", name: "التمويل الشخصي", minSalary: 4000, maxAgeAtMaturity: 65, minServiceMonths: 3, sectors: SALARIED, maxTenor: 60, maxAmount: 1_500_000, rate: 3.5 },
  { lender: "بنك البلاد", financeType: "personal", name: "تمويل البلاد الشخصي", minSalary: 3000, maxAgeAtMaturity: 65, minServiceMonths: 3, sectors: WIDE, maxTenor: 60, maxAmount: 1_000_000, rate: 3.9 },
  { lender: "إمكان للتمويل", financeType: "personal", name: "تمويل نقدي", minSalary: 3000, maxAgeAtMaturity: 65, minServiceMonths: 3, sectors: WIDE, maxTenor: 60, maxAmount: 250_000, rate: 6.5, requiresSalaryTransfer: false, acceptsLateSimah: true },
  { lender: "النايفات للتمويل", financeType: "personal", name: "تمويل شخصي", minSalary: 3000, maxAgeAtMaturity: 65, minServiceMonths: 6, sectors: WIDE, nationalities: ANYONE, maxTenor: 60, maxAmount: 300_000, rate: 7.5, requiresSalaryTransfer: false, acceptsLateSimah: true },
  { lender: "مصرف الراجحي", financeType: "mortgage", name: "التمويل العقاري", minSalary: 5000, maxAgeAtMaturity: 70, minServiceMonths: 3, sectors: SALARIED, maxTenor: 300, maxAmount: 5_000_000, rate: 5.2, rateType: "reducing", maxLtv: 90 },
  { lender: "البنك الأهلي السعودي", financeType: "mortgage", name: "التمويل العقاري", minSalary: 6000, maxAgeAtMaturity: 70, minServiceMonths: 6, sectors: SALARIED, maxTenor: 300, maxAmount: 5_000_000, rate: 5.0, rateType: "reducing", maxLtv: 90 },
  { lender: "البنك السعودي للاستثمار", financeType: "mortgage", name: "سكني المدعوم، وحدة جاهزة", minSalary: 4000, maxAgeAtMaturity: 75, minServiceMonths: 3, sectors: SALARIED, maxTenor: 300, maxAmount: 7_000_000, rate: 4.9, rateType: "reducing", maxLtv: 90 },
  { lender: "دار التمليك", financeType: "mortgage", name: "تمويل المسكن", minSalary: 5000, maxAgeAtMaturity: 70, minServiceMonths: 6, sectors: WIDE, maxTenor: 300, maxAmount: 3_000_000, rate: 6.4, rateType: "reducing", maxLtv: 85, requiresSalaryTransfer: false },
  { lender: "مصرف الراجحي", financeType: "auto", name: "التأجير التمويلي للسيارات", minSalary: 4000, maxAgeAtMaturity: 65, minServiceMonths: 3, sectors: SALARIED, maxTenor: 60, maxAmount: 400_000, rate: 4.2 },
  { lender: "عبداللطيف جميل للتمويل", financeType: "auto", name: "تأجير السيارات", minSalary: 3000, maxAgeAtMaturity: 65, minServiceMonths: 3, sectors: WIDE, nationalities: ANYONE, maxTenor: 60, maxAmount: 400_000, rate: 5.5, requiresSalaryTransfer: false, acceptsLateSimah: true },
  { lender: "بنك البلاد", financeType: "sme", name: "تمويل المنشآت الصغيرة", minSalary: 0, maxAgeAtMaturity: 70, minServiceMonths: 24, sectors: ["self"], maxTenor: 60, maxAmount: 2_000_000, rate: 6.0, requiresSalaryTransfer: false },
];

export interface BaseRule {
  lender: string | null;
  financeType: FinanceType | null;
  kind: "condition" | "exception" | "tip" | "warning";
  title: string;
  body: string;
}

export const BASE_RULES: BaseRule[] = [
  { lender: null, financeType: "mortgage", kind: "tip", title: "اطلب تقييماً مبدئياً قبل العربون", body: "التمويل يُحسب على الأقل من السعر والتقييم، وفرق التقييم يدفعه العميل نقداً." },
  { lender: null, financeType: "personal", kind: "tip", title: "التمويل الإضافي لدى بنك الراتب", body: "إن كان على العميل تمويل قائم، فبنك الراتب يعطي غالباً تمويلاً إضافياً بلا نقل راتب ولا شراء مديونية." },
  { lender: "مصرف الراجحي", financeType: "personal", kind: "condition", title: "منتج قرب التقاعد", body: "خدمة 20 سنة للمدني و17 للعسكري و25 للتأمينات، وحتى 60 للموظف و75 للمتقاعد عند آخر قسط. من موقع الجهة، ويحتاج تأكيداً." },
  { lender: "البنك السعودي للاستثمار", financeType: "mortgage", kind: "exception", title: "لا فحص طبي حتى 2.5 مليون", body: "التكافل على الحياة مجاني وبلا فحص طبي للتمويل حتى 2,500,000 في منتج سكني المدعوم. من موقع الجهة، ويحتاج تأكيداً." },
  { lender: "إمكان للتمويل", financeType: "personal", kind: "exception", title: "تقبل تأخراً بسيطاً في سمة", body: "مع خطاب تسوية ومرور 3 أشهر من الانتظام. معلومة أولية تحتاج تأكيداً." },
  { lender: null, financeType: null, kind: "warning", title: "التعثر لدى شركة تمويل أثقل من التعثر لدى بنك", body: "البنوك تقرأ تعثر شركات التمويل مؤشر مخاطر أعلى. سدّد التعثر أولاً واحصل على خطاب المخالصة وحدّث سمة." },
  { lender: null, financeType: null, kind: "warning", title: "الإيقاف أو قرار التنفيذ يغلق كل الجهات", body: "أي إيقاف خدمات أو قرار تنفيذ يمنع التمويل حتى يُرفع ويظهر الرفع في سمة." },
  { lender: null, financeType: "personal", kind: "tip", title: "كثرة الاستعلامات تضر", body: "أكثر من 3 أو 4 استعلامات في 6 أشهر تجعل البنك يتردد. لا تقدّم لعدة جهات معاً، وابدأ بالأنسب." },
];
