// محرك الأهلية والمطابقة — دوال نقية بلا اعتماد على قاعدة البيانات حتى يسهل اختبارها.
// المرجع: مبادئ التمويل المسؤول للأفراد (ساما) — الفصل الرابع، الفقرات 13–19، والمادة 14.

export type Sector = "gov" | "semi_gov" | "private_approved" | "private" | "military" | "retired" | "self";
export type FinanceType = "personal" | "mortgage" | "auto" | "sme" | "card";
export type Simah = "clean" | "late" | "default" | "unknown";

export interface Obligation {
  kind: "personal" | "mortgage" | "auto" | "card" | "other";
  lender?: string;
  monthly: number;
  remaining?: number;
}

export interface Profile {
  age: number | null;
  nationality: "saudi" | "non_saudi";
  sector: Sector;
  serviceMonths: number | null;
  basicSalary: number | null;
  totalSalary: number | null;
  otherIncome?: number | null; // متوسط شهري لدخل دوري موثق بكشف سنتين
  salaryBank?: string | null;
  simah: Simah;
  housingSupport?: boolean; // مستفيد من وزارة الإسكان / صندوق التنمية العقارية
  financeType: FinanceType;
  requestedAmount?: number | null;
  requestedTenor?: number | null;
  obligations: Obligation[];
  firstHome?: boolean | null; // للعقاري: المسكن الأول للمواطن يرفع نسبة التمويل إلى 90%
  propertyValue?: number | null; // قيمة العقار/السيارة إن عُرفت
  coIncome?: number | null; // دخل المتضامن (الزوج/الزوجة) — يُقبل غالباً في العقاري فقط
}

export interface Product {
  id: string;
  lenderId: string;
  lenderName: string;
  lenderType: "bank" | "finance_company";
  bankCode?: string | null; // لمطابقة بنك تحويل الراتب
  financeType: FinanceType;
  name: string;
  minSalary: number;
  minAge: number;
  maxAgeAtMaturity: number;
  minServiceMonths: number;
  sectors: Sector[];
  nationalities: ("saudi" | "non_saudi")[];
  maxTenor: number; // بالأشهر
  maxAmount: number;
  rate: number; // سنوي %
  rateType: "flat" | "reducing";
  requiresSalaryTransfer: boolean;
  acceptsLateSimah: boolean;
  maxLtv?: number | null;
  notes?: string | null;
}

export const SAMA = {
  salaryDeductionEmployee: 0.3333,
  salaryDeductionRetired: 0.25,
  nonRealEstateCap: 0.45,
  totalCapLow: 0.55, // دخل حتى 15,000
  totalCapLowHousing: 0.65, // مستفيد إسكان/صندوق
  totalCapMid: 0.65, // أكثر من 15,000 وأقل من 25,000
  consumerMaxTenor: 60,
  lowBracket: 15000,
  highBracket: 25000,
  ltvFirstHomeCitizen: 90, // تعميم ساما 2018: المسكن الأول للمواطن
  ltvSecondHome: 70, // المسكن الثاني
  ltvOther: 85, // الثالث فما فوق
  retirementAge: 60,
  pensionAccrual: 0.025, // 2.5% من الأساسي عن كل سنة خدمة (تقدير يقارب نظام التقاعد المدني/التأمينات)
  source: "ساما — مبادئ التمويل المسؤول للأفراد، الفصل الرابع ف13–19، تعميم 40694/1 (1439هـ)؛ تعميم ساما لنسب التمويل العقاري (2018)؛ قواعد السداد المبكر",
} as const;

