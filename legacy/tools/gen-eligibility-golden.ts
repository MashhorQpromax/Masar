// Generates tests/golden/eligibility.json: the old eligibility engine's answers for a fixed set of clients.
// The new engine in src/domain/eligibility must reproduce every number, every check and every piece of advice.
// Run with: npm run golden:eligibility
import fs from "node:fs";
import path from "node:path";
import { PRODUCTS, LENDERS } from "../lib/base-data";
import { capacity, incomeOf, requiredDocuments, study, type Product, type Profile } from "../lib/engine";

const SEED = 20261123;
const CASES = 400;

let state = SEED >>> 0;
const rand = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
const chance = (p: number) => rand() < p;
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const money = (lo: number, hi: number, step = 1000) => Math.round((lo + rand() * (hi - lo)) / step) * step;

const SECTORS = ["gov", "semi_gov", "private_approved", "private", "military", "retired", "self"] as const;
const BANK_CODES = ["rajhi", "snb", "riyad", "alinma", "albilad", "saib"];

// The catalogue the production database was seeded with.
const lenderOf = new Map(LENDERS.map(([name, type, code], i) => [name, { id: String(i + 1), type, code }]));
const catalogue: Product[] = PRODUCTS.map((p, i) => {
  const l = lenderOf.get(p.l)!;
  return {
    id: String(i + 1), lenderId: l.id, lenderName: p.l, lenderType: l.type, bankCode: l.code, financeType: p.t, name: p.n,
    minSalary: p.minSal, minAge: p.minAge ?? 21, maxAgeAtMaturity: p.maxAge, minServiceMonths: p.svc, sectors: p.sectors as Product["sectors"],
    nationalities: (p.nat ?? ["saudi"]) as Product["nationalities"], maxTenor: p.tenor, maxAmount: p.max, rate: p.rate, rateType: p.rt ?? "flat",
    requiresSalaryTransfer: p.transfer ?? true, acceptsLateSimah: p.late ?? false, maxLtv: p.ltv ?? null, notes: null,
  };
});

// Extra products with unusual terms, so every branch of the matching is exercised.
const LETTERS = ["ألف", "باء", "جيم", "دال", "هاء", "واو"];
function extraProduct(n: number, financeType: Product["financeType"]): Product {
  const mortgage = financeType === "mortgage";
  const bank = chance(0.6);
  return {
    id: `x${n}`, lenderId: `x${n}`, lenderName: `جهة ${LETTERS[n % LETTERS.length]}`, lenderType: bank ? "bank" : "finance_company",
    bankCode: bank && chance(0.7) ? pick(BANK_CODES) : null, financeType, name: mortgage ? "عقاري تجريبي" : "تمويل تجريبي",
    minSalary: pick([0, 3000, 4000, 6000, 10000]), minAge: pick([18, 21, 21, 25]), maxAgeAtMaturity: pick([58, 60, 65, 70, 75]),
    minServiceMonths: pick([0, 1, 3, 6, 12, 24]),
    sectors: SECTORS.filter(() => chance(0.7)) as unknown as Product["sectors"],
    nationalities: chance(0.25) ? ["saudi", "non_saudi"] : chance(0.05) ? ["non_saudi"] : ["saudi"],
    maxTenor: mortgage ? pick([120, 180, 240, 300, 360]) : pick([12, 36, 48, 60, 84]),
    maxAmount: mortgage ? money(500000, 6000000, 50000) : money(30000, 1500000, 5000),
    rate: pick([0, 2.2, 3.5, 4.75, 5.9, 7.5, 9]), rateType: pick(["flat", "reducing"]),
    requiresSalaryTransfer: chance(0.6), acceptsLateSimah: chance(0.4),
    maxLtv: mortgage ? pick([null, 70, 80, 90, 100]) : null, notes: null,
  };
}

