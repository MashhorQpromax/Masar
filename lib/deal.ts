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
  by: "company" | "bank" | "out"; // company = من رأس مال الشركة، bank = يسدده البنك الجديد من التمويل الشخصي (إعادة تمويل داخلية)، out = خارج الصفقة (لا يُسدد فيها)
  confirmed?: boolean; // مؤكد بخطاب مديونية/مخالصة
  monthly?: number | null; // القسط الشهري الحالي (يُحسب في الاستقطاع إن بقي الالتزام قائماً)
}

/** هيكل الصفقة — حسب رغبة العميل ووضعه */
export type Structure = "settle_refi_personal" | "settle_personal" | "settle_refi";
export const STRUCTURES: Record<Structure, { label: string; short: string; mortgage: boolean; personal: boolean; hint: string }> = {
  settle_refi_personal: { label: "سداد + إعادة تمويل العقار + شخصي", short: "عقاري + شخصي", mortgage: true, personal: true, hint: "نسدد المتعثرات ومخالصة العقار، يُفرغ العقار لطرفنا، ثم يشتريه البنك بتمويل عقاري جديد مع تمويل شخصي." },
  settle_personal: { label: "سداد المتعثرات + تمويل شخصي فقط", short: "شخصي فقط", mortgage: false, personal: true, hint: "العقار يبقى على حاله وبقسطه الحالي. نسدد المتعثرات ونسترد من تمويل شخصي جديد يشتري الشخصي القائم." },
  settle_refi: { label: "سداد + إعادة تمويل العقار فقط", short: "عقاري فقط", mortgage: true, personal: false, hint: "الشخصي القائم يبقى بقسطه. نسدد المتعثرات ومخالصة العقار ونسترد من ثمن بيع العقار للبنك." },
};
export const STRUCTURE_KEYS = Object.keys(STRUCTURES) as Structure[];
export const structureOf = (x: { structure?: Structure | null }) => STRUCTURES[x.structure ?? "settle_refi_personal"] ? (x.structure ?? "settle_refi_personal") : "settle_refi_personal";

/** البنود الداخلة في الهيكل، والتي تبقى قائمة بأقساطها */
export function splitItems(x: Pick<DealInput, "items" | "structure">) {
  const st = STRUCTURES[structureOf(x)];
  const inDeal = (i: DealItem) => i.by !== "out" && (st.mortgage || i.kind !== "mortgage_payoff") && (st.personal || i.by !== "bank");
  return { active: x.items.filter(inDeal), kept: x.items.filter((i) => !inDeal(i)) };
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
  structure?: Structure;
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
  personalLender?: string | null; // الجهة التي قدمت عرض الشخصي (مثل: إمكان)
  personalLenderKind?: "bank" | "finance_co" | null; // شركة تمويل: هامش أعلى وأثر على التمويل اللاحق
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
/** المراحل التي تنطبق على الهيكل (بدون عقار: لا مخالصة ولا إفراغ) */
export function stagesFor(structure?: Structure | null) {
  const m = STRUCTURES[structureOf({ structure })].mortgage;
  return STAGES.filter(([k]) => m || (k !== "payoff" && k !== "transfer"))
    .map(([k, l, d]) => [k, !m && k === "disbursement" ? "صرف التمويل" : l, d] as [Stage, string, number]);
}
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
    structure: "settle_refi_personal",
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
    if (o.kind === "mortgage") items.push({ id: id(), kind: "mortgage_payoff", label: `مخالصة العقاري — ${o.lender ?? ""}`, original: o.remaining ?? 0, pay: payoffEstimate(o.monthly, o.remaining ?? 0, 5), by: "company", monthly: o.monthly || null });
    else if (o.kind === "personal" || o.kind === "auto" || o.kind === "card")
      items.push({ id: id(), kind: o.kind === "card" ? "card" : "personal_payoff", label: `مخالصة ${o.kind === "auto" ? "تمويل سيارة" : o.kind === "card" ? "بطاقة" : "الشخصي"} — ${o.lender ?? ""}`, original: o.remaining ?? 0, pay: payoffEstimate(o.monthly, o.remaining ?? 0, 6), by: "bank", monthly: o.monthly || null });
  }
  return items;
}

