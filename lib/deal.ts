// صفقة "سداد وإعادة تمويل" — نموذج عمل الشركة:
// ندفع عن العميل (قرارات التنفيذ، التعثرات، مخالصة العقار) ← يُفرَّغ العقار لطرفنا ضماناً ← يُرفع الإيقاف وتُحدَّث سمة
// ← يتقدم العميل للبنك بتمويل عقاري (يشتري العقار من طرفنا) + شخصي ← نسترد رأس المال من ثمن البيع والباقي من الشخصي ← أتعابنا.
// كل الأرقام هنا تقديرية تُستبدل بخطابات المديونية والتقييم وموافقة البنك الفعلية.

import { principalFrom, installmentFor, pensionEstimate, adminFee, SAMA } from "./engine";
import type { CreditReport } from "./simah";

export type ItemKind = "execution" | "default" | "mortgage_payoff" | "personal_payoff" | "card" | "other";
export interface DealItem {
  id: string;
  kind: ItemKind;
  label: string;
  original: number; // المبلغ الأصلي/المسجل
  pay: number; // ما سيُدفع فعلاً (بعد التفاوض أو حسب خطاب المديونية)
  by: "company" | "bank"; // company = من رأس مال الشركة، bank = يسدده البنك الجديد من التمويل الشخصي (إعادة تمويل داخلية)
  confirmed?: boolean; // مؤكد بخطاب مديونية/مخالصة
}
export type FinanceBase = "total" | "personal" | "mortgage";
export interface Fee {
  settlePct: number; // نسبة على سداد المتعثرات وقرارات التنفيذ (10–35%)
  settleIncludesPayoff: boolean; // هل تشمل مخالصة العقار/الشخصي
  financePct: number; // نسبة على استخراج التمويل (10–35%)
  financeBase: FinanceBase; // التمويل الذي تُحسب عليه النسبة
  fixed: number; // مبلغ إضافي مقطوع
}
export const FEE_MIN = 10, FEE_MAX = 35;

export interface DealInput {
  items: DealItem[];
  propertyValue: number | null; // التقييم المتوقع = سعر بيع العقار للبنك
  transferTaxPct: number; // ضريبة التصرفات عند الإفراغ لطرفنا
  saleTaxPct: number; // عند البيع للبنك (المسكن الأول للمواطن تتحملها الدولة حتى مليون)
  fixedCosts: number; // تقييم، سعي، رسوم، توثيق
  fee: Fee;
  targetBank: string | null;
  mortgageApr: number; // نسبة سنوية متناقصة
  personalFlat: number; // نسبة سنوية ثابتة
  personalMonths: number;
  mortgageMaxAge: number;
  mortgageMaxMonths: number;
  ltvPct: number;
  bankMortgage: number | null; // رقم موافقة/عرض البنك الفعلي إن وُجد
  bankPersonal: number | null;
  notes: string;
}

export interface Borrower {
  age: number | null;
  basicSalary: number | null;
  totalSalary: number | null;
  serviceMonths: number | null;
  sector: string;
}

export const STAGES = [
  ["study", "دراسة الصفقة", 2],
  ["agreement", "اتفاق وتوقيع مع العميل", 2],
  ["settlement", "سداد التنفيذ والتعثرات", 3],
  ["clearance", "المخالصات ورفع الإيقاف", 5],
  ["simah_update", "تحديث سمة", 10],
  ["payoff", "مخالصة العقار وفك الرهن", 10],
  ["transfer", "الإفراغ لطرفنا", 3],
  ["bank_submit", "التقديم للبنك", 3],
  ["approval", "التقييم والموافقة", 14],
  ["disbursement", "الصرف والإفراغ للبنك", 7],
  ["recovered", "استرداد رأس المال والأتعاب", 3],
  ["closed", "مغلقة", 0],
  ["lost", "متعثرة / ملغاة", 0],
] as const;
export type Stage = (typeof STAGES)[number][0];
export const STAGE_LABEL = Object.fromEntries(STAGES.map(([k, l]) => [k, l])) as Record<Stage, string>;
export const CAPITAL_OUT_STAGES: Stage[] = ["settlement", "clearance", "simah_update", "payoff", "transfer", "bank_submit", "approval", "disbursement"];

