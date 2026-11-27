// Generates tests/golden/advisor.json: the old advisor's answers for a fixed set of clients.
// The advisor says what the formula does not: what a lender may ask for beyond its terms, and the
// ways to a larger amount, each one computed again on the engine.
// The new advisor in src/domain/eligibility/advisor.ts must reproduce every condition and every way out.
// Run with: npm run golden:advisor
import fs from "node:fs";
import path from "node:path";
import { hiddenConditions, scenarios } from "../lib/advisor";
import { PRODUCTS, LENDERS } from "../lib/base-data";
import { study, type Product, type Profile } from "../lib/engine";

const SEED = 20261125;
const CASES = 360;

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

function scenario(): Profile {
  const financeType = pick(["personal", "personal", "personal", "personal", "personal", "mortgage", "mortgage", "mortgage", "mortgage", "mortgage", "mortgage", "auto", "auto", "sme", "card", "project"]) as Profile["financeType"];
  const basic = chance(0.08) ? null : money(2500, 26000, 100);
  const total = chance(0.06) ? null : (basic ?? 7000) + money(0, 16000, 100);
  const obligations = Array.from({ length: pick([0, 0, 0, 1, 1, 2, 2, 3, 4, 5]) }, () => ({
    kind: pick(["personal", "personal", "mortgage", "auto", "card", "card", "other"]) as Profile["obligations"][number]["kind"],
    ...(chance(0.7) ? { lender: pick(["مصرف الراجحي", "إمكان للتمويل", "بنك الرياض", "النايفات للتمويل", "البنك الأهلي السعودي"]) } : {}),
    monthly: chance(0.05) ? 0 : money(200, 6000, 50),
    ...(chance(0.75) ? { remaining: chance(0.05) ? 0 : money(2000, 600000, 500) } : {}),
  }));
  const amount = financeType === "mortgage" ? money(300000, 4500000, 10000) : financeType === "auto" ? money(50000, 400000, 5000) : money(20000, 700000, 5000);
  return {
    age: chance(0.06) ? null : int(20, 68),
    nationality: chance(0.85) ? "saudi" : "non_saudi",
    sector: pick([...SECTORS, "gov", "private_approved", "private"]),
    serviceMonths: chance(0.08) ? null : chance(0.2) ? int(0, 11) : int(12, 420),
    basicSalary: basic,
    totalSalary: total,
    ...(chance(0.25) ? { otherIncome: chance(0.85) ? money(500, 12000, 100) : null } : {}),
    salaryBank: chance(0.3) ? null : pick([...BANK_CODES, "other"]),
    simah: pick(["clean", "clean", "clean", "clean", "late", "late", "default", "unknown", "unknown"]),
    ...(chance(0.6) ? { housingSupport: chance(0.35) } : {}),
    financeType,
    requestedAmount: chance(0.2) ? null : amount,
    requestedTenor: chance(0.4) ? null : pick([12, 24, 36, 48, 60, 84, 120, 180, 240, 300, 360]),
    obligations,
    ...(chance(0.7) ? { firstHome: pick([null, true, false]) } : {}),
    propertyValue: chance(0.5) ? null : money(300000, 5000000, 10000),
    ...(chance(0.2) ? { coIncome: chance(0.85) ? money(2000, 15000, 100) : null } : {}),
  };
}

const numbers = (text: string) => (text.match(/-?\d[\d,]*(\.\d+)?/g) ?? []).map((t) => Number(t.replace(/,/g, "")));
const one = (re: RegExp, text: string) => {
  const hit = re.exec(text);
  return hit ? Number(hit[1].replace(/,/g, "")) : null;
};

const SOURCE: Record<string, string> = { "ساما": "SAMA", "ممارسة سوق": "MARKET" };
const EFFORT: Record<string, string> = { "سهل": "easy", "متوسط": "medium", "صعب": "hard" };

/** What a condition says about this client besides its fixed text. */
function facts(id: string, title: string, detail: string): unknown[] {
  switch (id) {
    case "medical":
      return [one(/العمر (\d+)/, detail), one(/نهاية التمويل عند (\d+) سنة/, detail), /يتجاوز 2\.5 مليون/.test(detail)];
    case "retire_personal":
      return [one(/ينتهي التمويل عند (\d+) سنة/, detail)];
    case "stepdown":
      return numbers(detail.slice(0, detail.indexOf(". الجهات تحسب")));
    case "probation":
      return [one(/الخدمة (\d+) شهر/, detail)];
    case "allowances":
      return [one(/الأساسي ([\d,]+)/, detail), one(/إجمالي ([\d,]+)/, detail)];
    case "transfer_lock":
      return [detail.slice("نقل الراتب من ".length, detail.indexOf(" لجهة أخرى")), detail.includes("الالتزام مسجل لدى بنك الراتب نفسه")];
    default:
      return [];
  }
}

const bestOf = (s: ReturnType<typeof study>) => s.matches.filter((m) => m.verdict !== "fail").reduce((mx, m) => Math.max(mx, m.maxPrincipal), 0);

const cases = Array.from({ length: CASES }, () => {
  const profile = scenario();
  const before = JSON.stringify(profile);
  const s = study(profile, catalogue);
  const alerts = hiddenConditions(profile, s);
  const exits = scenarios(profile, catalogue, s);
  if (JSON.stringify(profile) !== before) throw new Error("the old advisor changed its input");
  const expected = {
    base: bestOf(s),
    conditions: alerts.map((a) => {
      const source = SOURCE[a.source];
      if (!source) throw new Error(`no source for: ${a.source}`);
      return [a.id, a.level, source, !!a.exit, facts(a.id, a.title, a.detail)];
    }),
    exits: exits.map((x) => {
      const effort = EFFORT[x.effort];
      if (!effort) throw new Error(`no effort for: ${x.effort}`);
      return [x.key, x.amount, x.gain, x.verdictAfter, effort, x.title, numbers(x.detail), x.steps.length];
    }),
  };
  return { profile, expected };
});

const out = path.join(import.meta.dirname, "../../tests/golden/advisor.json");
fs.writeFileSync(out, `{"seed":${SEED},"catalogue":${JSON.stringify(catalogue)},"cases":[\n${cases.map((c) => JSON.stringify(c)).join(",\n")}\n]}\n`);
const count = (xs: string[]) => Object.fromEntries([...new Set(xs)].sort().map((x) => [x, xs.filter((y) => y === x).length]));
console.log(`${cases.length} cases -> ${out} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
console.log("conditions:", count(cases.flatMap((c) => c.expected.conditions.map((a) => `${a[0]}/${a[1]}`))));
console.log("exits:", count(cases.flatMap((c) => c.expected.exits.map((x) => String(x[0]).replace(/-\d+$/, "")))));
console.log("exits per case:", count(cases.map((c) => String(c.expected.exits.length))));
console.log("lock at salary bank:", cases.filter((c) => c.expected.conditions.some((a) => a[0] === "transfer_lock" && (a[4] as unknown[])[1] === true)).length);
console.log("co with a needed income:", cases.filter((c) => c.expected.exits.some((x) => x[0] === "co" && /براتب/.test(String(x[5])))).length);
