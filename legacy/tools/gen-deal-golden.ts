// Generates tests/golden/deal.json: the old deal engine's answers for a fixed set of scenarios.
// The new engine in src/domain/deal must reproduce every number. Run with: npm run golden:deal
import fs from "node:fs";
import path from "node:path";
import { dealStudy, dealAlternatives } from "../lib/deal";

const SEED = 20261122;
const CASES = 240;

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

const KIND_LABEL: Record<string, string> = { execution: "قرار تنفيذ", default: "تعثر", mortgage_payoff: "مخالصة العقاري", personal_payoff: "مخالصة الشخصي", card: "مخالصة بطاقة", other: "التزام آخر" };

function item(n: number) {
  const kind = pick(["execution", "execution", "default", "default", "mortgage_payoff", "personal_payoff", "card", "other"]);
  const by =
    kind === "personal_payoff" || kind === "card" ? pick(["bank", "bank", "bank", "company", "out"]) :
    kind === "mortgage_payoff" ? pick(["company", "company", "company", "out"]) :
    pick(["company", "company", "company", "company", "out"]);
  const original = kind === "mortgage_payoff" ? money(150000, 900000) : money(4000, 320000, 500);
  const pay = chance(0.55) ? original : Math.round(original * (0.45 + rand() * 0.55));
  const payoff = kind === "mortgage_payoff" || kind === "personal_payoff" || kind === "card";
  const ref = chance(0.3) ? ` ${int(1000000000, 4999999999)}` : chance(0.5) ? ` ${int(100, 9999)}` : "";
  const party = chance(0.85) ? ` — دائن ${n}${chance(0.3) ? " (2024/03/11)" : ""}` : "";
  return {
    id: `i${n}`, kind, label: `${KIND_LABEL[kind]}${ref}${party}`, original, pay, by,
    ...(chance(0.4) ? { confirmed: chance(0.6) } : {}),
    ...(payoff ? { monthly: chance(0.75) ? money(600, 6500, 50) : null } : {}),
  };
}

function scenario() {
  const fee = chance(0.06) ? {} : chance(0.06) ? { settlePct: "15", financePct: null, financeBase: "x" } : {
    settlePct: pick([0, 10, 10, 15, 20, 25, 35, 40]), settleIncludesPayoff: chance(0.3),
    financePct: pick([0, 10, 10, 12.5, 20, 35, 40]), financeBase: pick(["total", "total", "personal", "mortgage"]), fixed: pick([0, 0, 0, 5000]),
  };
  const basic = chance(0.1) ? null : money(3000, 26000, 100);
  const input = {
    ...(chance(0.1) ? {} : { structure: pick(["settle_refi_personal", "settle_refi_personal", "settle_personal", "settle_refi"]) }),
    items: Array.from({ length: int(0, 6) }, (_, k) => item(k + 1)),
    propertyValue: chance(0.12) ? null : money(350000, 2600000, 5000),
    transferTaxPct: pick([0, 5, 5]), saleTaxPct: pick([0, 0, 0, 5]), fixedCosts: pick([0, 10000, 10000, 25000]),
    fee, targetBank: null,
    mortgageApr: pick([0, 3.5, 4.5, 5.5, 5.5, 6.75]), personalFlat: pick([0, 2.5, 3, 3, 4.5, 6]), personalMonths: pick([0, 12, 36, 60, 60, 84]),
    mortgageMaxAge: pick([65, 70, 70, 75]), mortgageMaxMonths: pick([0, 120, 240, 300, 300, 360]), ltvPct: pick([70, 85, 90, 90]),
    bankMortgage: chance(0.2) ? money(150000, 1600000) : null, bankPersonal: chance(0.2) ? money(40000, 520000) : null,
    ...(chance(0.6) ? { personalLender: chance(0.5) ? "إمكان" : null } : {}),
    ...(chance(0.6) ? { personalLenderKind: pick(["finance_co", "bank", null]) } : {}),
    notes: "",
  };
  const borrower = {
    age: chance(0.08) ? null : int(22, 66),
    basicSalary: basic,
    totalSalary: chance(0.12) ? null : (basic ?? 8000) + money(0, 12000, 100),
    serviceMonths: chance(0.1) ? null : int(0, 380),
    sector: pick(["gov", "gov", "semi_gov", "private_approved", "private", "military", "retired", "self"]),
  };
  const credit = chance(0.3) ? null : { bankReopenMonths: pick([null, 0, 6, 12, 24]), suspension: chance(0.4), financeCoDefault: chance(0.3) };
  return { input, borrower, credit };
}