export const ITEM_KIND: Record<ItemKind, string> = {
  execution: "قرار تنفيذ",
  default: "تعثر",
  mortgage_payoff: "مخالصة تمويل عقاري",
  personal_payoff: "مخالصة تمويل شخصي",
  card: "بطاقة ائتمانية",
  other: "أخرى",
};
export const FINANCE_BASE: Record<FinanceBase, string> = { total: "العقاري + الشخصي", personal: "الشخصي فقط", mortgage: "العقاري فقط" };
/** يطبّع أي صيغة قديمة للأتعاب إلى الصيغة الحالية */
export function normFee(f: unknown): Fee {
  const d: Fee = { settlePct: 10, settleIncludesPayoff: false, financePct: 10, financeBase: "total", fixed: 0 };
  if (!f || typeof f !== "object") return d;
  const o = f as Record<string, unknown>;
  const num = (v: unknown, def: number) => (v == null || v === "" || !Number.isFinite(Number(v)) ? def : Number(v));
  return {
    settlePct: num(o.settlePct, d.settlePct),
    settleIncludesPayoff: !!o.settleIncludesPayoff,
    financePct: num(o.financePct, d.financePct),
    financeBase: o.financeBase === "personal" || o.financeBase === "mortgage" ? o.financeBase : "total",
    fixed: num(o.fixed, 0),
  };
}

export function defaultInput(): DealInput {
  return {
    items: [],
    propertyValue: null,
    transferTaxPct: 5,
    saleTaxPct: 0,
    fixedCosts: 10000,
    fee: normFee(null),
    targetBank: null,
    mortgageApr: 5.5,
    personalFlat: 3,
    personalMonths: 60,
    mortgageMaxAge: 70,
    mortgageMaxMonths: 300,
    ltvPct: SAMA.ltvFirstHomeCitizen,
    bankMortgage: null,
    bankPersonal: null,
    notes: "",
  };
}

/** القيمة الحالية لأقساط متبقية (تقدير مبلغ المخالصة قبل خطاب المديونية) + تكلفة 3 أشهر حسب ساما */
export function payoffEstimate(monthly: number, remaining: number, apr: number) {
  if (!monthly || !remaining) return remaining || 0;
  const n = Math.max(1, Math.round(remaining / monthly));
  const r = apr / 100 / 12;
  const pv = (monthly * (1 - Math.pow(1 + r, -n))) / r;
  return Math.round(Math.min(remaining, pv + pv * r * 3));
}

/** بنود السداد الأولية من تقرير سمة والالتزامات */
export function itemsFrom(report: CreditReport | null, obligations: { kind: string; lender?: string | null; monthly: number; remaining?: number | null }[]): DealItem[] {
  const items: DealItem[] = [];
  let i = 0;
  const id = () => `i${++i}`;
  const linked = new Set<unknown>();
  const defaults = (report?.facilities ?? []).filter((f) => f.status === "default");
  for (const j of report?.judgments ?? []) {
    if (!j.active) continue;
    const amt = j.remaining ?? j.amount ?? 0;
    const f = defaults.find((d) => !linked.has(d) && Math.abs((d.defaultNow ?? d.defaultAmount ?? 0) - amt) <= Math.max(1500, amt * 0.02));
    if (f) linked.add(f);
    items.push({ id: id(), kind: "execution", label: `قرار تنفيذ${j.decisionNo ? ` ${j.decisionNo}` : ""} — ${j.creditor ?? f?.lender ?? "دائن غير محدد"}${j.date ? ` (${j.date})` : ""}`, original: amt, pay: amt, by: "company" });
  }
  for (const d of defaults) {
    if (linked.has(d)) continue;
    const amt = d.defaultNow ?? d.defaultAmount ?? d.balance ?? 0;
    items.push({ id: id(), kind: "default", label: `تعثر ${d.lender} — ${d.product}`, original: amt, pay: amt, by: "company" });
  }
  for (const o of obligations) {
    if (o.kind === "mortgage") items.push({ id: id(), kind: "mortgage_payoff", label: `مخالصة العقاري — ${o.lender ?? ""}`, original: o.remaining ?? 0, pay: payoffEstimate(o.monthly, o.remaining ?? 0, 5), by: "company" });
    else if (o.kind === "personal" || o.kind === "auto" || o.kind === "card")
      items.push({ id: id(), kind: o.kind === "card" ? "card" : "personal_payoff", label: `مخالصة ${o.kind === "auto" ? "تمويل سيارة" : o.kind === "card" ? "بطاقة" : "الشخصي"} — ${o.lender ?? ""}`, original: o.remaining ?? 0, pay: payoffEstimate(o.monthly, o.remaining ?? 0, 6), by: "bank" });
  }
  return items;
}

