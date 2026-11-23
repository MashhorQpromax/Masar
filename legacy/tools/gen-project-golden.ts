// Generates tests/golden/project.json: what the old system said about a project that asks for finance
// against its land and its income, not against a salary. The old study carries its Arabic inside its
// answers, so each alert and each missing paper is named here by a short key, in the order the old
// study gave it. The new `projectStudy` in src/domain/project must reproduce every answer.
// Run with: npm run golden:project
import fs from "node:fs";
import path from "node:path";
import { projectStudy, type ProjectInput } from "../lib/project";

const SEED = 20261127;
const CASES = 320;

let state = SEED >>> 0;
const rand = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const chance = (p: number) => rand() < p;
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const money = (lo: number, hi: number, step = 100_000) => Math.round((lo + rand() * (hi - lo)) / step) * step;

/** The old study's alerts, by the start or the end of their titles. */
const ALERTS: [RegExp, string][] = [
  [/^الصك بلا رقم هوية عقارية$/, "deed"],
  [/^المنطقة المركزية قرب الحرم$/, "haram"],
  [/^المقترض فرد$/, "individual"],
  [/^سعر المتر /, "price"],
  [/^نسبة الطلب /, "ltv"],
  [/من الطلب يزيد على تكلفة البناء$/, "surplus"],
  [/^رهن قائم على الأرض$/, "lien"],
  [/^تغطية خدمة الدين /, "dscr"],
];

/** The papers and facts the old study asked for, by the start of their labels. */
const MISSING: [RegExp, string][] = [
  [/^هوية المقترض/, "borrower"],
  [/^صورة الصك/, "deed"],
  [/^تكلفة البناء التقديرية/, "cost"],
  [/^المسطحات المسموحة/, "gfa"],
  [/^عدد الغرف/, "keys"],
  [/^دراسة جدوى/, "feasibility"],
  [/^رخصة البناء/, "permit"],
  [/^تقرير التقييم الكامل/, "valuation"],
  [/^كشف حساب 12 شهراً/, "statements"],
  [/^تقرير سمة للمالك/, "simah"],
  [/^بيان رأس المال المتاح/, "equity"],
  [/^خطة استخدام المبلغ/, "uses"],
  [/^خطاب نوايا من مشغل/, "operator"],
  [/^إفادة من الأمانة/, "expropriation"],
];

function keyOf(table: [RegExp, string][], text: string): string {
  const found = table.filter(([pattern]) => pattern.test(text));
  if (found.length !== 1) throw new Error(`cannot name: ${text}`);
  return found[0][1];
}

const HEADLINES: Record<string, string> = {
  needs_info: "قابل للدراسة، نحتاج النواقص الأساسية قبل الحكم",
  feasible_restructure: "ممكن بعد إعادة هيكلة الطلب (بناء على مراحل + سيولة محدودة)",
  feasible: "ممكن بالهيكل المقترح",
  weak: "ضعيف بصيغته الحالية، يحتاج رأس مال أو شريك",
};

function facts(index: number): { x: ProjectInput; requested: number } {
  // A few files are complete, so every verdict is reached and not only "needs more".
  const full = index % 4 === 0;
  const hotel = chance(0.45);
  const landValue = !full && chance(0.12) ? null : money(1_000_000, 400_000_000);
  const constructionCost = !full && chance(0.2) ? null : money(2_000_000, 300_000_000);
  const x: ProjectInput = {
    borrowerType: full ? (chance(0.75) ? "company" : "individual") : pick([null, "individual", "individual", "company"] as const),
    city: chance(0.3) ? null : pick(["المدينة المنورة", "مكة المكرمة", "الرياض", "جدة", "أبها"]),
    district: chance(0.5) ? null : "حي تجريبي",
    landArea: !full && chance(0.15) ? null : int(300, 20_000),
    landValue,
    valuer: full ? "مقيّم معتمد" : chance(0.5) ? null : "مقيّم معتمد",
    valuationDate: chance(0.6) ? null : "2026-09-01",
    deed: full ? (chance(0.8) ? "registered" : "electronic") : pick([null, "registered", "registered", "electronic", "paper"] as const),
    projectType: hotel ? "hotel" : pick([null, "residential", "commercial", "mixed"] as const),
    purpose: pick([null, "build", "build", "cashout", "build_cashout"] as const),
    constructionCost,
    gfa: full ? int(1_000, 120_000) : chance(0.35) ? null : int(1_000, 120_000),
    keys: hotel && (full || chance(0.7)) ? int(20, 600) : null,
    adr: hotel && (full || chance(0.7)) ? int(150, 1_500) : null,
    occupancy: hotel && (full || chance(0.7)) ? int(30, 90) : null,
    // No cash and a cash of zero read the same to the old study.
    equityCash: full ? money(1_000_000, 60_000_000) : chance(0.4) ? null : chance(0.1) ? 0 : money(500_000, 60_000_000),
    nearHaram: full ? chance(0.1) : chance(0.3),
    hasPermit: full ? true : chance(0.4),
    hasFeasibility: full ? true : chance(0.4),
    existingLien: chance(0.2),
  };
  // The request is drawn around what the land and the build are worth, so every band of the ratios is met.
  const base = (landValue ?? 0) + (constructionCost ?? 0) || 50_000_000;
  const requested = chance(0.04) ? 0 : Math.max(500_000, Math.round((base * (0.1 + rand() * 0.9)) / 100_000) * 100_000);
  return { x, requested };
}

const cases = Array.from({ length: CASES }, (_, index) => {
  const { x, requested } = facts(index);
  const s = projectStudy(x, requested);
  if (s.headline !== HEADLINES[s.verdict]) throw new Error(`headline of ${s.verdict}`);
  for (const structure of s.structures) if (!structure.how || !structure.needs.length || !structure.lenders.length) throw new Error(`structure ${structure.id}`);
  return {
    x,
    requested,
    expected: {
      totalCost: s.totalCost,
      ltv: s.ltv,
      ltc: s.ltc,
      equityPct: s.equityPct,
      pricePerM2: s.pricePerM2,
      cashoutPart: s.cashoutPart,
      noi: s.noi,
      // A request of nothing has no debt to cover: the old study divides by zero there.
      dscr: s.dscr != null && Number.isFinite(s.dscr) ? s.dscr : null,
      verdict: s.verdict,
      alerts: s.alerts.map((a) => [keyOf(ALERTS, a.title), a.level, a.exit != null]),
      structures: s.structures.map((st) => [st.id, st.fit, st.amount]),
      missing: s.missing.map((m) => [keyOf(MISSING, m.label), m.critical]),
    },
  };
});

const tally = (values: string[]) => Object.fromEntries([...new Set(values)].sort().map((v) => [v, values.filter((x) => x === v).length]));
const out = path.join(import.meta.dirname, "../../tests/golden/project.json");
fs.writeFileSync(out, JSON.stringify({ seed: SEED, cases }) + "\n");
console.log(`${cases.length} cases -> ${path.relative(process.cwd(), out)}`);
console.log("verdicts", tally(cases.map((c) => c.expected.verdict)));
console.log("alerts", tally(cases.flatMap((c) => c.expected.alerts.map((a) => String(a[0])))));
console.log("missing", tally(cases.flatMap((c) => c.expected.missing.map((m) => String(m[0])))));
console.log("structures", tally(cases.flatMap((c) => c.expected.structures.map((s) => `${s[0]}:${s[1]}`))));