// ===== أدوات مالية دقيقة =====
/** النسبة السنوية الفعلية (APR تقريبي = IRR شهري × 12) لقسط ثابت */
export function aprOf(principal: number, installment: number, months: number) {
  if (principal <= 0 || installment <= 0 || months <= 0 || installment * months <= principal) return 0;
  let lo = 0, hi = 1; // شهري
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const pv = (installment * (1 - Math.pow(1 + mid, -months))) / mid;
    if (pv > principal) lo = mid; else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 12 * 10000) / 100;
}
/** رسوم إدارية: 1% بحد أقصى 5,000 (حد ساما للتمويل الاستهلاكي والعقاري) */
export function adminFee(principal: number) {
  return Math.min(5000, Math.round(principal * 0.01));
}
/** الرصيد المتبقي بعد k قسط (على أساس النسبة الفعلية) */
export function balanceAfter(principal: number, apr: number, months: number, k: number) {
  const r = apr / 100 / 12;
  if (r === 0) return principal * (1 - k / months);
  const inst = (principal * r) / (1 - Math.pow(1 + r, -months));
  return principal * Math.pow(1 + r, k) - (inst * (Math.pow(1 + r, k) - 1)) / r;
}
/** تكلفة السداد المبكر حسب ساما: أقصاه تكلفة الأجل لثلاثة أشهر لاحقة على الرصيد المتناقص */
export function earlySettlement(principal: number, apr: number, months: number, afterMonths: number) {
  const bal = Math.max(0, balanceAfter(principal, apr, months, afterMonths));
  const fee = bal * (apr / 100 / 12) * 3;
  return { balance: Math.round(bal), fee: Math.round(fee), total: Math.round(bal + fee) };
}
/** تقدير المعاش التقاعدي من الراتب الأساسي وسنوات الخدمة عند التقاعد */
export function pensionEstimate(basic: number, serviceYearsAtRetirement: number) {
  return Math.round(basic * Math.min(1, Math.max(0, serviceYearsAtRetirement) * SAMA.pensionAccrual));
}