function scenario() {
  const financeType = pick(["personal", "personal", "personal", "personal", "personal", "personal", "personal", "mortgage", "mortgage", "mortgage", "mortgage", "mortgage", "mortgage", "auto", "auto", "sme", "card", "project"]) as Profile["financeType"];
  const basic = chance(0.1) ? null : money(2500, 30000, 100);
  const total = chance(0.1) ? null : chance(0.03) ? 0 : (basic ?? 7000) + money(0, 14000, 100);
  const obligations = Array.from({ length: pick([0, 0, 0, 1, 1, 2, 3, 4]) }, () => ({
    kind: pick(["personal", "personal", "mortgage", "auto", "card", "other"]) as Profile["obligations"][number]["kind"],
    ...(chance(0.6) ? { lender: pick(["مصرف الراجحي", "إمكان للتمويل", "بنك الرياض", "النايفات للتمويل"]) } : {}),
    monthly: money(200, 6000, 50),
    ...(chance(0.7) ? { remaining: money(2000, 600000, 500) } : {}),
  }));
  const amount = financeType === "mortgage" ? money(300000, 3500000, 10000) : financeType === "auto" ? money(50000, 400000, 5000) : money(20000, 700000, 5000);
  const profile: Profile = {
    age: chance(0.08) ? null : int(20, 68),
    nationality: chance(0.85) ? "saudi" : "non_saudi",
    sector: pick([...SECTORS, "gov", "private_approved"]),
    serviceMonths: chance(0.1) ? null : chance(0.1) ? int(0, 5) : int(6, 420),
    basicSalary: basic,
    totalSalary: total,
    ...(chance(0.3) ? { otherIncome: chance(0.85) ? money(500, 12000, 100) : null } : {}),
    salaryBank: chance(0.25) ? null : pick([...BANK_CODES, "other"]),
    simah: pick(["clean", "clean", "clean", "clean", "clean", "late", "late", "default", "unknown", "unknown"]),
    ...(chance(0.6) ? { housingSupport: chance(0.4) } : {}),
    financeType,
    requestedAmount: chance(0.25) ? null : amount,
    requestedTenor: chance(0.35) ? null : pick([12, 24, 36, 48, 60, 84, 120, 180, 240, 300, 360]),
    obligations,
    ...(chance(0.7) ? { firstHome: pick([null, true, false]) } : {}),
    propertyValue: chance(0.5) ? null : money(300000, 4000000, 10000),
    ...(chance(0.25) ? { coIncome: chance(0.85) ? money(2000, 15000, 100) : null } : {}),
  };
  const extra = Array.from({ length: pick([0, 0, 1, 2, 3]) }, (_, k) => extraProduct(k, financeType));
  return { profile, extra };
}

const table = (rows: [RegExp, string][], text: string) => {
  const hit = rows.find(([re]) => re.test(text));
  if (!hit) throw new Error(`no code for: ${text}`);
  return hit[1];
};
const numbers = (text: string) => (text.match(/-?\d[\d,]*(\.\d+)?/g) ?? []).map((t) => Number(t.replace(/,/g, "")));

