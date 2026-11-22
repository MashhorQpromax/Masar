import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  capacity,
  requiredDocuments,
  study,
  type Advice,
  type Capacity,
  type Check,
  type FinanceType,
  type Match,
  type Nationality,
  type Point,
  type Product,
  type Profile,
  type Sector,
} from "@/domain/eligibility";

/**
 * Locks the eligibility engine.
 *
 * tests/golden/eligibility.json holds the answers of the engine that ran in production before the
 * rebuild, for 400 generated clients held against the lender catalogue production was seeded with
 * and against products with unusual terms: the room in the income, every check of every product,
 * every amount, the ranking and the advice. The new engine must give the same answer for each one.
 */
interface Case {
  profile: Profile;
  extra: Product[];
  expected: Record<string, unknown>;
}
interface DocumentCase {
  financeType: FinanceType;
  sector: Sector;
  nationality: Nationality;
  expected: [string, string, boolean, string][];
}

const file = path.join(import.meta.dirname, "../golden/eligibility.json");
const golden = JSON.parse(readFileSync(file, "utf8")) as { catalogue: Product[]; documents: DocumentCase[]; cases: Case[] };

/** Same JSON round trip the stored answers went through (drops undefined, turns -0 into 0). */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The percent the old sentence printed for a rule. */
function ruleNumbers(rule: Capacity["rule"], share: number, retired: boolean): number[] {
  if (rule === "TOTAL_CAP") return [Math.round(share * 100)];
  if (rule === "NON_REAL_ESTATE") return [45];
  return [retired ? 25 : 33.33];
}

/** The numbers the old sentence of a check printed, in the order it printed them. */
function checkNumbers(c: Check): number[] {
  switch (c.code) {
    case "SALARY_MIN":
      return [Math.round(c.params.salary), c.params.min];
    case "AGE_BELOW_MIN":
      return [c.params.age, c.params.min];
    case "AGE_OVER_MAX":
      return [c.params.max];
    case "TENOR_SHORTENED":
      return [c.params.tenor, c.params.max];
    case "AGE_AT_END":
      return [c.params.ageAtEnd, c.params.max];
    case "SERVICE_MIN":
      return [c.params.months, c.params.min];
    case "RETIRES_IN_TERM":
      return [c.params.retirementAge, c.params.months, Math.round(c.params.pension), Math.round(c.params.installmentAfter)];
    case "DOWN_PAYMENT":
      return c.params.propertyValue ? [c.params.percent, Math.round(c.params.propertyValue), Math.round(c.params.down ?? 0)] : [c.params.percent, 100 - c.params.percent];
    case "ROOM":
      return [Math.round(c.params.available), ...ruleNumbers(c.params.rule, c.params.share, c.params.retired)];
    default:
      return [];
  }
}

function pointNumbers(p: Point): number[] {
  if (p.code === "DEBT_SHARE") return [p.percent];
  if (p.code === "SHORT_SERVICE") return [3];
  return [];
}

function adviceParts(a: Advice): [string, number[], string[]] {
  switch (a.code) {
    case "BEST_OPTION":
      return [a.code, [Math.round(a.amount), Math.round(a.installment), a.tenor], [`${a.lender} — ${a.product}`]];
    case "PAY_SMALLEST":
      return [a.code, [], [a.lender || a.kind]];
    case "APPLY_ORDER":
      return [a.code, [], a.lenders];
    case "AMOUNT_ABOVE_POSSIBLE":
      return [a.code, [Math.round(a.requested), Math.round(a.possible)], []];
    default:
      return [a.code, [], []];
  }
}

function comparableMatch(m: Match) {
  return {
    product: m.product.id,
    verdict: m.verdict,
    score: m.score,
    tenor: m.tenor,
    maxPrincipal: m.maxPrincipal,
    offerPrincipal: m.offerPrincipal,
    installment: m.installment,
    totalCost: m.totalCost,
    apr: m.apr,
    totalProfit: m.totalProfit,
    fee: m.fee,
    settle12: m.settle12,
    limitedBy: m.limitedBy.code,
    ltv: m.ltv ? { pct: m.ltv.percent, down: m.ltv.down, propertyMax: m.ltv.propertyMax } : null,
    retirement: m.retirement,
    checks: m.checks.map((c) => [c.key, c.status, c.code, checkNumbers(c)]),
  };
}

const HEADLINE_COUNT = /(\d+) جهة/;

describe("eligibility matches the production answers", () => {
  it("has the full set of stored cases", () => {
    expect(golden.cases.length).toBe(400);
    expect(golden.catalogue.length).toBe(14);
  });

  it.each(golden.cases.map((c, i) => [i + 1, c] as const))("client %i", (_n, c) => {
    const before = JSON.stringify(c.profile);
    const s = study(c.profile, [...golden.catalogue, ...c.extra]);
    expect(JSON.stringify(c.profile)).toBe(before);

    const cap = capacity(c.profile);
    expect(s.capacity).toEqual(cap);
    const { headline, ...expected } = c.expected as { headline: string } & Record<string, unknown>;
    expect(
      plain({
        capacity: {
          income: cap.income,
          salary: cap.salary,
          other: cap.otherIncome,
          co: cap.coIncome,
          existingTotal: cap.existingTotal,
          existingNonRealEstate: cap.existingNonRealEstate,
          existingMortgage: cap.existingMortgage,
          salaryDeductionCap: cap.salaryDeductionCap,
          totalCap: cap.totalCap,
          capUsed: cap.capUsed,
          maxInstallment: cap.maxInstallment,
          available: cap.available,
          currentDbr: cap.currentDbr,
          rule: cap.rule,
          warnings: cap.warnings,
        },
        matches: s.matches.map(comparableMatch),
        verdict: s.verdict,
        eligible: s.eligible,
        conditional: s.conditional,
        strengths: s.strengths.map((p) => [p.code, pointNumbers(p)]),
        risks: s.risks.map((p) => [p.code, pointNumbers(p)]),
        advice: s.advice.map(adviceParts),
        missing: s.missing,
      }),
    ).toEqual(expected);

    // The old headline counted the same products the new counts name.
    const counted = HEADLINE_COUNT.exec(headline);
    if (s.verdict === "eligible") expect(Number(counted?.[1])).toBe(s.eligible);
    if (s.verdict === "conditional") expect(Number(counted?.[1])).toBe(s.conditional);
  });
});

describe("required documents match the production answers", () => {
  it("covers every kind of client", () => {
    expect(golden.documents.length).toBe(84);
  });

  it.each(golden.documents.map((d) => [`${d.financeType} ${d.sector} ${d.nationality}`, d] as const))("%s", (_name, d) => {
    // The old list could name a paper twice. The first mention stands.
    const seen = new Set<string>();
    const expected = d.expected.filter(([code]) => !seen.has(code) && seen.add(code)).map(([code, category, required]) => ({ code, category, required }));
    expect(requiredDocuments(d.financeType, d.sector, d.nationality)).toEqual(expected);
  });
});