export type CheckStatus = "pass" | "warn" | "fail";
export interface Check {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface Capacity {
  income: number;
  incomeBasis: string;
  existingTotal: number;
  existingNonRealEstate: number;
  existingMortgage: number;
  salaryDeductionCap: number; // نسبة
  totalCap: number | null; // نسبة أو null = حسب سياسة الجهة
  capUsed: number; // النسبة الحاكمة للمنتج المطلوب
  maxInstallment: number;
  available: number;
  currentDbr: number;
  bindingRule: string;
  warnings: string[];
}

const round = (n: number, d = 0) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

export function incomeOf(p: Profile) {
  const salary = p.totalSalary ?? p.basicSalary ?? 0;
  const other = Math.max(0, p.otherIncome ?? 0) * 0.5; // ف14(ب): نصف متوسط الدخل الدوري
  const co = p.financeType === "mortgage" ? Math.max(0, p.coIncome ?? 0) : 0; // تمويل مشترك (متضامن)
  return { salary, other, co, total: salary + other + co };
}

export function capacity(p: Profile): Capacity {
  const warnings: string[] = [];
  const { salary, other, co, total } = incomeOf(p);
  if (!p.totalSalary && p.basicSalary) warnings.push("لم يُدخل الراتب الإجمالي؛ اعتُمد الأساسي (تقدير متحفظ).");
  const obligations = p.obligations ?? [];
  const existingMortgage = obligations.filter((o) => o.kind === "mortgage").reduce((s, o) => s + (o.monthly || 0), 0);
  const existingTotal = obligations.reduce((s, o) => s + (o.monthly || 0), 0);
  const existingNonRealEstate = existingTotal - existingMortgage;
  const retired = p.sector === "retired";
  const salaryDeductionCap = retired ? SAMA.salaryDeductionRetired : SAMA.salaryDeductionEmployee;

  let totalCap: number | null;
  if (total <= SAMA.lowBracket) totalCap = p.housingSupport ? SAMA.totalCapLowHousing : SAMA.totalCapLow;
  else if (total < SAMA.highBracket) totalCap = SAMA.totalCapMid;
  else totalCap = null;

  // كل قاعدة تعطي القسط الإضافي المتاح؛ الحاكم هو الأقل
  const rules: { avail: number; label: string; cap: number }[] = [];
  if (p.financeType === "mortgage") {
    const c = totalCap ?? 0.65;
    if (totalCap === null) warnings.push("الدخل 25,000 فأكثر: السقف الكلي حسب سياسة الجهة؛ استُخدم 65% افتراضاً ⚠️");
    rules.push({ avail: total * c - existingTotal, label: `السقف الكلي ${round(c * 100)}% من الدخل (يشمل العقاري)`, cap: c });
  } else {
    // ف15–17(أ): الاستقطاع المرتبط بالراتب يشمل كل الأقساط الاستهلاكية والبطاقات
    rules.push({ avail: salary * salaryDeductionCap - existingNonRealEstate, label: `${retired ? "25% من المعاش" : "33.33% من الراتب الإجمالي"}`, cap: salaryDeductionCap });
    if (total < SAMA.highBracket) rules.push({ avail: total * SAMA.nonRealEstateCap - existingNonRealEstate, label: "45% للالتزامات غير العقارية", cap: SAMA.nonRealEstateCap });
    if (totalCap !== null) rules.push({ avail: total * totalCap - existingTotal, label: `السقف الكلي ${round(totalCap * 100)}%`, cap: totalCap });
  }
  const binding = rules.reduce((a, b) => (b.avail < a.avail ? b : a));
  const available = Math.max(0, binding.avail);
  const capUsed = binding.cap;
  const bindingRule = binding.label;
  const relevantExisting = p.financeType === "mortgage" ? existingTotal : existingNonRealEstate;
  const maxInstallment = available + relevantExisting;
  return {
    income: round(total),
    incomeBasis: [other > 0 || co > 0 ? `راتب ${fmt(salary)}` : "الراتب الإجمالي", other > 0 ? `نصف الدخل الآخر ${fmt(other)}` : "", co > 0 ? `دخل المتضامن ${fmt(co)}` : ""].filter(Boolean).join(" + "),
    existingTotal: round(existingTotal),
    existingNonRealEstate: round(existingNonRealEstate),
    existingMortgage: round(existingMortgage),
    salaryDeductionCap,
    totalCap,
    capUsed,
    maxInstallment: round(maxInstallment),
    available: round(available),
    currentDbr: total > 0 ? round((existingTotal / total) * 100, 1) : 0,
    bindingRule,
    warnings,
  };
}

/** أصل التمويل الممكن من قسط شهري ومدة ونسبة */
export function principalFrom(installment: number, months: number, rate: number, type: "flat" | "reducing") {
  if (installment <= 0 || months <= 0) return 0;
  if (type === "flat") {
    const years = months / 12;
    return (installment * months) / (1 + (rate / 100) * years);
  }
  const r = rate / 100 / 12;
  if (r === 0) return installment * months;
  return (installment * (1 - Math.pow(1 + r, -months))) / r;
}

export function installmentFor(principal: number, months: number, rate: number, type: "flat" | "reducing") {
  if (principal <= 0 || months <= 0) return 0;
  if (type === "flat") return (principal * (1 + (rate / 100) * (months / 12))) / months;
  const r = rate / 100 / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

export interface Match {
  product: Product;
  checks: Check[];
  verdict: CheckStatus;
  score: number;
  tenor: number;
  maxPrincipal: number;
  offerPrincipal: number;
  installment: number;
  totalCost: number;
  // مؤشرات مالية دقيقة
  apr: number; // النسبة السنوية الفعلية
  totalProfit: number;
  fee: number; // الرسوم الإدارية
  settle12: { balance: number; fee: number; total: number } | null; // سداد مبكر بعد سنة
  limitedBy: string; // ما الذي حدّ المبلغ
  ltv?: { pct: number; down: number | null; propertyMax: number | null } | null;
  retirement?: { atMonth: number; pension: number; before: number; after: number; note: string } | null;
}

const sectorLabel: Record<Sector, string> = {
  gov: "حكومي",
  semi_gov: "شبه حكومي",
  private_approved: "خاص معتمد",
  private: "خاص غير معتمد",
  military: "عسكري",
  retired: "متقاعد",
  self: "صاحب عمل حر",
};

/** نسبة التمويل إلى القيمة النظامية لعميل عقاري */
export function regulatoryLtv(p: Profile) {
  if (p.nationality === "saudi" && p.firstHome !== false) return SAMA.ltvFirstHomeCitizen;
  if (p.firstHome === false) return SAMA.ltvSecondHome;
  return SAMA.ltvSecondHome;
}

export function matchProduct(p: Profile, cap: Capacity, prod: Product): Match {
  const checks: Check[] = [];
  const salary = p.totalSalary ?? p.basicSalary ?? 0;
  const add = (key: string, label: string, status: CheckStatus, detail: string) => checks.push({ key, label, status, detail });
  const isMortgage = prod.financeType === "mortgage";

  if (!salary) add("salary", "الحد الأدنى للراتب", "warn", "الراتب غير مدخل");
  else add("salary", "الحد الأدنى للراتب", salary >= prod.minSalary ? "pass" : "fail", `${fmt(salary)} مقابل حد أدنى ${fmt(prod.minSalary)}`);

  add("sector", "تصنيف جهة العمل", prod.sectors.includes(p.sector) ? "pass" : "fail", `${sectorLabel[p.sector]}${prod.sectors.includes(p.sector) ? " مقبول" : " غير مشمول بهذا المنتج"}`);
  add("nationality", "الجنسية", prod.nationalities.includes(p.nationality) ? "pass" : "fail", p.nationality === "saudi" ? "سعودي" : "غير سعودي");

  let tenor = Math.min(prod.maxTenor, p.requestedTenor || prod.maxTenor);
  if (!isMortgage && prod.financeType !== "card") tenor = Math.min(tenor, SAMA.consumerMaxTenor);
  if (p.age == null) add("age", "العمر", "warn", "العمر غير مدخل");
  else if (p.age < prod.minAge) add("age", "العمر", "fail", `${p.age} أقل من ${prod.minAge}`);
  else {
    const monthsLeft = (prod.maxAgeAtMaturity - p.age) * 12;
    if (monthsLeft <= 0) add("age", "العمر عند نهاية التمويل", "fail", `يتجاوز ${prod.maxAgeAtMaturity} سنة`);
    else if (monthsLeft < tenor) {
      tenor = monthsLeft;
      add("age", "العمر عند نهاية التمويل", "warn", `المدة قُصّرت إلى ${tenor} شهراً حتى لا يتجاوز ${prod.maxAgeAtMaturity} سنة`);
    } else add("age", "العمر عند نهاية التمويل", "pass", `${round(p.age + tenor / 12, 1)} سنة ≤ ${prod.maxAgeAtMaturity}`);
  }

  if (p.sector === "retired") add("service", "مدة الخدمة", "pass", "متقاعد — لا تنطبق");
  else if (p.serviceMonths == null) add("service", "مدة الخدمة", "warn", "غير مدخلة");
  else add("service", "مدة الخدمة", p.serviceMonths >= prod.minServiceMonths ? "pass" : "fail", `${p.serviceMonths} شهر مقابل ${prod.minServiceMonths}`);

  if (p.simah === "clean") add("simah", "السجل الائتماني", "pass", "سليم");
  else if (p.simah === "unknown") add("simah", "السجل الائتماني", "warn", "لم يُستخرج تقرير سمة بعد");
  else if (p.simah === "late") add("simah", "السجل الائتماني", prod.acceptsLateSimah ? "warn" : "fail", prod.acceptsLateSimah ? "تأخر سداد — يقبل بشروط" : "تأخر سداد — لا يقبل");
  else add("simah", "السجل الائتماني", "fail", "متعثر — يلزم السداد والمخالصة أولاً");

  if (prod.requiresSalaryTransfer) {
    const same = !!p.salaryBank && !!prod.bankCode && p.salaryBank === prod.bankCode;
    add("transfer", "تحويل الراتب", same ? "pass" : "warn", same ? "الراتب محول لنفس الجهة" : "يتطلب تحويل الراتب للجهة");
  }

  // النسبة الفعلية للمنتج (المتناقصة كما هي؛ الثابتة تُحوّل لاحقاً)
  const tenorInt = Math.max(0, Math.floor(tenor));
  let limitedBy = "القسط المتاح ضمن حدود ساما";
  let maxPrincipal = principalFrom(cap.available, tenorInt, prod.rate, prod.rateType);

  // ===== التقاعد أثناء مدة التمويل (عقاري غالباً) — قسط متدرج على المعاش المتوقع =====
  let retirement: Match["retirement"] = null;
  const employee = !["retired", "self"].includes(p.sector);
  if (employee && p.age != null && tenorInt > 0) {
    const monthsToRet = Math.max(0, Math.round((SAMA.retirementAge - p.age) * 12));
    if (monthsToRet < tenorInt) {
      const basic = p.basicSalary ?? salary * 0.65;
      const svcYearsAtRet = ((p.serviceMonths ?? 0) + monthsToRet) / 12;
      const pension = pensionEstimate(basic, svcYearsAtRet) + (p.financeType === "mortgage" ? Math.max(0, p.coIncome ?? 0) : 0);
      const capRatio = isMortgage ? (cap.capUsed || 0.55) : SAMA.salaryDeductionRetired;
      const after = Math.max(0, pension * capRatio - (isMortgage ? cap.existingMortgage : 0));
      const before = cap.available;
      const apr0 = prod.rateType === "reducing" ? prod.rate : aprOf(100000, installmentFor(100000, tenorInt, prod.rate, "flat"), tenorInt);
      const r = apr0 / 100 / 12;
      const pv = (a: number, n: number) => (n <= 0 ? 0 : r === 0 ? a * n : (a * (1 - Math.pow(1 + r, -n))) / r);
      const stepped = pv(before, monthsToRet) + pv(Math.min(after, before), tenorInt - monthsToRet) / Math.pow(1 + r, monthsToRet);
      if (stepped < maxPrincipal) {
        maxPrincipal = stepped;
        limitedBy = "انخفاض الدخل بعد التقاعد (قسط متدرج)";
      }
      retirement = {
        atMonth: monthsToRet,
        pension,
        before: round(before),
        after: round(Math.min(after, before)),
        note: `يبلغ ${SAMA.retirementAge} بعد ${monthsToRet} شهراً؛ المعاش المتوقع ≈ ${fmt(pension)} ريال، فيُخفَّض القسط بعده إلى ≈ ${fmt(Math.min(after, before))}`,
      };
      add("retire", "التقاعد خلال مدة التمويل", after < before * 0.5 ? "warn" : "pass", retirement.note);
    }
  }

  // ===== نسبة التمويل إلى القيمة (عقاري) =====
  let ltv: Match["ltv"] = null;
  if (isMortgage) {
    const pct = Math.min(prod.maxLtv ?? 100, regulatoryLtv(p));
    const pv = p.propertyValue ?? null;
    const propertyMax = pv ? Math.floor(pv * (pct / 100)) : null;
    if (propertyMax != null && propertyMax < maxPrincipal) {
      maxPrincipal = propertyMax;
      limitedBy = `نسبة التمويل ${pct}% من قيمة العقار`;
    }
    ltv = { pct, down: pv ? Math.max(0, pv - Math.min(propertyMax ?? 0, maxPrincipal)) : null, propertyMax };
    add("ltv", "الدفعة الأولى", "pass", pv ? `يمول حتى ${pct}% من ${fmt(pv)} — دفعة أولى ≈ ${fmt(ltv.down)} ريال` : `يمول حتى ${pct}% من قيمة العقار (دفعة أولى ${100 - pct}%)`);
  }

  if (prod.maxAmount < maxPrincipal) {
    maxPrincipal = prod.maxAmount;
    limitedBy = "الحد الأعلى لمنتج الجهة";
  }

  add(
    "dbr",
    "نسبة الاستقطاع",
    cap.available <= 0 ? "fail" : maxPrincipal < Math.min(p.requestedAmount || 0, prod.maxAmount) ? "warn" : "pass",
    cap.available <= 0 ? "لا يوجد قسط متاح ضمن حدود ساما" : `قسط متاح ${fmt(cap.available)} ريال (${cap.bindingRule})`,
  );

  const requested = p.requestedAmount || 0;
  const offerPrincipal = Math.floor(Math.max(0, requested > 0 ? Math.min(requested, maxPrincipal) : maxPrincipal) / 1000) * 1000;
  let installment = installmentFor(offerPrincipal, tenorInt, prod.rate, prod.rateType);
  if (retirement && offerPrincipal > 0 && installment > cap.available) installment = cap.available;
  const apr = prod.rateType === "reducing" ? prod.rate : aprOf(offerPrincipal, installment, tenorInt);
  const totalCost = retirement && offerPrincipal > 0
    ? (() => {
        // جدول متدرج: قسط قبل التقاعد ثم بعده بنفس النسبة الفعلية
        const r = apr / 100 / 12, n1 = retirement.atMonth, n2 = tenorInt - n1;
        const a1 = installmentFor(offerPrincipal, tenorInt, prod.rate, prod.rateType);
        if (a1 <= retirement.after || r === 0) { retirement.after = round(a1); return a1 * tenorInt; }
        // بعد التقاعد: أعلى قسط يتحمله المعاش، وقبله القسط اللازم لتغطية الباقي
        const a2 = retirement.after;
        const pv2 = ((a2 * (1 - Math.pow(1 + r, -n2))) / r) / Math.pow(1 + r, n1);
        const pre = ((offerPrincipal - pv2) * r) / (1 - Math.pow(1 + r, -n1));
        installment = Math.min(cap.available, pre);
        return installment * n1 + a2 * n2;
      })()
    : installment * tenorInt;

  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  const verdict: CheckStatus = fails ? "fail" : warns ? "warn" : "pass";
  const coverage = requested > 0 ? Math.min(1, maxPrincipal / requested) : 1;
  let score = 100 - fails * 30 - warns * 8;
  score = score * (0.6 + 0.4 * coverage) - apr * 2.5;
  if (prod.bankCode && p.salaryBank === prod.bankCode) score += 8;
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    product: prod,
    checks,
    verdict,
    score,
    tenor: tenorInt,
    maxPrincipal: Math.floor(Math.max(0, maxPrincipal) / 1000) * 1000,
    offerPrincipal,
    installment: round(installment),
    totalCost: round(totalCost),
    apr,
    totalProfit: round(Math.max(0, totalCost - offerPrincipal)),
    fee: adminFee(offerPrincipal),
    settle12: offerPrincipal > 0 && tenorInt > 12 ? earlySettlement(offerPrincipal, apr, tenorInt, 12) : null,
    limitedBy,
    ltv,
    retirement,
  };
}

export interface Study {
  capacity: Capacity;
  matches: Match[];
  verdict: "eligible" | "conditional" | "not_eligible" | "pending";
  headline: string;
  strengths: string[];
  risks: string[];
  recommendations: string[];
  missingData: string[];
}

export function study(p: Profile, products: Product[]): Study {
  const cap = capacity(p);
  const relevant = products.filter((x) => x.financeType === p.financeType);
  const matches = relevant.map((x) => matchProduct(p, cap, x)).sort((a, b) => rank(b) - rank(a));
  const missingData: string[] = [];
  if (p.age == null) missingData.push("العمر / تاريخ الميلاد");
  if (!p.totalSalary) missingData.push("الراتب الإجمالي (تعريف راتب حديث)");
  if (p.serviceMonths == null && p.sector !== "retired") missingData.push("مدة الخدمة");
  if (p.simah === "unknown") missingData.push("تقرير سمة");
  if (!p.salaryBank) missingData.push("البنك المحول عليه الراتب");
  if (!p.requestedAmount) missingData.push("المبلغ المطلوب");

  const strengths: string[] = [];
  const risks: string[] = [];
  const recs: string[] = [];
  if (["gov", "military", "semi_gov"].includes(p.sector)) strengths.push("جهة عمل حكومية/شبه حكومية — تصنيف مفضل لدى أغلب الجهات");
  if (p.sector === "private_approved") strengths.push("جهة عمل خاصة معتمدة لدى الجهات");
  if (p.sector === "private") risks.push("جهة عمل غير معتمدة — خيارات أقل ونسب أعلى");
  if (p.simah === "clean") strengths.push("سجل ائتماني سليم");
  if (p.simah === "late") risks.push("تأخر سداد في سمة");
  if (p.simah === "default") {
    risks.push("تعثر في سمة يمنع أغلب الجهات");
    recs.push("سداد المتعثرات واستخراج مخالصة وتحديث سمة قبل أي تقديم.");
  }
  if (cap.currentDbr > 0) (cap.currentDbr >= 33 ? risks : strengths).push(`نسبة الالتزامات الحالية ${cap.currentDbr}% من الدخل`);
  if (cap.available <= 0) {
    risks.push("لا يوجد هامش استقطاع متاح ضمن حدود ساما");
    const smallest = [...p.obligations].filter((o) => o.kind !== "mortgage").sort((a, b) => (a.remaining ?? Infinity) - (b.remaining ?? Infinity))[0];
    if (smallest) recs.push(`سداد الالتزام الأصغر (${smallest.lender || smallest.kind}) أو إعادة الجدولة لرفع القسط المتاح.`);
  }
  if (p.serviceMonths != null && p.serviceMonths < 3 && p.sector !== "retired") risks.push("مدة خدمة أقل من 3 أشهر");
  if (p.salaryBank) recs.push("البدء بالبنك المحول عليه الراتب عادةً أسرع وبنسبة أفضل؛ قارن عرضه بأفضل بديل قبل نقل الراتب.");

  const passing = matches.filter((m) => m.verdict === "pass");
  const warnOnly = matches.filter((m) => m.verdict === "warn");
  let verdict: Study["verdict"];
  if (missingData.length >= 3) verdict = "pending";
  else if (passing.length) verdict = "eligible";
  else if (warnOnly.length) verdict = "conditional";
  else verdict = "not_eligible";

  const best = matches.find((m) => m.verdict !== "fail");
  if (best) {
    recs.unshift(`أفضل خيار حالي: ${best.product.lenderName} — ${best.product.name} بمبلغ تقريبي ${fmt(best.offerPrincipal)} ريال وقسط ${fmt(best.installment)} لمدة ${best.tenor} شهراً.`);
    const order = matches.filter((m) => m.verdict !== "fail").slice(0, 3).map((m) => m.product.lenderName);
    if (order.length > 1) recs.push(`ترتيب التقديم المقترح: ${order.join(" ← ")} (تقديم متتابع لا متزامن لتجنب كثرة الاستعلامات في سمة).`);
    if (p.requestedAmount && best.maxPrincipal < p.requestedAmount)
      recs.push(`المبلغ المطلوب (${fmt(p.requestedAmount)}) أعلى من الممكن (${fmt(best.maxPrincipal)}). خيارات: إضافة متضامن، أو مدة أطول، أو خفض المبلغ.`);
  }
  if (missingData.length) recs.push(`استكمال البيانات الناقصة: ${missingData.join("، ")}.`);

  const headline =
    verdict === "eligible"
      ? `مؤهل لدى ${passing.length} جهة/منتج`
      : verdict === "conditional"
        ? `مؤهل بشروط لدى ${warnOnly.length} جهة/منتج`
        : verdict === "pending"
          ? "بيانات غير كافية للحكم"
          : "غير مؤهل حالياً";

  return { capacity: cap, matches, verdict, headline, strengths, risks, recommendations: recs, missingData };
}

function rank(m: Match) {
  // المؤهل والمؤهل بشروط يتنافسان على الملاءمة (التكلفة والتغطية)، وغير المؤهل آخراً
  return (m.verdict === "fail" ? 0 : 1000) + m.score + (m.verdict === "pass" ? 5 : 0);
}

export function fmt(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

// ===== المستندات المطلوبة حسب نوع التمويل والقطاع =====
export interface DocReq {
  code: string;
  label: string;
  category: "identity" | "income" | "obligations" | "collateral" | "business";
  required: boolean;
}

export function requiredDocuments(financeType: FinanceType, sector: Sector, nationality: "saudi" | "non_saudi"): DocReq[] {
  const d: DocReq[] = [
    { code: "id", label: nationality === "saudi" ? "صورة الهوية الوطنية" : "صورة الإقامة سارية", category: "identity", required: true },
    { code: "address", label: "العنوان الوطني", category: "identity", required: true },
    { code: "simah", label: "تقرير سمة حديث", category: "obligations", required: true },
    { code: "obligations", label: "جداول الأقساط القائمة / خطابات المديونية", category: "obligations", required: false },
  ];
  if (sector === "self") {
    d.push({ code: "cr", label: "السجل التجاري", category: "business", required: true });
    d.push({ code: "fin_statements", label: "القوائم المالية آخر سنتين", category: "business", required: true });
    d.push({ code: "zakat", label: "شهادة الزكاة", category: "business", required: true });
    d.push({ code: "bank_12", label: "كشف حساب آخر 12 شهراً", category: "income", required: true });
  } else if (sector === "retired") {
    d.push({ code: "pension", label: "تعريف بالمعاش التقاعدي", category: "income", required: true });
    d.push({ code: "bank_3", label: "كشف حساب آخر 3 أشهر", category: "income", required: true });
  } else {
    d.push({ code: "salary_cert", label: "تعريف بالراتب (لا يتجاوز شهراً)", category: "income", required: true });
    d.push({ code: "bank_3", label: "كشف حساب آخر 3–6 أشهر", category: "income", required: true });
    if (sector === "private" || sector === "private_approved")
      d.push({ code: "gosi", label: "برنت التأمينات الاجتماعية", category: "income", required: true });
    else d.push({ code: "payslip", label: "مسير الرواتب", category: "income", required: false });
  }
  if (financeType === "mortgage") {
    d.push({ code: "deed", label: "صك العقار", category: "collateral", required: true });
    d.push({ code: "valuation", label: "تقييم عقاري معتمد", category: "collateral", required: true });
    d.push({ code: "family", label: "سجل الأسرة", category: "identity", required: false });
    d.push({ code: "sakani", label: "شهادة استحقاق سكني (إن وجدت)", category: "income", required: false });
  }
  if (financeType === "auto") {
    d.push({ code: "quote", label: "عرض سعر السيارة", category: "collateral", required: true });
    d.push({ code: "license", label: "رخصة القيادة", category: "identity", required: true });
  }
  if (financeType === "sme" && sector !== "self") {
    d.push({ code: "cr", label: "السجل التجاري", category: "business", required: true });
    d.push({ code: "fin_statements", label: "القوائم المالية", category: "business", required: true });
  }
  return d;
}