const RULE: [RegExp, string][] = [
  [/^السقف الكلي \d+% من الدخل \(يشمل العقاري\)$/, "TOTAL_CAP"], [/^السقف الكلي \d+%$/, "TOTAL_CAP"],
  [/^25% من المعاش$/, "SALARY_DEDUCTION"], [/^33\.33% من الراتب الإجمالي$/, "SALARY_DEDUCTION"], [/^45% للالتزامات غير العقارية$/, "NON_REAL_ESTATE"],
];
const WARNING: [RegExp, string][] = [[/^لم يُدخل الراتب الإجمالي/, "BASIC_SALARY_USED"], [/^الدخل 25,000 فأكثر/, "HIGH_INCOME_CAP_ASSUMED"]];
const CHECK: Record<string, [RegExp, string][]> = {
  salary: [[/^الراتب غير مدخل$/, "SALARY_MISSING"], [/مقابل حد أدنى/, "SALARY_MIN"]],
  sector: [[/./, "SECTOR"]],
  nationality: [[/./, "NATIONALITY"]],
  age: [[/^العمر غير مدخل$/, "AGE_MISSING"], [/أقل من/, "AGE_BELOW_MIN"], [/^يتجاوز/, "AGE_OVER_MAX"], [/^المدة قُصّرت/, "TENOR_SHORTENED"], [/≤/, "AGE_AT_END"]],
  service: [[/^متقاعد/, "SERVICE_NOT_NEEDED"], [/^غير مدخلة$/, "SERVICE_MISSING"], [/شهر مقابل/, "SERVICE_MIN"]],
  simah: [[/^سليم$/, "RECORD_CLEAN"], [/^لم يُستخرج/, "RECORD_UNKNOWN"], [/^تأخر سداد/, "RECORD_LATE"], [/^متعثر/, "RECORD_DEFAULT"]],
  transfer: [[/./, "SALARY_TRANSFER"]],
  retire: [[/^يبلغ/, "RETIRES_IN_TERM"]],
  ltv: [[/^يمول حتى/, "DOWN_PAYMENT"]],
  dbr: [[/^لا يوجد قسط متاح/, "NO_ROOM"], [/^قسط متاح/, "ROOM"]],
};
const LIMIT: [RegExp, string][] = [
  [/^القسط المتاح ضمن حدود ساما$/, "INCOME"], [/^انخفاض الدخل بعد التقاعد/, "RETIREMENT"], [/^نسبة التمويل \d+% من قيمة العقار$/, "LTV"], [/^الحد الأعلى لمنتج الجهة$/, "PRODUCT_MAX"],
];
const STRENGTH: [RegExp, string][] = [
  [/^جهة عمل حكومية/, "STRONG_EMPLOYER"], [/^جهة عمل خاصة معتمدة/, "APPROVED_EMPLOYER"], [/^سجل ائتماني سليم$/, "CLEAN_RECORD"], [/^نسبة الالتزامات الحالية/, "DEBT_SHARE"],
];
const RISK: [RegExp, string][] = [
  [/^جهة عمل غير معتمدة/, "UNAPPROVED_EMPLOYER"], [/^تأخر سداد في سمة$/, "LATE_RECORD"], [/^تعثر في سمة/, "DEFAULT_RECORD"], [/^نسبة الالتزامات الحالية/, "DEBT_SHARE"],
  [/^لا يوجد هامش استقطاع/, "NO_ROOM"], [/^مدة خدمة أقل من 3 أشهر$/, "SHORT_SERVICE"],
];
const ADVICE: [RegExp, string][] = [
  [/^أفضل خيار حالي:/, "BEST_OPTION"], [/^سداد المتعثرات/, "CLEAR_DEFAULTS"], [/^سداد الالتزام الأصغر/, "PAY_SMALLEST"], [/^البدء بالبنك المحول عليه الراتب/, "SALARY_BANK_FIRST"],
  [/^ترتيب التقديم المقترح:/, "APPLY_ORDER"], [/^المبلغ المطلوب/, "AMOUNT_ABOVE_POSSIBLE"], [/^استكمال البيانات الناقصة:/, "COMPLETE_DATA"],
];
const MISSING: Record<string, string> = {
  "العمر / تاريخ الميلاد": "AGE", "الراتب الإجمالي (تعريف راتب حديث)": "TOTAL_SALARY", "مدة الخدمة": "SERVICE", "تقرير سمة": "CREDIT_REPORT",
  "البنك المحول عليه الراتب": "SALARY_BANK", "المبلغ المطلوب": "REQUESTED_AMOUNT",
};

/** What a piece of advice names besides its numbers. */
function named(code: string, text: string): string[] {
  if (code === "BEST_OPTION") return [text.slice("أفضل خيار حالي: ".length, text.indexOf(" بمبلغ تقريبي"))];
  if (code === "PAY_SMALLEST") return [text.slice(text.indexOf("(") + 1, text.indexOf(")"))];
  if (code === "APPLY_ORDER") return text.slice("ترتيب التقديم المقترح: ".length, text.indexOf(" (تقديم متتابع")).split(" ثم ");
  return [];
}

