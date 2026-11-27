// Generates tests/golden/credit.json: the old credit engine's answers for a fixed set of SIMAH reports.
// The new engine in src/domain/credit must reproduce every grade, number and finding. Run with: npm run golden:credit
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { analyzeCredit, type CreditReport, type CreditorType, type Facility, type FacilityStatus, type Judgment } from "../lib/simah";
import { itemsFrom } from "../lib/deal";

const SEED = 20261123;
const CASES = 320;

let state = SEED >>> 0;
const rand = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
export const reseed = (seed: number) => void (state = seed >>> 0);
const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
const chance = (p: number) => rand() < p;
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
/** SIMAH prints amounts with two decimals, so a share of the amounts carry halalas. */
const amount = (lo: number, hi: number) => (chance(0.3) ? Math.round((lo + rand() * (hi - lo)) * 100) / 100 : Math.round((lo + rand() * (hi - lo)) / 100) * 100);
const date = () => `${int(2021, 2026)}/${String(int(1, 12)).padStart(2, "0")}/${String(int(1, 28)).padStart(2, "0")}`;

const LENDERS: Record<CreditorType, string[]> = {
  bank: ["مصرف الراجحي", "البنك الأهلي السعودي", "بنك الرياض", "مصرف الإنماء"],
  finance_company: ["إمكان للتمويل", "النايفات للتمويل", "اليسر للتمويل", "تمارا"],
  telecom: ["موبايلي", "زين", "الاتصالات السعودية (STC)"],
  other: ["شركة تقسيط", "غير محدد (من جدول المتعثرات)"],
};
const PRODUCTS = ["قرض شخصي", "بطاقة ائتمان", "بطاقة ائتمان", "Credit Card", "تمويل سيارة", "تمويل منزلي", "عقد تأجير", "تمويل منتجات/اشتر الآن"];

function facility(status: FacilityStatus): Facility {
  const creditorType = pick<CreditorType>(["bank", "bank", "finance_company", "finance_company", "telecom", "other"]);
  const f: Facility = {
    lender: pick(LENDERS[creditorType]),
    creditorType,
    product: creditorType === "telecom" ? pick(["الهاتف الجوال", "الهاتف الثابت"]) : pick(PRODUCTS),
    status,
  };
  if (chance(0.85)) f.limit = chance(0.08) ? 0 : amount(2000, 300000);
  if (chance(0.85)) f.balance = status === "closed" ? 0 : chance(0.1) ? null : Math.round((f.limit || 40000) * (0.05 + rand() * 1.1) * 100) / 100;
  if (status === "current" || status === "late") f.installment = chance(0.85) ? amount(150, 7000) : chance(0.5) ? 0 : null;
  if (chance(0.55)) f.worstDelay = pick([null, 0, 0, 30, 30, 60, 90, 120, 180]);
  if (chance(0.55)) f.lastDelayMonthsAgo = pick([null, 0, 1, 5, 11, 12, 13, 20, 30]);
  if (status === "default") {
    if (chance(0.9)) f.defaultAmount = chance(0.2) ? amount(100, 999) : chance(0.06) ? 0 : amount(1000, 220000);
    if (chance(0.5)) f.defaultNow = chance(0.15) ? null : Math.round((f.defaultAmount ?? 30000) * (0.5 + rand() * 0.6) * 100) / 100;
    if (chance(0.6)) f.defaultMonthsAgo = int(0, 60);
    if (chance(0.5)) f.defaultListedAt = date();
    if (chance(0.4)) f.defaultState = pick(["غير مدفوع", "مدفوع جزئياً"]);
  }
  if (status === "settled") {
    if (chance(0.85)) f.defaultAmount = chance(0.12) ? 0 : amount(300, 180000);
    if (chance(0.85)) f.settledMonthsAgo = pick([null, 0, 2, 5, 6, 8, 11, 12, 15, 23, 24, 30, 36, 48]);
    if (chance(0.4)) f.defaultNow = 0;
  }
  return f;
}

