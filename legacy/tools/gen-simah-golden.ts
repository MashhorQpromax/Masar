// Generates tests/golden/simah.json: what the old reader made of a fixed set of SIMAH report texts.
// The new reader in src/domain/credit/parse.ts must read every one the same way. Run with: npm run golden:simah
//
// The texts are made up. They follow the shape PDF extraction gives a real report (Arabic spelled
// backwards, numbers glued together) and carry no real person's data.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseSimahPages } from "../lib/simah-parse";

const SEED = 20261124;
const CASES = 160;
/** The day the old reader is told it is. It asks the clock, so the clock is fixed while it runs. */
export const TODAY = "2026/11/23";

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
const amount = (lo: number, hi: number) => (chance(0.4) ? Math.round((lo + rand() * (hi - lo)) * 100) / 100 : Math.round((lo + rand() * (hi - lo)) / 100) * 100);
const f2 = (n: number) => n.toFixed(2);
const date = (fromYear = 2019, toYear = 2026) => `${int(fromYear, toYear)}/${String(int(1, 12)).padStart(2, "0")}/${String(int(1, 28)).padStart(2, "0")}`;
const rev = (s: string) => [...s].reverse().join("");
const shuffle = <T,>(xs: T[]): T[] => {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const k = Math.floor(rand() * (i + 1));
    [out[i], out[k]] = [out[k], out[i]];
  }
  return out;
};

// Names as extraction returns them: some with the letters of "ال" swapped.
const LENDERS = [
  "البنك األهلي السعودي", "البنك الأهلي السعودي", "مصرف الراجحي", "بنك الرياض", "مصرف اإلنماء", "مصرف الإنماء", "بنك البالد", "بنك الجزيرة",
  "البنك السعودي لالستثمار", "البنك السعودي الفرنسي", "البنك العربي الوطني", "البنك السعودي الأول", "الشركة المتحدة للخدمات المالية", "شركة إمكان للتمويل",
  "النايفات للتمويل", "تمارا المالية", "تابي", "كوارا للتمويل", "عبداللطيف جميل", "اليسر للتمويل", "موبايلي", "زين السعودية", "شركة االتصاالت السعودية",
  "شركة التقسيط الميسر", "مؤسسة تساهيل", "شركة سهل", "مصرف غير معروف", "",
];
const PRODUCTS = ["قرض شخصي", "بطاقة ائتمان", "تمويل منزلي", "تمويل عقاري", "تمويل سيارة", "عقد تأجير", "الهاتف الجوال", "الهاتف الثابت", "تمويل منتجات", "اشتر الآن ادفع لاحقا", "حساب جاري مدين"];
const NOISE = ["ملخص المعلومات الائتمانية", "تفاصيل المنتجات الائتمانية", "الشركة السعودية للمعلومات الائتمانية", "صفحة 3 من 9", "تاريخ الإصدار الحد الائتماني", "12", "0.00", "2024/01/01", "معلومات العميل"];
const noise = () => (chance(0.3) ? pick(["7", "125.50", "2023/06/30 0.00", "A1B2C3D4"]) : rev(pick(NOISE)));

interface Product {
  lines: string[];
  status: string;
  balance: number;
}