export interface DealStudy {
  structure: Structure;
  keptMonthly: number; // أقساط الالتزامات التي تبقى قائمة
  /** ملخص مبسط بترتيب: الالتزامات ← التمويل ← بعد السداد ← أتعابنا ← النتيجة */
  summary: {
    obligations: { label: string; amount: number; original: number; byBank: boolean }[];
    totalObligations: number;
    discountTotal: number; // مجموع الخصومات المتفاوض عليها على التنفيذ والتعثرات
    kept: { label: string; monthly: number | null; amount: number; kind: ItemKind }[];
    keptExecutions: number; // قرارات تنفيذ خارج الصفقة (الإيقاف يبقى)
    financing: { label: string; amount: number }[];
    totalFinancing: number;
    costs: { label: string; amount: number }[];
    afterSettle: number; // التمويل − الالتزامات − التكاليف (قبل أتعابنا)
    net: number; // بعد أتعابنا = يبقى للعميل
  };
  /** تفصيل الحساب سطراً بسطر ليتحقق منه المستخدم بنفسه */
  explain: { group: string; label: string; calc?: string; note?: string; value: number; tone?: "plus" | "minus" | "total" }[];
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
  const structure = structureOf(x);
  const st = STRUCTURES[structure];
  const { active, kept } = splitItems(x);
  const keptMonthly = r0(kept.reduce((a, i) => a + (i.monthly || 0), 0));
  const paidByCompany = active.filter((i) => i.by === "company").reduce((s, i) => s + (i.pay || 0), 0);
  const paidByBank = active.filter((i) => i.by === "bank").reduce((s, i) => s + (i.pay || 0), 0);
  const V = st.mortgage ? x.propertyValue ?? 0 : 0;
  const transferTax = r0((V * (x.transferTaxPct || 0)) / 100);
  const saleTax = r0((V * (x.saleTaxPct || 0)) / 100);
  // التكاليف الثابتة (تقييم، سعي، رسوم الإفراغ) تخص هياكل العقار فقط
  const fixedCosts = st.mortgage ? x.fixedCosts || 0 : 0;
  const capital = r0(paidByCompany + transferTax + fixedCosts);