function judgment(activeDefaults: Facility[], mayBeActive: boolean): Judgment {
  const kind = pick<Judgment["kind"]>(["enforcement", "enforcement", "enforcement", "judgment", "bounced_cheque"]);
  const j: Judgment = { kind, active: mayBeActive && chance(0.65) };
  if (chance(0.92)) j.amount = chance(0.05) ? 0 : amount(800, 300000);
  // An enforcement order is often the same debt as a default: sometimes the amounts match, sometimes they are near the tolerance.
  if (activeDefaults.length && chance(0.55)) {
    const d = pick(activeDefaults);
    j.amount = Math.max(0, Math.round(((d.defaultNow ?? d.defaultAmount ?? 0) + pick([0, 0, 0, 400, -1200, 1500, 1501, 4000, -6000])) * 100) / 100);
  }
  if (chance(0.35)) j.remaining = chance(0.2) ? null : Math.round((j.amount ?? 20000) * pick([1, 1, 0.5 + rand() * 0.5]) * 100) / 100;
  if (chance(0.35)) j.creditor = chance(0.15) ? null : pick([...LENDERS.bank, ...LENDERS.finance_company, "دائن فرد"]);
  if (chance(0.55)) j.date = chance(0.1) ? null : date();
  if (chance(0.5)) j.state = chance(0.1) ? null : pick(["عدم تنفيذ", "قائم", "منفذ"]);
  if (chance(0.6)) j.decisionNo = chance(0.1) ? null : String(int(100000000, 4999999999));
  if (chance(0.4)) j.monthsAgo = int(0, 50);
  return j;
}

export function report(): CreditReport {
  // A third of the reports carry nothing that blocks, so the access rules for banks and finance companies are exercised.
  const calm = chance(0.38);
  const statuses: FacilityStatus[] = calm ? ["current", "current", "late", "closed", "settled", "settled"] : ["current", "current", "late", "closed", "settled", "default", "default"];
  const facilities = Array.from({ length: int(0, calm ? 5 : 7) }, () => facility(pick(statuses)));
  const activeDefaults = facilities.filter((f) => f.status === "default");
  const judgments = Array.from({ length: chance(calm ? 0.25 : 0.7) ? int(1, 4) : 0 }, () => judgment(activeDefaults, !calm));
  const suspended = !calm && chance(0.3);
  return {
    ...(chance(0.6) ? { reportDate: date() } : {}),
    facilities,
    judgments,
    serviceSuspension: suspended,
    ...(suspended && chance(0.6) ? { suspensionAssumed: chance(0.7) } : {}),
    ...(chance(0.5) ? { travelBan: !calm && chance(0.2) } : {}),
    inquiries6m: pick([null, 0, 1, 3, 4, 5, 9]),
    inquiries12m: pick([null, 0, 2, 6, 14]),
    score: pick([null, null, 480, 549, 550, 600, 649, 650, 720]),
    ...(chance(0.2) ? { notes: "ملاحظة المحلل" } : {}),
  };
}

export function obligations() {
  return Array.from({ length: int(0, 4) }, () => {
    const kind = pick(["mortgage", "personal", "personal", "auto", "card", "other"]);
    const monthly = chance(0.1) ? 0 : amount(300, 7000);
    return {
      kind,
      ...(chance(0.85) ? { lender: chance(0.12) ? null : pick([...LENDERS.bank, ...LENDERS.finance_company]) } : {}),
      monthly,
      ...(chance(0.9) ? { remaining: chance(0.1) ? null : kind === "mortgage" ? amount(80000, 900000) : amount(2000, 260000) } : {}),
    };
  });
}

const TYPE: Record<string, CreditorType> = { "بنك": "bank", "شركة تمويل": "finance_company", "اتصالات/خدمات": "telecom", "أخرى": "other" };
const TYPES = "(بنك|شركة تمويل|اتصالات\\/خدمات|أخرى)";
const num = (text: string | undefined) => (text == null ? null : Number(text.replace(/,/g, "")));

type Row = [RegExp, string, (m: RegExpMatchArray) => Record<string, unknown>];
const read = (table: Row[], text: string) => {
  for (const [re, code, params] of table) {
    const m = text.match(re);
    if (m) return { code, params: params(m) };
  }
  throw new Error(`no code for: ${text}`);
};

const BLOCKER: Row[] = [
  [/^إيقاف خدمات مرجّح/, "SUSPENSION", () => ({ assumed: true })],
  [/^إيقاف خدمات قائم/, "SUSPENSION", () => ({ assumed: false })],
  [/^منع سفر/, "TRAVEL_BAN", () => ({})],
  [
    /^(قرار تنفيذ|حكم) قائم(?: \(غالباً لصالح (.+?)\))?(?: بمبلغ (-?[\d,]+))?(?: — (\d{4}\/\d{2}\/\d{2}))?(?: — (.+))?\.$/,
    "JUDGMENT",
    (m) => ({ kind: m[1] === "حكم" ? "judgment" : "enforcement", creditor: m[2] ?? null, amount: num(m[3]), date: m[4] ?? null, state: m[5] ?? null }),
  ],
  [/^شيك مرتجع غير مسوّى(?: \((-?[\d,]+)\))?\.$/, "BOUNCED_CHEQUE", (m) => ({ amount: num(m[1]) })],
  [
    new RegExp(`^تعثر قائم لدى (.+) \\(${TYPES}\\)(?: — المتبقي (-?[\\d,]+))?(?: — مُدرج منذ (\\d{4}\\/\\d{2}\\/\\d{2}))?(?: \\((.+?)\\))?( — مرفوع عليه قرار تنفيذ)?\\.$`),
    "ACTIVE_DEFAULT",
    (m) => ({ lender: m[1], creditorType: TYPE[m[2]], remaining: num(m[3]), listedAt: m[4] ?? null, state: m[5] ?? null, enforced: !!m[6] }),
  ],
];