function product(): Product {
  const status = pick(["منتج نشط", "منتج نشط", "منتج نشط", "منتج متعثر", "منتج متعثر", "منتج مغلق"]);
  const lines = [rev(`نوع المنتج: ${pick(PRODUCTS)} ${pick(LENDERS)} حالة المنتج ${status}`)];
  const balance = chance(0.1) ? 0 : amount(300, 240000);
  const installment = amount(120, 6500);
  const body: string[] = [];
  if (chance(0.92)) {
    // Issue date, limit, installment count and installment glued, "monthly", end date.
    const glued = pick([`${int(6, 72)}${f2(installment)}`, `${int(6, 72)}`, ""]);
    body.push(`${date(2015, 2025)}${f2(amount(1000, 400000))}${glued}${chance(0.9) ? rev("شهري") : rev("سنوي")}${chance(0.85) ? date(2026, 2045) : ""}`);
  }
  if (chance(0.92)) {
    // Balance, overdue, last update, last payment and its date, next due date, salary assignment.
    const overdue = chance(0.25) ? amount(100, 9000) : 0;
    body.push(`${f2(balance)}${f2(overdue)}${date(2025, 2026)}${f2(amount(0, 7000))}${chance(0.85) ? date(2025, 2026) : ""}${chance(0.5) ? date(2026, 2027) : ""}${pick(["معن", "معن", "لا", "ال", ""])}`);
  }
  if (chance(0.9)) {
    // Last payment, down payment, financed amount, highest installment, nature of the contract, state, average installment.
    const amounts = [f2(amount(0, 9000)), f2(chance(0.7) ? 0 : amount(1000, 90000)), f2(amount(1000, 400000)), f2(chance(0.2) ? 0 : installment)];
    body.push(`${amounts.slice(0, chance(0.9) ? 4 : 3).join("")}${rev("تمويل")}${rev("نشط")}${chance(0.7) ? f2(chance(0.2) ? 0 : installment) : ""}`);
  }
  for (const line of chance(0.2) ? shuffle(body) : body) {
    if (chance(0.35)) lines.push(noise());
    lines.push(line);
  }
  if (chance(0.3)) lines.push(noise());
  return { lines, status, balance };
}

const DEFAULT_STATES = ["غير مدفوع", "غير مدفوع", "مدفوع بالكامل", "مدفوع بالكامل", "مدفوع جزئيا", "تحت التسوية"];

/** A row of the defaulted products table: listing date, amount, what is left, state, and the payment date when paid. */
function defaultRow(amountListed: number): string {
  const stateText = pick(DEFAULT_STATES);
  const now = /بالكامل/.test(stateText) ? 0 : chance(0.6) ? amountListed : Math.round(amountListed * rand() * 100) / 100;
  const paidOn = /بالكامل/.test(stateText) && chance(0.8) ? (chance(0.2) ? ` ${date(2023, 2026)} ` : date(2023, 2026)) : "";
  return `${chance(0.4) ? `${rev(pick(LENDERS))} ` : ""}${date(2020, 2026)}${f2(amountListed)}${f2(now)}${rev(stateText)}${paidOn}`;
}

const ORDER_STATES = ["عدم تنفيذ", "عدم تنفيذ", "منفذ", "تم التنفيذ", "قائم", "جاري", "مسدد", "منتهي", "مغلق", ""];

/** A row of the enforcement court decisions. */
function orderRow(): string {
  const owed = amount(900, 300000);
  const left = chance(0.6) ? owed : Math.round(owed * rand() * 100) / 100;
  const row = `${date(2021, 2026)}${f2(owed)}${f2(left)}${rev(pick(ORDER_STATES))}`;
  if (chance(0.6)) return `${date(2021, 2026)}${int(10000000, 4999999999)}${rev("محكمة التنفيذ بالرياض")}${row}`;
  if (chance(0.5)) return `${rev("طلب تنفيذ")} ${row}`;
  // A row that never names the enforcement court is not read as an order.
  return `${rev("محكمة عامة")} ${row}`;
}

function inquiryRows(): string[] {
  const rows = [rev("اسم المستعلم نوع المنتج المبلغ")];
  const n = int(0, 7);
  for (let i = 0; i < n; i++) {
    const head = `${date(2025, 2026)}${rev(`${pick(PRODUCTS)} ${pick(LENDERS)}`)}`;
    const code = chance(0.5) ? ` ${pick(["REF", "INQ", "X"])}${int(10000, 99999999)}` : "";
    const value = f2(chance(0.1) ? 0 : amount(1000, 600000));
    if (chance(0.7)) rows.push(`${head}${code}${chance(0.2) ? " " : ""}${value}`);
    else {
      // The amount slipped to a following line.
      rows.push(`${head}${code}`);
      if (chance(0.3)) rows.push(noise());
      rows.push(chance(0.85) ? `${rev("ريال")} ${value}` : rev("بدون مبلغ"));
    }
    if (chance(0.15)) rows.push(noise());
  }
  if (chance(0.8)) rows.push(rev(pick(["القرارات الصادرة من محاكم التنفيذ", "قرارات محاكم التنفيذ", "القرار"])));
  return rows;
}