export interface DealStudy {
  verdict: "go" | "tight" | "short" | "needs_info";
  headline: string;
  paidByCompany: number;
  paidByBank: number;
  transferTax: number;
  saleTax: number;
  capital: number; // أقصى رأس مال توظفه الشركة
  financing: {
    age: number | null;
    monthsToRetire: number | null;
    pension: number | null;
    personalInstallment: number;
    personalMonths: number;
    personal: number; // أصل الشخصي الممكن
    mortgagePre: number; // قسط العقاري قبل التقاعد
    mortgagePost: number; // بعد التقاعد
    mortgageMonths: number;
    mortgageByIncome: number;
    mortgageByLtv: number | null;
    mortgage: number;
    source: "estimate" | "bank";
    dbrAfter: number | null;
  };
  waterfall: { label: string; amount: number; tone?: "in" | "out" | "net" }[];
  downPayment: number;
  personalCash: number; // صافي الشخصي بعد إعادة التمويل الداخلي والرسوم
  fee: number;
  feeSettle: number;
  feeFinance: number;
  settleBase: number;
  financeBase: number;
  suggestedPct: number;
  suggestedWhy: string[];
  dueFromClient: number; // ما يدفعه العميل لنا من الشخصي بعد البيع
  clientNet: number; // ما يبقى للعميل نقداً (سالب = عجز)
  surplusBeforeFee: number;
  roi: number | null;
  days: number;
  annualized: number | null;
  cover: number | null; // تغطية الضمان: قيمة العقار ÷ رأس المال
  breakEvenDiscount: number | null; // الخصم المطلوب على التنفيذ/التعثرات لتغطية العجز
  risks: { level: "block" | "warn" | "info"; text: string }[];
  steps: { stage: Stage; label: string; days: number }[];
}

const r0 = (n: number) => Math.round(n);
const fmt = (n: number) => r0(n).toLocaleString("en-US");