const FINDING: Row[] = [
  [/^المطلوب سداده\/تسويته لفتح الأبواب ≈ ([\d,]+) ريال/, "TOTAL_TO_CLEAR", (m) => ({ amount: num(m[1]) })],
  [/^(\d+) تعثر لدى شركات تمويل .*\(≈ (\d+) شهراً بعد التسوية\)\.$/, "FINANCE_CO_DEFAULTS", (m) => ({ count: num(m[1]), waitMonths: num(m[2]) })],
  [/^(\d+) تعثر لدى بنوك — مهلة قبول البنوك عادة ≈ (\d+) شهراً/, "BANK_DEFAULTS", (m) => ({ count: num(m[1]), waitMonths: num(m[2]) })],
  [/^(\d+) تعثر اتصالات\/فواتير/, "TELECOM_DEFAULTS", (m) => ({ count: num(m[1]) })],
  [
    new RegExp(`^تعثر مسوّى لدى (.+) \\(${TYPES}\\) منذ (\\d+|؟) شهراً(?: — مبلغه ([\\d,]+))?\\. يبقى ظاهراً`),
    "SETTLED_DEFAULT",
    (m) => ({ lender: m[1], creditorType: TYPE[m[2]], monthsAgo: m[3] === "؟" ? null : num(m[3]), amount: num(m[4]) }),
  ],
  [/^(\d+) التزام عليه تأخر 30 يوماً فأكثر خلال آخر 12 شهراً\. أسوأ تأخر: (\d+) يوماً\.$/, "RECENT_DELAYS", (m) => ({ count: num(m[1]), worstDelay: num(m[2]) })],
  [/^تأخر قديم \(أسوأه (\d+) يوماً\) خارج آخر 12 شهراً\.$/, "OLD_DELAY", (m) => ({ worstDelay: num(m[1]) })],
  [/^(\d+) استعلامات خلال 6 أشهر/, "MANY_INQUIRIES", (m) => ({ count: num(m[1]) })],
  [/^استخدام البطاقات (-?\d+)% من الحدود \((-?[\d,]+) من ([\d,]+)\)\.$/, "CARD_UTILIZATION", (m) => ({ percent: num(m[1]), balance: num(m[2]), limit: num(m[3]) })],
  [/^الدرجة الائتمانية (\d+)\.$/, "SCORE", (m) => ({ score: num(m[1]) })],
  [/^أقساط شهرية قائمة في سمة: ([\d,]+) ريال على (\d+) التزام/, "INSTALLMENTS", (m) => ({ monthly: num(m[1]), facilities: num(m[2]) })],
  [/^لا تعثرات ولا أحكام ولا تأخرات حديثة\.$/, "CLEAN", () => ({})],
];

const ACTION: Row[] = [
  [/^حصر طلبات التنفيذ في ناجز/, "LIFT_SUSPENSION", () => ({})],
  [/^سداد أو تسوية (?:قرار التنفيذ|قرارات التنفيذ \((\d+)\)) بمجموع ([\d,]+) ريال/, "SETTLE_JUDGMENTS", (m) => ({ count: m[1] ? num(m[1]) : 1, amount: num(m[2]) })],
  [/^سداد تعثر (.+) \((-?[\d,]+)\) وطلب خطاب مخالصة\.$/, "PAY_DEFAULT", (m) => ({ lender: m[1], amount: num(m[2]) })],
  [/^طلب تحديث سمة من كل دائن/, "REFRESH_REPORT", () => ({})],
  [/^انتظام كامل في كل الأقساط/, "PAY_ON_TIME", () => ({})],
  [/^إيقاف أي تقديم جديد/, "PAUSE_APPLICATIONS", () => ({})],
  [/^خفض رصيد البطاقات/, "LOWER_CARDS", () => ({})],
  [/^إعادة الدراسة للبنوك بعد ≈ (\d+) شهراً من الآن\.$/, "RESTUDY_BANKS", (m) => ({ months: num(m[1]) })],
  [/^لا إجراء مطلوب/, "NONE", () => ({})],
];