/** The pages of one made-up report. */
export function document(): string[] {
  const products = Array.from({ length: chance(0.08) ? 0 : int(1, 7) }, product);
  const active = products.filter((p) => p.status === "منتج نشط").length;
  const defaulted = products.filter((p) => p.status !== "منتج نشط");

  const header = [rev("التقرير الائتماني الأساسي"), ...(chance(0.88) ? [`${rev("تاريخ التقرير")} ${int(10, 23)}:${int(10, 59)}:${int(10, 59)} ${chance(0.5) ? "-" : " - "} ${date(2026, 2026)}`] : [])];

  const summary: string[] = [];
  if (chance(0.85)) summary.push(`${chance(0.7) ? active : int(0, 9)} ةطشنلا تاجتنملا ادع`);
  if (chance(0.5)) summary.push(`${int(0, 3)} ةلوفكملا ةطشنلا تاجتنملا ادع`);
  if (chance(0.8)) summary.push(`${f2(amount(0, 900000))} ةينامتئالا ادحلا يلامجإ`);
  if (chance(0.8)) summary.push(`${f2(amount(0, 700000))} ةمئاقلا غلابملا يلامجإ`);
  if (chance(0.8)) summary.push(`${int(0, 4)} رثعتملا تاجتنملا ادع`);
  if (chance(0.5)) summary.push(`${date(2012, 2022)} : ${rev("تاريخ أول منتج")}`);

  const defaults: string[] = [rev("المنتجات المتعثرة")];
  for (const p of defaulted) if (chance(0.75)) defaults.push(defaultRow(chance(0.85) ? p.balance : amount(300, 90000)));
  if (chance(0.15)) defaults.push(defaultRow(amount(300, 90000)));

  const orders = Array.from({ length: chance(0.55) ? int(1, 3) : 0 }, orderRow);

  // The report's own total of what is defaulted: sometimes right, sometimes not, sometimes missing.
  if (chance(0.7)) summary.push(`${f2(chance(0.5) ? defaulted.reduce((s, p) => s + p.balance, 0) : amount(0, 300000))} رثعتملا يقبتملا غلبملا`);

  const sections = [header, chance(0.9) ? shuffle(summary) : [], products.flatMap((p) => p.lines), defaults, inquiryRows(), orders];
  const lines = (chance(0.12) ? shuffle(sections) : sections).flat().flatMap((line) => (chance(0.06) ? [line, ""] : [line]));

  // Split into pages, and print a share of the reports in Arabic-Indic digits.
  const pages: string[] = [];
  for (let at = 0; at < lines.length; ) {
    const size = int(8, 40);
    pages.push(lines.slice(at, at + size).join("\n"));
    at += size;
  }
  const indic = chance(0.12);
  return (pages.length ? pages : [""]).map((p) => (indic ? p.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]) : p));
}

const WARNING: [RegExp, string, (m: RegExpMatchArray) => Record<string, number>][] = [
  [/^تعثر بمبلغ ([\d.]+) لم يُطابق بمنتج/, "UNMATCHED_DEFAULT", (m) => ({ amount: Number(m[1]) })],
  [/^الملخص يذكر (\d+) منتجات نشطة وقرأنا (\d+)/, "ACTIVE_COUNT_MISMATCH", (m) => ({ summary: Number(m[1]), read: Number(m[2]) })],
  [/^لم نتمكن من قراءة تفاصيل المنتجات/, "NO_FACILITIES", () => ({})],
  [/^(\d+) قرار تنفيذ بحالة "عدم تنفيذ"/, "SUSPENSION_ASSUMED", (m) => ({ orders: Number(m[1]) })],
  [/^مجموع المتعثرات المقروء (-?\d+) يختلف عن ملخص سمة (-?\d+)/, "DEFAULTS_TOTAL_MISMATCH", (m) => ({ read: Number(m[1]), summary: Number(m[2]) })],
];