const RISK: [RegExp, string][] = [
  [/^قيمة العقار غير معروفة/, "PROPERTY_VALUE_MISSING"], [/^الصفقة لا تُغلق: عجز/, "DEFICIT"], [/^هامش ضيق:/, "THIN_MARGIN"],
  [/^التزامات تبقى قائمة:/, "KEPT_OBLIGATIONS"], [/قرار(ات)? تنفيذ خارج الصفقة/, "EXECUTION_OUTSIDE_DEAL"], [/^تعثر يبقى في سمة بدون سداد/, "DEFAULT_OUTSIDE_DEAL"],
  [/^الشخصي من .*\(شركة تمويل\): هامشها/, "PERSONAL_FROM_FINANCE_CO"], [/^لا يوجد ضمان عقاري/, "NO_COLLATERAL"],
  [/^تغطية الضمان .*لا تغطي/, "COVER_LOW"], [/^تغطية الضمان .*مقبولة/, "COVER_SENSITIVE"], [/^تعثر شركة تمويل سيبقى/, "FINANCE_CO_DEFAULT_HISTORY"],
  [/^حسب تحليل سمة/, "BANK_WAIT"], [/^الإيقاف \(المادة 46\) يُرفع آلياً/, "SUSPENSION_LIFT"], [/^يتقاعد بعد/, "NEAR_RETIREMENT"],
  [/^العقاري محكوم بالدخل/, "INCOME_BOUND"], [/^مبلغ مخالصة العقاري تقديري/, "PAYOFF_UNCONFIRMED"], [/^تفاوض مع طالبي التنفيذ/, "NEGOTIATE_EXECUTIONS"],
  [/^ضريبة التصرفات/, "TRANSFER_TAX"], [/^ضمانات الاسترداد/, "RECOVERY_GUARANTEES"], [/^الاستقطاع بعد التمويل/, "DBR_OVER_CAP"], [/^النسبة تتجاوز الحد الأقصى/, "FEE_OVER_MAX"],
];
const WHY: Record<string, string> = { "إيقاف خدمات": "SUSPENSION", "تعثر شركة تمويل": "FINANCE_CO_DEFAULT", "قرارات تنفيذ": "EXECUTIONS", "بدون ضمان عقاري": "NO_COLLATERAL", "تغطية ضمان منخفضة": "LOW_COVER", "قرب التقاعد": "NEAR_RETIREMENT", "المدفوع يقارب قيمة العقار": "PAID_NEAR_VALUE" };
const SECTION: Record<string, string> = { "التمويل الشخصي الجديد": "personal", "التمويل العقاري الجديد": "mortgage", "مستحقاتنا": "dues", "النتيجة": "result" };
const ALT: [RegExp, string][] = [
  [/^«.*» يقفل$/, "STRUCTURE_CLOSES"], [/^خصم .* يقفل الصفقة$/, "DISCOUNT_CLOSES"], [/^تخفيض الأتعاب إلى/, "FEE_MIN_CLOSES"], [/^تخفيض الأتعاب للحد الأدنى لا يكفي/, "FEE_MIN_NOT_ENOUGH"],
  [/^حتى بدون أي أتعاب/, "ZERO_FEE_STILL_SHORT"], [/^التمويل الشخصي لا يغطي حتى/, "PERSONAL_COVERS_UNDER_5PCT"], [/^الشخصي يغطي سداد/, "PERSONAL_PARTIAL_COVER"],
  [/^إبقاء الشخصي القائم/, "KEEP_PERSONAL_TOP_UP"], [/^تقييم .* يقفل الصفقة$/, "HIGHER_VALUATION"], [/^متضامن في العقاري/, "CO_BORROWER"],
];
const code = (table: [RegExp, string][], text: string) => {
  const hit = table.find(([re]) => re.test(text));
  if (!hit) throw new Error(`no code for: ${text}`);
  return hit[1];
};
const numbers = (text: string) => (text.match(/-?\d[\d,]*(\.\d+)?/g) ?? []).map((t) => Number(t.replace(/,/g, "")));