const REASON: Record<string, string> = {
  "يوجد مانع قائم": "BLOCKER",
  "تعثر مسوّى حديثاً لدى شركة تمويل": "RECENT_SETTLEMENT_FINANCE_CO",
  "تعثر مسوّى حديثاً لدى بنك": "RECENT_SETTLEMENT_BANK",
  "تأخرات حديثة": "RECENT_DELAYS",
  "تاريخ تعثر مسوّى": "SETTLED_HISTORY",
  "استعلامات كثيرة": "MANY_INQUIRIES",
  "سجل مقبول بنكياً": "ACCEPTABLE",
  "تسوية حديثة جداً": "VERY_RECENT_SETTLEMENT",
  "سجل مقبول": "ACCEPTABLE",
  "تقبل بعض الشركات بخطاب تسوية وانتظام": "WITH_SETTLEMENT_LETTER",
};
const door = (d: { access: string; reason: string; reopenInMonths: number | null }) => {
  if (!REASON[d.reason]) throw new Error(`no reason code for: ${d.reason}`);
  return { access: d.access, reason: REASON[d.reason], reopenInMonths: d.reopenInMonths };
};

const MONEY_STATS = ["totalLimits", "totalBalance", "monthlyInstallments", "defaultsAmount", "activeDefaultsAmount", "judgmentsAmount", "activeJudgmentsAmount"] as const;

/** The old engine's answer for one record, with its sentences read back into codes and numbers. */
export function oldAnswer(input: CreditReport, owed: ReturnType<typeof obligations>) {
  // The old engine writes the creditor it guessed back onto the report, so it runs on a copy and the stored input stays as received.
  const copy = structuredClone(input);
  const a = analyzeCredit(copy);
  const stats: Record<string, number | null> = { ...a.stats };
  // Sums of amounts are stored in whole riyals, the way the old screens printed them.
  for (const key of MONEY_STATS) stats[key] = Math.round(a.stats[key]);
  return {
    grade: a.grade,
    severity: a.severity,
    standing: a.derivedSimah,
    banks: door(a.banks),
    financeCompanies: door(a.financeCompanies),
    stats,
    blockers: a.blockers.map((text) => read(BLOCKER, text)),
    findings: a.findings.map((f) => ({ level: f.level, ...read(FINDING, f.text) })),
    actions: a.actions.map((text) => read(ACTION, text)),
    flags: { bankReopenMonths: a.banks.reopenInMonths, suspension: !!input.serviceSuspension, financeCoDefault: a.stats.financeCoDefaults > 0 },
    // Production built the first list of deal items from the report after the analysis had run on it.
    items: itemsFrom(copy, owed).map((i) => ({ kind: i.kind, label: i.label, original: i.original, pay: i.pay, by: i.by, monthly: i.monthly ?? null })),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cases = Array.from({ length: CASES }, () => {
    const input = report();
    const owed = obligations();
    return { report: input, obligations: owed, expected: oldAnswer(input, owed) };
  });

  const out = path.join(import.meta.dirname, "../../tests/golden/credit.json");
  fs.writeFileSync(out, `{"seed":${SEED},"cases":[\n${cases.map((c) => JSON.stringify(c)).join(",\n")}\n]}\n`);
  const tally = (xs: string[]) => Object.fromEntries([...new Set(xs)].sort().map((x) => [x, xs.filter((y) => y === x).length]));
  console.log(`${cases.length} cases -> ${out} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
  console.log("grades:", tally(cases.map((c) => c.expected.grade)));
  console.log("standing:", tally(cases.map((c) => c.expected.standing)));
  console.log("banks:", tally(cases.map((c) => `${c.expected.banks.access}/${c.expected.banks.reason}`)));
  console.log("finance companies:", tally(cases.map((c) => `${c.expected.financeCompanies.access}/${c.expected.financeCompanies.reason}`)));
  console.log("blockers:", tally(cases.flatMap((c) => c.expected.blockers.map((b) => b.code))));
  console.log("findings:", tally(cases.flatMap((c) => c.expected.findings.map((f) => `${f.code}:${f.level}`))));
  console.log("actions:", tally(cases.flatMap((c) => c.expected.actions.map((x) => x.code))));
  console.log("items:", tally(cases.flatMap((c) => c.expected.items.map((i) => i.kind))));
}