const cases = Array.from({ length: CASES }, () => {
  const { profile, extra } = scenario();
  const before = JSON.stringify(profile);
  const s = study(profile, [...catalogue, ...extra]);
  if (JSON.stringify(profile) !== before) throw new Error("the old engine changed its input");
  const c = capacity(profile);
  const income = incomeOf(profile);
  const expected = {
    capacity: {
      income: c.income, salary: income.salary, other: income.other, co: income.co,
      existingTotal: c.existingTotal, existingNonRealEstate: c.existingNonRealEstate, existingMortgage: c.existingMortgage,
      salaryDeductionCap: c.salaryDeductionCap, totalCap: c.totalCap, capUsed: c.capUsed, maxInstallment: c.maxInstallment, available: c.available,
      currentDbr: c.currentDbr, rule: table(RULE, c.bindingRule), warnings: c.warnings.map((w) => table(WARNING, w)),
    },
    matches: s.matches.map((m) => ({
      product: m.product.id, verdict: m.verdict, score: m.score, tenor: m.tenor, maxPrincipal: m.maxPrincipal, offerPrincipal: m.offerPrincipal,
      installment: m.installment, totalCost: m.totalCost, apr: m.apr, totalProfit: m.totalProfit, fee: m.fee, settle12: m.settle12,
      limitedBy: table(LIMIT, m.limitedBy),
      ltv: m.ltv ?? null,
      retirement: m.retirement ? { atMonth: m.retirement.atMonth, pension: m.retirement.pension, before: m.retirement.before, after: m.retirement.after } : null,
      checks: m.checks.map((k) => [k.key, k.status, table(CHECK[k.key], k.detail), numbers(k.detail)]),
    })),
    verdict: s.verdict,
    eligible: s.matches.filter((m) => m.verdict === "pass").length,
    conditional: s.matches.filter((m) => m.verdict === "warn").length,
    headline: s.headline,
    strengths: s.strengths.map((t) => [table(STRENGTH, t), numbers(t)]),
    risks: s.risks.map((t) => [table(RISK, t), numbers(t)]),
    advice: s.recommendations.map((t) => { const code = table(ADVICE, t); return [code, numbers(t), named(code, t)]; }),
    missing: s.missingData.map((t) => MISSING[t] ?? (() => { throw new Error(`no code for: ${t}`); })()),
  };
  return { profile, extra, expected };
});

// The required documents for every kind of client.
const documents = (["personal", "mortgage", "auto", "sme", "card", "project"] as const).flatMap((financeType) =>
  SECTORS.flatMap((sector) =>
    (["saudi", "non_saudi"] as const).map((nationality) => ({
      financeType, sector, nationality,
      expected: requiredDocuments(financeType, sector, nationality).map((d) => [d.code, d.category, d.required, d.label]),
    })),
  ),
);

const out = path.join(import.meta.dirname, "../../tests/golden/eligibility.json");
fs.writeFileSync(
  out,
  `{"seed":${SEED},"catalogue":${JSON.stringify(catalogue)},"documents":[\n${documents.map((d) => JSON.stringify(d)).join(",\n")}\n],"cases":[\n${cases.map((c) => JSON.stringify(c)).join(",\n")}\n]}\n`,
);
const seen = (xs: string[]) => [...new Set(xs)].sort().join(" ");
const all = cases.flatMap((c) => c.expected.matches);
console.log(`${cases.length} cases, ${all.length} matches, ${documents.length} document lists -> ${out} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
console.log("verdicts:", Object.fromEntries(["eligible", "conditional", "not_eligible", "pending"].map((v) => [v, cases.filter((c) => c.expected.verdict === v).length])));
console.log("match verdicts:", Object.fromEntries(["pass", "warn", "fail"].map((v) => [v, all.filter((m) => m.verdict === v).length])));
console.log("rules:", seen(cases.map((c) => c.expected.capacity.rule)), "| warnings:", seen(cases.flatMap((c) => c.expected.capacity.warnings)));
console.log("checks:", seen(all.flatMap((m) => m.checks.map((k) => `${k[2]}`))));
console.log("limits:", seen(all.map((m) => m.limitedBy)), "| retirement:", all.filter((m) => m.retirement).length, "| ltv:", all.filter((m) => m.ltv).length);
console.log("strengths:", seen(cases.flatMap((c) => c.expected.strengths.map((t) => t[0] as string))));
console.log("risks:", seen(cases.flatMap((c) => c.expected.risks.map((t) => t[0] as string))));
console.log("advice:", seen(cases.flatMap((c) => c.expected.advice.map((t) => t[0] as string))));
console.log("missing:", seen(cases.flatMap((c) => c.expected.missing)));
