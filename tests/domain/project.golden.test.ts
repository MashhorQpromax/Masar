import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { projectStudy, type GapCode, type ProjectAlert, type ProjectFacts } from "@/domain/project";

/**
 * Locks the project study.
 *
 * tests/golden/project.json holds what the study that ran in production said about 320 generated
 * projects: the ratios, the verdict, every alert with its level, every way to finance it with its
 * fit and amount, and every paper it asked for. The new study must say the same about each one.
 */
interface Case {
  x: ProjectFacts;
  requested: number;
  expected: {
    totalCost: number | null;
    ltv: number | null;
    ltc: number | null;
    equityPct: number | null;
    pricePerM2: number | null;
    cashoutPart: number | null;
    noi: number | null;
    dscr: number | null;
    verdict: string;
    alerts: [string, string, boolean][];
    structures: [string, string, number | null][];
    missing: [string, boolean][];
  };
}

const file = path.join(import.meta.dirname, "../golden/project.json");
const golden = JSON.parse(readFileSync(file, "utf8")) as { cases: Case[] };

/** The key the generator gave each of the old study's alerts. */
const OLD_ALERT: Record<ProjectAlert["code"], string> = {
  DEED_UNREGISTERED: "deed",
  NEAR_HARAM: "haram",
  INDIVIDUAL_BORROWER: "individual",
  HIGH_LAND_PRICE: "price",
  CASH_ABOVE_LAND_LIMIT: "ltv",
  ABOVE_BUILD_COST: "surplus",
  EXISTING_LIEN: "lien",
  LOW_COVER: "dscr",
};

/** The key the generator gave each paper the old study asked for. */
const OLD_GAP: Record<GapCode, string> = {
  BORROWER_TYPE: "borrower",
  DEED_COPY: "deed",
  BUILD_COST: "cost",
  BUILT_AREA: "gfa",
  ROOMS: "keys",
  FEASIBILITY: "feasibility",
  PERMIT: "permit",
  VALUATION_REPORT: "valuation",
  STATEMENTS: "statements",
  CREDIT_REPORT: "simah",
  OWNER_CASH: "equity",
  USE_OF_FUNDS: "uses",
  OPERATOR_LETTER: "operator",
  NO_EXPROPRIATION: "expropriation",
};

describe("the project study against the old system", () => {
  it("has the cases the generator wrote", () => {
    expect(golden.cases).toHaveLength(320);
    // Every verdict is reached, so none of them is locked by its absence.
    expect(new Set(golden.cases.map((c) => c.expected.verdict))).toEqual(new Set(["feasible", "feasible_restructure", "needs_info", "weak"]));
    expect(new Set(golden.cases.flatMap((c) => c.expected.alerts.map((a) => a[0])))).toEqual(new Set(Object.values(OLD_ALERT)));
    expect(new Set(golden.cases.flatMap((c) => c.expected.missing.map((m) => m[0])))).toEqual(new Set(Object.values(OLD_GAP)));
  });

  it.each(golden.cases.map((c, index) => [index, c] as const))("project %i", (_index, c) => {
    const before = JSON.stringify(c.x);
    const s = projectStudy(c.x, c.requested);
    expect({
      totalCost: s.totalCost,
      ltv: s.ltv,
      ltc: s.ltc,
      equityPct: s.equityPct,
      pricePerM2: s.pricePerM2,
      cashoutPart: s.cashoutPart,
      noi: s.noi,
      dscr: s.dscr,
      verdict: s.verdict,
      // Every alert of the old study came with a way out. The new wording is tested to give one for each code.
      alerts: s.alerts.map((a) => [OLD_ALERT[a.code], a.level, true]),
      structures: s.structures.map((st) => [st.id, st.fit, st.amount]),
      missing: s.gaps.map((g) => [OLD_GAP[g.code], g.critical]),
    }).toEqual(c.expected);
    expect(s.requested).toBe(c.requested);
    // The numbers an alert carries are the study's own.
    for (const alert of s.alerts) {
      if (alert.code === "HIGH_LAND_PRICE") expect(alert.pricePerM2).toBe(s.pricePerM2);
      if (alert.code === "CASH_ABOVE_LAND_LIMIT") expect(alert.ltv).toBe(s.ltv);
      if (alert.code === "ABOVE_BUILD_COST") expect(alert.amount).toBe(s.cashoutPart);
      if (alert.code === "LOW_COVER") expect(alert.dscr).toBe(s.dscr);
    }
    expect(JSON.stringify(c.x)).toBe(before);
  });
});