const cases = Array.from({ length: CASES }, () => {
  const { input, borrower, credit } = scenario();
  const s = dealStudy(input as never, borrower, credit);
  const fromSale = s.waterfall.find((w) => w.label.startsWith("يسترد من البنك"));
  const expected = {
    structure: s.structure, verdict: s.verdict, keptMonthly: s.keptMonthly, paidByCompany: s.paidByCompany, paidByBank: s.paidByBank,
    transferTax: s.transferTax, saleTax: s.saleTax, capital: s.capital, financing: s.financing, companyFromSale: fromSale ? fromSale.amount : 0,
    downPayment: s.downPayment, personalCash: s.personalCash, surplusBeforeFee: s.surplusBeforeFee,
    fee: s.fee, feeSettle: s.feeSettle, feeFinance: s.feeFinance, settleBase: s.settleBase, financeBase: s.financeBase,
    suggestedPct: s.suggestedPct, suggestedReasons: s.suggestedWhy.map((w) => WHY[w]),
    dueFromClient: s.dueFromClient, clientNet: s.clientNet, roi: s.roi, days: s.days, annualized: s.annualized, cover: s.cover, breakEvenDiscount: s.breakEvenDiscount,
    risks: s.risks.map((r) => [r.level, code(RISK, r.text)]),
    ledger: s.explain.map((e) => [SECTION[e.group], e.value, e.tone ?? null]),
    summary: {
      obligations: s.summary.obligations, totalObligations: s.summary.totalObligations, discountTotal: s.summary.discountTotal,
      kept: s.summary.kept, keptExecutions: s.summary.keptExecutions, financing: s.summary.financing.map((f) => f.amount),
      totalFinancing: s.summary.totalFinancing, costs: s.summary.costs.map((c) => c.amount), afterSettle: s.summary.afterSettle, net: s.summary.net,
    },
    steps: s.steps.map((t) => [t.stage, t.days]),
    alternatives: dealAlternatives(input as never, borrower, credit).map((a) => ({ tone: a.tone, code: code(ALT, a.title), numbers: numbers(`${a.title} ${a.detail}`), patch: a.patch ?? null })),
  };
  return { input, borrower, credit, expected };
});

const out = path.join(import.meta.dirname, "../../tests/golden/deal.json");
fs.writeFileSync(out, `{"seed":${SEED},"cases":[\n${cases.map((c) => JSON.stringify(c)).join(",\n")}\n]}\n`);
const count = (k: string) => cases.filter((c) => c.expected.verdict === k).length;
console.log(`${cases.length} cases -> ${out} (${Math.round(fs.statSync(out).size / 1024)} KB)`, { go: count("go"), tight: count("tight"), short: count("short"), needs_info: count("needs_info") });
const seen = (xs: string[]) => [...new Set(xs)].sort().join(" ");
console.log("risk codes:", seen(cases.flatMap((c) => c.expected.risks.map((r) => r[1] as string))));
console.log("alt codes:", seen(cases.flatMap((c) => c.expected.alternatives.map((a) => a.code))));