/** The old reader's answer, with its warnings as codes. */
export function oldReading(pages: string[]) {
  const RealDate = Date;
  const fixed = `${TODAY.replace(/\//g, "-")}T09:00:00.000Z`;
  // @ts-expect-error the old reader asks the clock for today, so the clock is fixed for the call
  globalThis.Date = class extends RealDate {
    constructor(...args: unknown[]) {
      super(...((args.length ? args : [fixed]) as [string]));
    }
  };
  try {
    const parsed = parseSimahPages(pages);
    const warnings = parsed.warnings.map((text) => {
      const hit = WARNING.find(([re]) => re.test(text));
      if (!hit) throw new Error(`no code for: ${text}`);
      return { code: hit[1], params: hit[2](text.match(hit[0])!) };
    });
    return { report: parsed.report, warnings, confidence: parsed.confidence };
  } finally {
    globalThis.Date = RealDate;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cases = Array.from({ length: CASES }, () => {
    const pages = document();
    return { pages, expected: oldReading(pages) };
  });
  const out = path.join(import.meta.dirname, "../../tests/golden/simah.json");
  fs.writeFileSync(out, `{"seed":${SEED},"today":"${TODAY}","cases":[\n${cases.map((c) => JSON.stringify(c)).join(",\n")}\n]}\n`);
  const tally = (xs: string[]) => Object.fromEntries([...new Set(xs)].sort().map((x) => [x, xs.filter((y) => y === x).length]));
  const all = <T,>(read: (c: (typeof cases)[number]) => T[]) => cases.flatMap(read);
  console.log(`${cases.length} cases -> ${out} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
  console.log("confidence:", tally(cases.map((c) => c.expected.confidence)));
  console.log("warnings:", tally(all((c) => c.expected.warnings.map((w) => w.code))));
  console.log("facilities:", tally(all((c) => c.expected.report.facilities.map((f) => f.status))));
  console.log("creditors:", tally(all((c) => c.expected.report.facilities.map((f) => f.creditorType))));
  console.log("products:", tally(all((c) => c.expected.report.facilities.map((f) => f.product))));
  console.log("lenders:", new Set(all((c) => c.expected.report.facilities.map((f) => f.lender))).size, "distinct");
  console.log("orders:", tally(all((c) => c.expected.report.judgments.map((j) => `${j.active ? "open" : "done"}${j.decisionNo ? "+no" : ""}`))));
  console.log("inquiries:", all((c) => c.expected.report.inquiries ?? []).length, "with amount", all((c) => c.expected.report.inquiries ?? []).filter((q) => q.amount != null).length);
  const facilities = all((c) => c.expected.report.facilities);
  console.log("fields read:", {
    limit: facilities.filter((f) => f.limit != null).length,
    balance: facilities.filter((f) => f.balance != null).length,
    installment: facilities.filter((f) => (f.installment ?? 0) > 0).length,
    endAt: facilities.filter((f) => f.endAt).length,
    lastPayDate: facilities.filter((f) => f.lastPayDate).length,
    listed: facilities.filter((f) => f.defaultListedAt).length,
    settledAge: facilities.filter((f) => f.settledMonthsAgo != null).length,
    of: facilities.length,
  });
  console.log("summary keys:", tally(all((c) => Object.keys(c.expected.report.summary ?? {}))));
  console.log("report date:", cases.filter((c) => c.expected.report.reportDate).length, "suspension assumed:", cases.filter((c) => c.expected.report.serviceSuspension).length);
}