export function dealStudy(x: DealInput, b: Borrower, credit?: { bankReopenMonths: number | null; suspension: boolean; financeCoDefault: boolean } | null): DealStudy {
  const risks: DealStudy["risks"] = [];
  const paidByCompany = x.items.filter((i) => i.by === "company").reduce((s, i) => s + (i.pay || 0), 0);
  const paidByBank = x.items.filter((i) => i.by === "bank").reduce((s, i) => s + (i.pay || 0), 0);
  const V = x.propertyValue ?? 0;
  const transferTax = r0((V * (x.transferTaxPct || 0)) / 100);
  const saleTax = r0((V * (x.saleTaxPct || 0)) / 100);
  const capital = r0(paidByCompany + transferTax + (x.fixedCosts || 0));

  // ===== التمويل الجديد المتوقع (بعد التسوية: لا التزامات قائمة إلا ما يعيد البنك تمويله داخلياً) =====
  const salary = b.totalSalary ?? b.basicSalary ?? 0;
  const age = b.age;
  const monthsToRetire = age != null && b.sector !== "retired" && b.sector !== "self" ? Math.max(0, (SAMA.retirementAge - age) * 12) : null;
  const pension = monthsToRetire != null && b.basicSalary ? pensionEstimate(b.basicSalary, ((b.serviceMonths ?? 0) + monthsToRetire) / 12) : null;
  const totalCap = salary <= SAMA.lowBracket ? SAMA.totalCapLow : SAMA.totalCapMid;
  const personalInstallment = r0(salary * SAMA.salaryDeductionEmployee);
  const personalMonths = Math.min(x.personalMonths || 60, SAMA.consumerMaxTenor, monthsToRetire && monthsToRetire > 0 ? Math.max(12, monthsToRetire) : 60);
  const personalEst = r0(principalFrom(personalInstallment, personalMonths, x.personalFlat, "flat"));
  const pre = Math.max(0, r0(salary * totalCap - personalInstallment));
  const maxM = Math.min(x.mortgageMaxMonths || 300, age != null ? Math.max(0, (x.mortgageMaxAge - age) * 12) : 300);
  let mortgageByIncome = 0, post = 0;
  if (monthsToRetire != null && monthsToRetire < maxM) {
    // قسط متدرج: كامل قبل التقاعد، ثم ضمن نسبة المعاش
    post = Math.min(pre, r0((pension ?? 0) * (pension != null && pension <= SAMA.lowBracket ? SAMA.totalCapLow : SAMA.totalCapMid)));
    const r = x.mortgageApr / 100 / 12;
    const a1 = principalFrom(pre, monthsToRetire, x.mortgageApr, "reducing");
    const a2 = principalFrom(post, maxM - monthsToRetire, x.mortgageApr, "reducing") * Math.pow(1 + r, -monthsToRetire);
    mortgageByIncome = r0(a1 + a2);
  } else {
    post = pre;
    mortgageByIncome = r0(principalFrom(pre, maxM, x.mortgageApr, "reducing"));
  }
  const mortgageByLtv = V ? r0((V * x.ltvPct) / 100) : null;
  const mortgageEst = mortgageByLtv != null ? Math.min(mortgageByIncome, mortgageByLtv) : mortgageByIncome;
  const mortgage = x.bankMortgage ?? mortgageEst;
  const personal = x.bankPersonal ?? personalEst;
  const source = x.bankMortgage != null || x.bankPersonal != null ? "bank" : "estimate";
  const mInst = installmentFor(mortgage, maxM, x.mortgageApr, "reducing");
  const pInst = installmentFor(personal, personalMonths, x.personalFlat, "flat");
  const dbrAfter = salary ? Math.round(((Math.min(mInst, pre) + pInst) / salary) * 1000) / 10 : null;

  // ===== الشلال =====
  const personalCash = r0(personal - paidByBank - adminFee(personal));
  const price = V || mortgage; // سعر البيع للبنك
  const downPayment = Math.max(0, r0(price - mortgage));
  const companyFromSale = price - saleTax;
  const surplusBeforeFee = r0(mortgage + personalCash - capital - saleTax);
  const fx = normFee(x.fee);
  const settleBase = x.items.filter((i) => i.by === "company" && (i.kind === "execution" || i.kind === "default" || i.kind === "card" || i.kind === "other" || (fx.settleIncludesPayoff && (i.kind === "mortgage_payoff" || i.kind === "personal_payoff")))).reduce((a, i) => a + (i.pay || 0), 0);
  const financeBase = fx.financeBase === "personal" ? personal : fx.financeBase === "mortgage" ? mortgage : mortgage + personal;
  const feeSettle = r0((settleBase * fx.settlePct) / 100);
  const feeFinance = r0((financeBase * fx.financePct) / 100);
  const fee = r0(feeSettle + feeFinance + (fx.fixed || 0));
  const dueFromClient = r0(capital + fee - companyFromSale); // سالب = فائض من ثمن البيع يُعاد للعميل
  const clientCashAfterDown = personalCash - downPayment;
  const clientNet = r0(clientCashAfterDown - dueFromClient);
  const days = STAGES.filter(([k]) => k !== "closed" && k !== "lost").reduce((s, [, , d]) => s + d, 0);
  const roi = capital > 0 ? Math.round((fee / capital) * 1000) / 10 : null;
  const annualized = roi != null && days ? Math.round(((roi * 365) / days) * 10) / 10 : null;
  const cover = capital > 0 && V ? Math.round((V / capital) * 100) / 100 : null;
  const discountable = x.items.filter((i) => i.by === "company" && (i.kind === "execution" || i.kind === "default")).reduce((s, i) => s + i.pay, 0);
  const breakEvenDiscount = clientNet < 0 && discountable > 0 ? Math.round((-clientNet / discountable) * 1000) / 10 : null;

  const waterfall: DealStudy["waterfall"] = [
    { label: "ندفعه نحن (تنفيذ + تعثرات + مخالصة العقار)", amount: -paidByCompany, tone: "out" },
    { label: `ضريبة التصرفات عند الإفراغ لطرفنا (${x.transferTaxPct}%)`, amount: -transferTax, tone: "out" },
    { label: "تكاليف ثابتة (تقييم، سعي، رسوم)", amount: -(x.fixedCosts || 0), tone: "out" },
    { label: "يسترد من البنك: ثمن العقار (العقاري + الدفعة الأولى)", amount: companyFromSale, tone: "in" },
    { label: `أتعاب السداد ${fx.settlePct}% من ${fmt(settleBase)}`, amount: feeSettle, tone: "net" },
    { label: `أتعاب استخراج التمويل ${fx.financePct}% من ${fmt(financeBase)}`, amount: feeFinance, tone: "net" },
    ...(fx.fixed ? [{ label: "أتعاب مقطوعة", amount: fx.fixed, tone: "net" as const }] : []),
    { label: dueFromClient >= 0 ? "يدفعه العميل لنا من التمويل الشخصي" : "فائض من ثمن البيع يُعاد للعميل", amount: dueFromClient, tone: "in" },
  ];

  // ===== المخاطر =====
  if (!V) risks.push({ level: "block", text: "قيمة العقار غير معروفة — اطلب تقييماً معتمداً؛ هو سعر البيع للبنك وأساس كل الحساب." });
  if (clientNet < 0) risks.push({ level: "block", text: `الصفقة لا تُغلق: عجز ${fmt(-clientNet)} ريال. التمويل الجديد لا يغطي رأس المال + الأتعاب + الدفعة الأولى.${breakEvenDiscount ? ` يلزم خصم ≈ ${breakEvenDiscount}% على التنفيذ والتعثرات، أو رفع التقييم، أو متضامن.` : ""}` });
  else if (clientNet < 20000) risks.push({ level: "warn", text: `هامش ضيق: يبقى للعميل ${fmt(clientNet)} ريال فقط — أي نقص في التقييم أو الموافقة يكسر الصفقة.` });
  if (cover != null && cover < 1.1) risks.push({ level: "block", text: `تغطية الضمان ${cover}x: قيمة العقار لا تغطي رأس مالنا بهامش كافٍ. لو رفض البنك نبيع العقار بخسارة.` });
  else if (cover != null && cover < 1.3) risks.push({ level: "warn", text: `تغطية الضمان ${cover}x — مقبولة لكن حساسة لانخفاض التقييم.` });
  if (credit?.financeCoDefault) risks.push({ level: "warn", text: "تعثر شركة تمويل سيبقى في سمة بحالة «مسدد»؛ كثير من البنوك تطلب مرور 12–24 شهراً. قدّم على بنك الراتب أو بنك يقبل التعثر المسدد باستثناء، ووثّق النتيجة في «نتائج الجهات»." });
  if (credit?.bankReopenMonths) risks.push({ level: "warn", text: `حسب تحليل سمة قد تطلب البنوك انتظار ≈ ${credit.bankReopenMonths} شهراً بعد التسوية — هذا يطيل مدة رأس المال إن لم يُقبل استثناء.` });
  if (credit?.suspension) risks.push({ level: "info", text: "الإيقاف (المادة 46) يُرفع آلياً بعد سداد قرارات التنفيذ في ناجز — تأكد قبل الإفراغ والتقديم للبنك." });
  if (monthsToRetire != null && monthsToRetire < 120) risks.push({ level: "warn", text: `يتقاعد بعد ${Math.round(monthsToRetire / 12)} سنوات — قسط العقاري بعد التقاعد مقيّد بالمعاش التقديري ${fmt(pension ?? 0)}، فالمبلغ أقل. اطلب منتجاً متدرجاً.` });
  if (V && mortgageByIncome < (mortgageByLtv ?? 0)) risks.push({ level: "info", text: `العقاري محكوم بالدخل (${fmt(mortgageByIncome)}) لا بقيمة العقار (${fmt(mortgageByLtv ?? 0)}) — الدفعة الأولى ${fmt(downPayment)} تُدفع من الشخصي.` });
  if (x.items.some((i) => i.kind === "mortgage_payoff" && !i.confirmed)) risks.push({ level: "warn", text: "مبلغ مخالصة العقاري تقديري — اطلب خطاب مديونية (مخالصة مبكرة) من البنك قبل الالتزام." });
  if (x.items.some((i) => i.kind === "execution")) risks.push({ level: "info", text: "تفاوض مع طالبي التنفيذ على خصم قبل السداد — كل ريال خصم يذهب مباشرة لهامش الصفقة." });
  if (x.transferTaxPct > 0) risks.push({ level: "info", text: `ضريبة التصرفات ${fmt(transferTax)} عند الإفراغ لطرفنا — تحقق من الإعفاءات المتاحة مع الزكاة والضريبة قبل الإفراغ.` });
  risks.push({ level: "info", text: "ضمانات الاسترداد: عقد بيع موثق للعقار، سند لأمر عبر «نافذ» بقيمة المستحق من الشخصي، وتحويل الدفعة مباشرة من البنك لطرفنا متى أمكن." });
  if (dbrAfter != null && dbrAfter > totalCap * 100 + 0.5) risks.push({ level: "warn", text: `الاستقطاع بعد التمويل ${dbrAfter}% يتجاوز سقف ساما ${Math.round(totalCap * 100)}% — راجع أرقام البنك.` });

  // نسبة مقترحة حسب مخاطر العميل (10% أساس، حتى 35%)
  const why: string[] = [];
  let sug = FEE_MIN;
  if (credit?.suspension) { sug += 5; why.push("إيقاف خدمات"); }
  if (credit?.financeCoDefault) { sug += 5; why.push("تعثر شركة تمويل"); }
  if (x.items.some((i) => i.kind === "execution")) { sug += 5; why.push("قرارات تنفيذ"); }
  if (cover != null && cover < 1.3) { sug += 5; why.push("تغطية ضمان منخفضة"); }
  if (monthsToRetire != null && monthsToRetire < 120) { sug += 5; why.push("قرب التقاعد"); }
  if (V && paidByCompany > V * 0.8) { sug += 5; why.push("المدفوع يقارب قيمة العقار"); }
  const suggestedPct = Math.min(FEE_MAX, sug);
  if (fx.settlePct > FEE_MAX || fx.financePct > FEE_MAX) risks.push({ level: "warn", text: `النسبة تتجاوز الحد الأقصى المعتمد ${FEE_MAX}%.` });

  const verdict: DealStudy["verdict"] = !V ? "needs_info" : clientNet < 0 || (cover != null && cover < 1.1) ? "short" : clientNet < 20000 ? "tight" : "go";
  const headline =
    verdict === "go" ? `الصفقة تُغلق — أتعابنا ${fmt(fee)} ويبقى للعميل ${fmt(clientNet)}` :
    verdict === "tight" ? `تُغلق بهامش ضيق — أتعابنا ${fmt(fee)}` :
    verdict === "short" ? `لا تُغلق بالأرقام الحالية — عجز ${fmt(Math.max(0, -clientNet))}` :
    "ناقصة: نحتاج تقييم العقار";

  return {
    verdict, headline, paidByCompany: r0(paidByCompany), paidByBank: r0(paidByBank), transferTax, saleTax, capital,
    financing: { age, monthsToRetire, pension, personalInstallment, personalMonths, personal, mortgagePre: pre, mortgagePost: post, mortgageMonths: maxM, mortgageByIncome, mortgageByLtv, mortgage, source, dbrAfter },
    waterfall, downPayment, personalCash, fee, feeSettle, feeFinance, settleBase, financeBase, suggestedPct, suggestedWhy: why, dueFromClient, clientNet, surplusBeforeFee, roi, days, annualized, cover, breakEvenDiscount, risks,
    steps: STAGES.filter(([k]) => k !== "closed" && k !== "lost").map(([stage, label, d]) => ({ stage, label, days: d })),
  };
}