  // ===== التمويل الجديد المتوقع (بعد التسوية؛ الالتزامات التي تبقى قائمة تأكل من السقف) =====
  const salary = b.totalSalary ?? b.basicSalary ?? 0;
  const age = b.age;
  const monthsToRetire = age != null && b.sector !== "retired" && b.sector !== "self" ? Math.max(0, (SAMA.retirementAge - age) * 12) : null;
  const pension = monthsToRetire != null && b.basicSalary ? pensionEstimate(b.basicSalary, ((b.serviceMonths ?? 0) + monthsToRetire) / 12) : null;
  const totalCap = salary <= SAMA.lowBracket ? SAMA.totalCapLow : SAMA.totalCapMid;
  const room = Math.max(0, salary * totalCap - keptMonthly);
  const personalInstallment = st.personal ? r0(Math.min(salary * SAMA.salaryDeductionEmployee, room)) : 0;
  const personalMonths = Math.min(x.personalMonths || 60, SAMA.consumerMaxTenor, monthsToRetire && monthsToRetire > 0 ? Math.max(12, monthsToRetire) : 60);
  const personalEst = r0(principalFrom(personalInstallment, personalMonths, x.personalFlat, "flat"));
  const pre = st.mortgage ? Math.max(0, r0(room - personalInstallment)) : 0;
  const maxM = st.mortgage ? Math.min(x.mortgageMaxMonths || 300, age != null ? Math.max(0, (x.mortgageMaxAge - age) * 12) : 300) : 0;
  let mortgageByIncome = 0, post = 0;
  if (!st.mortgage) { /* لا عقاري جديد */ }
  else if (monthsToRetire != null && monthsToRetire < maxM) {
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
  const mortgageByLtv = st.mortgage && V ? r0((V * x.ltvPct) / 100) : null;
  const mortgageEst = mortgageByLtv != null ? Math.min(mortgageByIncome, mortgageByLtv) : mortgageByIncome;
  const mortgage = st.mortgage ? x.bankMortgage ?? mortgageEst : 0;
  const personal = st.personal ? x.bankPersonal ?? personalEst : 0;
  const source = (st.mortgage && x.bankMortgage != null) || (st.personal && x.bankPersonal != null) ? "bank" : "estimate";
  const mInst = st.mortgage ? installmentFor(mortgage, maxM, x.mortgageApr, "reducing") : 0;
  const pInst = st.personal ? installmentFor(personal, personalMonths, x.personalFlat, "flat") : 0;
  const dbrAfter = salary ? Math.round(((Math.min(mInst, pre) + pInst + keptMonthly) / salary) * 1000) / 10 : null;

  // ===== الشلال =====
  const personalCash = st.personal ? r0(personal - paidByBank - adminFee(personal)) : 0;
  const price = st.mortgage ? V || mortgage : 0; // سعر البيع للبنك
  const downPayment = st.mortgage ? Math.max(0, r0(price - mortgage)) : 0;
  const companyFromSale = st.mortgage ? price - saleTax : 0;
  const surplusBeforeFee = r0(mortgage + personalCash - capital - saleTax);
  const fx = normFee(x.fee);
  const settleBase = active.filter((i) => i.by === "company" && (i.kind === "execution" || i.kind === "default" || i.kind === "card" || i.kind === "other" || (fx.settleIncludesPayoff && (i.kind === "mortgage_payoff" || i.kind === "personal_payoff")))).reduce((a, i) => a + (i.pay || 0), 0);
  const financeBase = fx.financeBase === "personal" ? personal : fx.financeBase === "mortgage" ? mortgage : mortgage + personal;
  const feeSettle = r0((settleBase * fx.settlePct) / 100);
  const feeFinance = r0((financeBase * fx.financePct) / 100);
  const fee = r0(feeSettle + feeFinance + (fx.fixed || 0));
  const dueFromClient = r0(capital + fee - companyFromSale); // سالب = فائض من ثمن البيع يُعاد للعميل
  const clientCashAfterDown = personalCash - downPayment;
  const clientNet = r0(clientCashAfterDown - dueFromClient);
  const steps = stagesFor(structure).filter(([k]) => k !== "closed" && k !== "lost");
  const days = steps.reduce((s, [, , d]) => s + d, 0);
  const roi = capital > 0 ? Math.round((fee / capital) * 1000) / 10 : null;
  const annualized = roi != null && days ? Math.round(((roi * 365) / days) * 10) / 10 : null;
  const cover = st.mortgage && capital > 0 && V ? Math.round((V / capital) * 100) / 100 : null;
  const discountable = active.filter((i) => i.by === "company" && (i.kind === "execution" || i.kind === "default")).reduce((s, i) => s + i.pay, 0);
  // كل ريال خصم يوفر الريال + نسبة أتعاب السداد عليه
  const breakEvenDiscount = clientNet < 0 && discountable > 0 ? Math.min(100, Math.round((-clientNet / (discountable * (1 + fx.settlePct / 100))) * 1000) / 10) : null;

  const waterfall: DealStudy["waterfall"] = [
    { label: st.mortgage ? "ندفعه نحن (تنفيذ + تعثرات + مخالصة العقار)" : "ندفعه نحن (تنفيذ + تعثرات)", amount: -paidByCompany, tone: "out" },
    ...(st.mortgage ? [{ label: `ضريبة التصرفات عند الإفراغ لطرفنا (${x.transferTaxPct}%)`, amount: -transferTax, tone: "out" as const }] : []),
    ...(st.mortgage ? [{ label: "تكاليف ثابتة (تقييم، سعي، رسوم)", amount: -fixedCosts, tone: "out" as const }] : []),
    ...(st.mortgage ? [{ label: "يسترد من البنك: ثمن العقار (العقاري + الدفعة الأولى)", amount: companyFromSale, tone: "in" as const }] : []),
    { label: `أتعاب السداد ${fx.settlePct}% من ${fmt(settleBase)}`, amount: feeSettle, tone: "net" },
    { label: `أتعاب استخراج التمويل ${fx.financePct}% من ${fmt(financeBase)}`, amount: feeFinance, tone: "net" },
    ...(fx.fixed ? [{ label: "أتعاب مقطوعة", amount: fx.fixed, tone: "net" as const }] : []),
    { label: dueFromClient < 0 ? "فائض من ثمن البيع يُعاد للعميل" : st.personal ? "يدفعه العميل لنا من التمويل الشخصي" : "يدفعه العميل لنا من ماله (لا يوجد شخصي)", amount: dueFromClient, tone: "in" },
  ];

  // ===== المخاطر =====
  if (st.mortgage && !V) risks.push({ level: "block", text: "قيمة العقار غير معروفة — اطلب تقييماً معتمداً؛ هو سعر البيع للبنك وأساس كل الحساب." });
  if (clientNet < 0) risks.push({ level: "block", text: `الصفقة لا تُغلق: عجز ${fmt(-clientNet)} ريال. ${st.mortgage ? "التمويل الجديد لا يغطي رأس المال + الأتعاب + الدفعة الأولى." : `صافي الشخصي بعد شراء الالتزام القائم ${fmt(personalCash)} فقط، والمطلوب رأس المال + الأتعاب ${fmt(capital + fee)}.`} شوف «حلول بديلة» بالأسفل.` });
  else if (clientNet < 20000) risks.push({ level: "warn", text: `هامش ضيق: يبقى للعميل ${fmt(clientNet)} ريال فقط — أي نقص في التقييم أو الموافقة يكسر الصفقة.` });
  const keptInst = kept.filter((i) => i.kind !== "execution" && i.kind !== "default");
  const keptExec = kept.filter((i) => i.kind === "execution");
  const keptDef = kept.filter((i) => i.kind === "default");
  if (keptInst.length) {
    const miss = keptInst.filter((i) => !i.monthly);
    risks.push({ level: miss.length ? "warn" : "info", text: `التزامات تبقى قائمة: ${keptInst.map((i) => i.label.split("—")[0].trim()).join("، ")} بقسط ${fmt(keptMonthly)} شهرياً، وتُحسب في سقف الاستقطاع.${miss.length ? " أدخل القسط الشهري لكل بند منها في الجدول ليكون الحساب صحيحاً." : ""}` });
  }
  if (keptExec.length) risks.push({ level: "block", text: `${keptExec.length === 1 ? "قرار تنفيذ خارج الصفقة" : `${keptExec.length} قرارات تنفيذ خارج الصفقة`} بمبلغ ${fmt(keptExec.reduce((a, i) => a + i.pay, 0))}: الإيقاف (المادة 46) يبقى ما دام أي قرار مفتوحاً، ولا بنك ولا شركة تمويل تصرف لعميل عليه إيقاف، والراتب معرّض للحجز. إما تدخل في الصفقة، أو يسددها العميل بنفسه ويُثبت رفع الإيقاف قبل التقديم.` });
  if (keptDef.length) risks.push({ level: "warn", text: `تعثر يبقى في سمة بدون سداد (${keptDef.map((i) => `${i.label.replace(/^تعثر\s*/, "").split("—")[0].trim()} ${fmt(i.pay)}`).join("، ")}): أغلب الجهات ترفض مع تعثر قائم مهما صغر، وسداده أرخص من رفض الطلب.` });
  if (st.personal && x.personalLenderKind === "finance_co") risks.push({ level: "warn", text: `الشخصي من ${x.personalLender || "شركة تمويل"} (شركة تمويل): هامشها أعلى من البنوك${x.bankPersonal != null && personalEst > personal ? ` — نفس القسط ${fmt(personalInstallment)} يعطي ${fmt(personal)} بدل ≈ ${fmt(personalEst)} من بنك بهامش ${x.personalFlat}%` : ""}. ويظهر في سمة تمويلاً قائماً لدى شركة تمويل، وبعض البنوك تتحفظ عليه في أي تمويل لاحق (مثل إعادة تمويل العقار).` });
  if (!st.mortgage) risks.push({ level: "warn", text: "لا يوجد ضمان عقاري في هذا الهيكل: رأس مالنا مكشوف حتى صرف الشخصي. الضمانات: سند لأمر عبر «نافذ» بكامل المستحق، تعهد العميل بتحويل المبلغ فور الصرف، ويُفضّل كفيل غارم." });
  if (cover != null && cover < 1.1) risks.push({ level: "block", text: `تغطية الضمان ${cover}x: قيمة العقار لا تغطي رأس مالنا بهامش كافٍ. لو رفض البنك نبيع العقار بخسارة.` });
  else if (cover != null && cover < 1.3) risks.push({ level: "warn", text: `تغطية الضمان ${cover}x — مقبولة لكن حساسة لانخفاض التقييم.` });
  if (credit?.financeCoDefault) risks.push({ level: "warn", text: "تعثر شركة تمويل سيبقى في سمة بحالة «مسدد»؛ كثير من البنوك تطلب مرور 12–24 شهراً. قدّم على بنك الراتب أو بنك يقبل التعثر المسدد باستثناء، ووثّق النتيجة في «نتائج الجهات»." });
  if (credit?.bankReopenMonths) risks.push({ level: "warn", text: `حسب تحليل سمة قد تطلب البنوك انتظار ≈ ${credit.bankReopenMonths} شهراً بعد التسوية — هذا يطيل مدة رأس المال إن لم يُقبل استثناء.` });
  if (credit?.suspension) risks.push({ level: "info", text: `الإيقاف (المادة 46) يُرفع آلياً بعد سداد قرارات التنفيذ في ناجز — تأكد قبل ${st.mortgage ? "الإفراغ و" : ""}التقديم للبنك.` });
  if (st.mortgage && monthsToRetire != null && monthsToRetire < 120) risks.push({ level: "warn", text: `يتقاعد بعد ${Math.round(monthsToRetire / 12)} سنوات — قسط العقاري بعد التقاعد مقيّد بالمعاش التقديري ${fmt(pension ?? 0)}، فالمبلغ أقل. اطلب منتجاً متدرجاً.` });
  if (st.mortgage && V && mortgageByIncome < (mortgageByLtv ?? 0)) risks.push({ level: "info", text: `العقاري محكوم بالدخل (${fmt(mortgageByIncome)}) لا بقيمة العقار (${fmt(mortgageByLtv ?? 0)}) — الدفعة الأولى ${fmt(downPayment)} تُدفع من الشخصي.` });
  if (active.some((i) => i.kind === "mortgage_payoff" && !i.confirmed)) risks.push({ level: "warn", text: "مبلغ مخالصة العقاري تقديري — اطلب خطاب مديونية (مخالصة مبكرة) من البنك قبل الالتزام." });
  if (active.some((i) => i.kind === "execution")) risks.push({ level: "info", text: "تفاوض مع طالبي التنفيذ على خصم قبل السداد — كل ريال خصم يذهب مباشرة لهامش الصفقة." });
  if (st.mortgage && x.transferTaxPct > 0) risks.push({ level: "info", text: `ضريبة التصرفات ${fmt(transferTax)} عند الإفراغ لطرفنا — تحقق من الإعفاءات المتاحة مع الزكاة والضريبة قبل الإفراغ.` });
  if (st.mortgage) risks.push({ level: "info", text: "ضمانات الاسترداد: عقد بيع موثق للعقار، سند لأمر عبر «نافذ» بقيمة المستحق من الشخصي، وتحويل الدفعة مباشرة من البنك لطرفنا متى أمكن." });
  if (dbrAfter != null && dbrAfter > totalCap * 100 + 0.5) risks.push({ level: "warn", text: `الاستقطاع بعد التمويل ${dbrAfter}% يتجاوز سقف ساما ${Math.round(totalCap * 100)}% — راجع أرقام البنك.` });

  // نسبة مقترحة حسب مخاطر العميل (10% أساس، حتى 35%)
  const why: string[] = [];
  let sug = FEE_MIN;
  if (credit?.suspension) { sug += 5; why.push("إيقاف خدمات"); }
  if (credit?.financeCoDefault) { sug += 5; why.push("تعثر شركة تمويل"); }
  if (active.some((i) => i.kind === "execution")) { sug += 5; why.push("قرارات تنفيذ"); }
  if (!st.mortgage) { sug += 5; why.push("بدون ضمان عقاري"); }
  if (cover != null && cover < 1.3) { sug += 5; why.push("تغطية ضمان منخفضة"); }
  if (st.mortgage && monthsToRetire != null && monthsToRetire < 120) { sug += 5; why.push("قرب التقاعد"); }
  if (V && paidByCompany > V * 0.8) { sug += 5; why.push("المدفوع يقارب قيمة العقار"); }
  const suggestedPct = Math.min(FEE_MAX, sug);
  if (fx.settlePct > FEE_MAX || fx.financePct > FEE_MAX) risks.push({ level: "warn", text: `النسبة تتجاوز الحد الأقصى المعتمد ${FEE_MAX}%.` });

  const verdict: DealStudy["verdict"] = st.mortgage && !V ? "needs_info" : clientNet < 0 || (cover != null && cover < 1.1) ? "short" : clientNet < 20000 ? "tight" : "go";
  const headline =
    verdict === "go" ? `الصفقة تُغلق — أتعابنا ${fmt(fee)} ويبقى للعميل ${fmt(clientNet)}` :
    verdict === "tight" ? `تُغلق بهامش ضيق — أتعابنا ${fmt(fee)}` :
    verdict === "short" ? `لا تُغلق بالأرقام الحالية — عجز ${fmt(Math.max(0, -clientNet))}` :
    "ناقصة: نحتاج تقييم العقار";

  // ===== تفصيل الحساب =====
  const ex: DealStudy["explain"] = [];
  const pct = (v: number) => `${Math.round(v * 10000) / 100}%`;
  const bought = active.filter((i) => i.by === "bank");
  if (st.personal) {
    const G = "التمويل الشخصي الجديد";
    ex.push({ group: G, label: "الراتب الإجمالي", value: r0(salary) });
    const byRule = r0(salary * SAMA.salaryDeductionEmployee);
    if (personalInstallment < byRule) ex.push({ group: G, label: "أقصى قسط شخصي", note: `محدود بسقف الاستقطاع الكلي ${pct(totalCap)} ناقص الأقساط القائمة`, calc: `${fmt(salary)} × ${pct(totalCap)} − ${fmt(keptMonthly)}`, value: personalInstallment });
    else ex.push({ group: G, label: "أقصى قسط شخصي", note: `ساما: ${pct(SAMA.salaryDeductionEmployee)} من الراتب`, calc: `${fmt(salary)} × ${pct(SAMA.salaryDeductionEmployee)}`, value: personalInstallment });
    ex.push({ group: G, label: "مجموع الأقساط", note: `${personalMonths} شهراً (أقصى مدة للشخصي)`, calc: `${fmt(personalInstallment)} × ${personalMonths}`, value: personalInstallment * personalMonths });
    if (x.bankPersonal != null) ex.push({ group: G, label: `أصل التمويل (عرض ${x.personalLender || "البنك"})`, note: x.personalLenderKind === "finance_co" ? "شركة تمويل" : undefined, value: personal, tone: "total" });
    else ex.push({ group: G, label: "أصل التمويل", note: `هامش ثابت ${x.personalFlat}% سنوياً لمدة ${Math.round((personalMonths / 12) * 10) / 10} سنوات`, calc: `${fmt(personalInstallment * personalMonths)} ÷ (1 + ${x.personalFlat}% × ${Math.round((personalMonths / 12) * 10) / 10})`, value: personal, tone: "total" });
    for (const i of bought) ex.push({ group: G, label: `− شراء ${i.label.split("—")[0].trim()}${i.label.includes("—") ? ` (${i.label.split("—")[1].trim()})` : ""}`, note: "يسدده البنك الجديد من نفس التمويل", value: -r0(i.pay), tone: "minus" });
    ex.push({ group: G, label: "− رسوم إدارية", note: "1% بحد أقصى 5,000", calc: `${fmt(personal)} × 1%`, value: -adminFee(personal), tone: "minus" });
    ex.push({ group: G, label: "= صافي يستلمه العميل", value: personalCash, tone: "total" });
  }
  if (st.mortgage) {
    const G = "التمويل العقاري الجديد";
    ex.push({ group: G, label: "القسط العقاري المتاح", note: `سقف الاستقطاع ${pct(totalCap)} ناقص القسط الشخصي${keptMonthly ? " والأقساط القائمة" : ""}`, calc: `${fmt(salary)} × ${pct(totalCap)} − ${fmt(personalInstallment)}${keptMonthly ? ` − ${fmt(keptMonthly)}` : ""}`, value: pre });
    if (post !== pre) ex.push({ group: G, label: "القسط بعد التقاعد", note: `ضمن المعاش التقديري ${fmt(pension ?? 0)}`, value: post });
    ex.push({ group: G, label: "حد الدخل", note: `${maxM} شهراً بهامش ${x.mortgageApr}% متناقص`, value: mortgageByIncome });
    if (mortgageByLtv != null) ex.push({ group: G, label: "حد قيمة العقار", calc: `${fmt(V)} × ${x.ltvPct}%`, value: mortgageByLtv });
    ex.push({ group: G, label: x.bankMortgage != null ? "العقاري (عرض البنك)" : "العقاري = الأقل منهما", value: mortgage, tone: "total" });
    if (downPayment) ex.push({ group: G, label: "الدفعة الأولى (يدفعها العميل)", note: "سعر البيع ناقص العقاري", calc: `${fmt(price)} − ${fmt(mortgage)}`, value: downPayment });
  }
  {
    const G = "مستحقاتنا";
    for (const i of active.filter((i) => i.by === "company")) ex.push({ group: G, label: i.label, value: r0(i.pay), tone: "plus" });
    if (transferTax) ex.push({ group: G, label: "ضريبة التصرفات عند الإفراغ لطرفنا", calc: `${fmt(V)} × ${x.transferTaxPct}%`, value: transferTax, tone: "plus" });
    if (fixedCosts) ex.push({ group: G, label: "تكاليف ثابتة", value: fixedCosts, tone: "plus" });
    ex.push({ group: G, label: "= رأس المال الذي ندفعه", value: capital, tone: "total" });
    ex.push({ group: G, label: "+ أتعاب السداد", calc: `${fmt(settleBase)} × ${fx.settlePct}%`, value: feeSettle, tone: "plus" });
    ex.push({ group: G, label: "+ أتعاب استخراج التمويل", calc: `${fmt(financeBase)} × ${fx.financePct}%`, value: feeFinance, tone: "plus" });
    if (fx.fixed) ex.push({ group: G, label: "+ أتعاب مقطوعة", value: fx.fixed, tone: "plus" });
    if (companyFromSale) ex.push({ group: G, label: "− نسترده من ثمن بيع العقار للبنك", value: -r0(companyFromSale), tone: "minus" });
    ex.push({ group: G, label: "= المطلوب من العميل لنا", value: dueFromClient, tone: "total" });
  }
  {
    const G = "النتيجة";
    ex.push({ group: G, label: "صافي التمويل للعميل", value: personalCash, tone: "plus" });
    if (downPayment) ex.push({ group: G, label: "− الدفعة الأولى", value: -downPayment, tone: "minus" });
    ex.push({ group: G, label: "− المطلوب لنا", value: -dueFromClient, tone: "minus" });
    ex.push({ group: G, label: clientNet < 0 ? "= عجز" : "= يبقى للعميل", value: clientNet, tone: "total" });
  }

  // ===== الملخص المبسط =====
  const short = (l: string) => {
    const [kind, rest] = l.split("—").map((t) => t.replace(/\(\d{4}\/\d{2}\/\d{2}\)/g, "").replace(/\b\d{6,}\b/g, "").replace(/\s+/g, " ").trim());
    return rest ? `${kind} — ${rest}` : kind;
  };
  const obligations = active.map((i) => ({ label: short(i.label), amount: r0(i.pay), original: r0(i.original || 0), byBank: i.by === "bank" }));
  const discountTotal = r0(active.filter((i) => i.kind === "execution" || i.kind === "default" || i.kind === "card" || i.kind === "other").reduce((a, i) => a + Math.max(0, (i.original || 0) - (i.pay || 0)), 0));
  const pLabel = `شخصي${x.personalLender ? ` — ${x.personalLender}` : ""}${x.personalLenderKind === "finance_co" ? " (شركة تمويل)" : ""}`;
  const financingLines = [...(st.mortgage ? [{ label: "عقاري", amount: mortgage }] : []), ...(st.personal ? [{ label: pLabel, amount: personal }] : [])];
  const costs = [
    ...(st.personal ? [{ label: "رسوم إدارية للبنك", amount: adminFee(personal) }] : []),
    ...(transferTax ? [{ label: `ضريبة التصرفات ${x.transferTaxPct}%`, amount: transferTax }] : []),
    ...(saleTax ? [{ label: "ضريبة البيع للبنك", amount: saleTax }] : []),
    ...(fixedCosts ? [{ label: "تكاليف ثابتة (تقييم، رسوم)", amount: fixedCosts }] : []),
  ];
  const totalObligations = obligations.reduce((a, o) => a + o.amount, 0);
  const totalFinancing = mortgage + personal;
  const afterSettle = r0(totalFinancing - totalObligations - costs.reduce((a, c) => a + c.amount, 0));
  const summary = {
    obligations, totalObligations, discountTotal,
    kept: kept.map((i) => ({ label: short(i.label).replace(/^مخالصة\s+/, ""), monthly: i.monthly ?? null, amount: r0(i.pay), kind: i.kind })),
    keptExecutions: r0(keptExec.reduce((a, i) => a + i.pay, 0)),
    financing: financingLines, totalFinancing, costs, afterSettle, net: r0(afterSettle - fee),
  };

  return {
    structure, keptMonthly, explain: ex, summary,
    verdict, headline, paidByCompany: r0(paidByCompany), paidByBank: r0(paidByBank), transferTax, saleTax, capital,
    financing: { age, monthsToRetire, pension, personalInstallment, personalMonths, personal, mortgagePre: pre, mortgagePost: post, mortgageMonths: maxM, mortgageByIncome, mortgageByLtv, mortgage, source, dbrAfter },
    waterfall, downPayment, personalCash, fee, feeSettle, feeFinance, settleBase, financeBase, suggestedPct, suggestedWhy: why, dueFromClient, clientNet, surplusBeforeFee, roi, days, annualized, cover, breakEvenDiscount, risks,
    steps: steps.map(([stage, label, d]) => ({ stage, label, days: d })),
  };
}

// ===== مقارنة الهياكل والحلول البديلة =====
type Credit = Parameters<typeof dealStudy>[2];

export function compareStructures(x: DealInput, b: Borrower, credit?: Credit) {
  return STRUCTURE_KEYS.map((k) => ({ structure: k, s: dealStudy({ ...x, structure: k }, b, credit) }));
}

export interface Alternative { title: string; detail: string; tone: "good" | "maybe" | "no"; patch?: Partial<DealInput> }

/** أصغر قيمة t في [lo,hi] تجعل f(t) ≥ 0 (f متزايدة)، أو null */
function solve(f: (t: number) => number, lo: number, hi: number) {
  if (f(hi) < 0) return null;
  if (f(lo) >= 0) return lo;
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (f(m) >= 0) hi = m; else lo = m; }
  return hi;
}
const discounted = (x: DealInput, d: number): DealItem[] => x.items.map((i) => i.by === "company" && (i.kind === "execution" || i.kind === "default") ? { ...i, pay: r0(i.pay * (1 - d)) } : i);

/** حلول بديلة تلقائية عندما لا يقفل الهيكل الحالي */
export function dealAlternatives(x: DealInput, b: Borrower, credit?: Credit): Alternative[] {
  const cur = dealStudy(x, b, credit);
  const out: Alternative[] = [];
  const st = STRUCTURES[cur.structure];
  // 1) هياكل أخرى
  for (const { structure, s } of compareStructures(x, b, credit)) {
    if (structure === cur.structure) continue;
    if (s.verdict === "go" || s.verdict === "tight")
      out.push({ tone: "good", title: `«${STRUCTURES[structure].label}» يقفل`, detail: `يبقى للعميل ${fmt(s.clientNet)} ريال وأتعابنا ${fmt(s.fee)}. اعرضه على العميل إذا قبل بهذا الهيكل.`, patch: { structure } });
  }
  if (cur.verdict === "go" || cur.verdict === "needs_info") return out;
  const net = (p: Partial<DealInput>, bb: Borrower = b) => dealStudy({ ...x, ...p }, bb, credit).clientNet;

  // 2) خصم التسوية (مع إعادة حساب الأتعاب)
  const covered = (d: number) => discounted(x, d).filter((i) => i.by === "company" && (i.kind === "execution" || i.kind === "default")).reduce((a, i) => a + i.pay, 0);
  const d = solve((t) => net({ items: discounted(x, t) }), 0, 0.95);
  if (d != null && d > 0) {
    const pct = Math.ceil(d * 100);
    out.push({ tone: pct <= 35 ? "good" : pct <= 55 ? "maybe" : "no", title: `خصم ${pct}% على التنفيذ والتعثرات يقفل الصفقة`, detail: `يعني نسدد ≈ ${fmt(covered(d))} بدل ${fmt(covered(0))}. ${pct <= 35 ? "خصم واقعي مع شركات التمويل وطالبي التنفيذ، ابدأ التفاوض." : pct <= 55 ? "خصم كبير؛ ممكن مع ديون قديمة أو شركات تحصيل فقط." : "خصم غير واقعي غالباً."}`, patch: { items: discounted(x, d) } });
  }
  // 3) الأتعاب
  const fx = normFee(x.fee);
  if (fx.settlePct > FEE_MIN || fx.financePct > FEE_MIN || fx.fixed) {
    const minFee = { ...fx, settlePct: FEE_MIN, financePct: FEE_MIN, fixed: 0 };
    const n = net({ fee: minFee });
    out.push(n >= 0
      ? { tone: "good", title: `تخفيض الأتعاب إلى ${FEE_MIN}% + ${FEE_MIN}% يقفلها`, detail: `يبقى للعميل ${fmt(n)} ريال.`, patch: { fee: minFee } }
      : { tone: "no", title: "تخفيض الأتعاب للحد الأدنى لا يكفي", detail: `يبقى عجز ${fmt(-n)} ريال حتى بأقل نسبة.` });
  }
  const zero = net({ fee: { ...fx, settlePct: 0, financePct: 0, fixed: 0 } });
  if (zero < 0) out.push({ tone: "no", title: "حتى بدون أي أتعاب لا تقفل", detail: `يبقى عجز ${fmt(-zero)} ريال؛ المشكلة في قدرة التمويل لا في نسبتنا.` });
  // 4) شخصي فقط: كم يغطي التمويل فعلاً؟
  if (!st.mortgage && d == null) {
    const s0 = dealStudy({ ...x, items: discounted(x, 0.95) }, b, credit);
    out.push({ tone: "no", title: "التمويل الشخصي لا يغطي حتى 5% من المتعثرات", detail: `صافي الشخصي ${fmt(s0.personalCash)} ريال فقط.` });
  }
  if (!st.mortgage) {
    const room = cur.personalCash - cur.feeFinance;
    const cap = Math.max(0, r0(room / (1 + fx.settlePct / 100)));
    out.push({ tone: "maybe", title: `الشخصي يغطي سداد ≈ ${fmt(cap)} فقط من المتعثرات`, detail: `من أصل ${fmt(cur.settleBase)}. ممكن سداد جزئي (القرارات الأصغر أولاً) لكن الإيقاف لا يُرفع إلا بسداد كل قرارات التنفيذ.` });
  }
  // 4ب) إبقاء الشخصي القائم وأخذ تمويل إضافي بدل شرائه
  const boughtP = splitItems(x).active.filter((i) => i.by === "bank");
  if (st.personal && boughtP.length && boughtP.every((i) => i.monthly)) {
    const left = Math.max(0, cur.financing.personalInstallment - boughtP.reduce((a, i) => a + (i.monthly || 0), 0));
    const top = r0(principalFrom(left, cur.financing.personalMonths, x.personalFlat, "flat"));
    const netTop = top - adminFee(top);
    out.push({ tone: netTop > cur.personalCash ? "maybe" : "no", title: `إبقاء الشخصي القائم وأخذ تمويل إضافي: صافي ≈ ${fmt(netTop)}`, detail: `يبقى ${fmt(left)} فقط من سقف القسط الشخصي، مقابل صافي ${fmt(cur.personalCash)} لو اشترى البنك الشخصي القائم. ${netTop > cur.personalCash ? "الإبقاء أفضل هنا." : "الشراء أفضل."}` });
  }
  // 5) العقار: تقييم أعلى أو متضامن
  if (st.mortgage && x.propertyValue) {
    const f = cur.financing;
    if (f.mortgageByLtv != null && f.mortgageByLtv <= f.mortgageByIncome) {
      const v = solve((t) => net({ propertyValue: t }), x.propertyValue, x.propertyValue * 2);
      if (v != null) out.push({ tone: v <= x.propertyValue * 1.15 ? "maybe" : "no", title: `تقييم ${fmt(v)} يقفل الصفقة`, detail: `أعلى بـ ${Math.round((v / x.propertyValue - 1) * 100)}% من الحالي. اطلب تقييماً معتمداً ثانياً إن كان السوق يسمح.` });
    } else {
      // المتضامن يرفع العقاري فقط؛ الشخصي يبقى على راتب العميل
      const keepP = st.personal ? { bankPersonal: x.bankPersonal ?? f.personal } : {};
      const add = solve((t) => net(keepP, { ...b, totalSalary: (b.totalSalary ?? b.basicSalary ?? 0) + t }), 0, 40000);
      if (add != null && add > 0) out.push({ tone: "maybe", title: `متضامن في العقاري براتب ≈ ${fmt(Math.ceil(add / 500) * 500)} يقفلها`, detail: "زوج أو قريب يدخل متضامناً في التمويل العقاري؛ يرفع مبلغ العقاري ويسد العجز." });
    }
  }
  return out;
}
