import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeCredit, creditorTypeOf, monthsBetween, parseSimahPages } from "@/domain/credit";

/**
 * Locks the reading of a SIMAH report.
 *
 * tests/golden/simah.json holds 160 made-up report texts, shaped the way PDF extraction returns a real
 * one, and what the reader that ran in production made of each: every product, default, enforcement
 * order and inquiry, the report's own totals, and the warnings. The new reader must read each the same.
 */
interface Case {
  pages: string[];
  expected: { report: unknown; warnings: unknown[]; confidence: string };
}

const file = path.join(import.meta.dirname, "../golden/simah.json");
const { today, cases } = JSON.parse(readFileSync(file, "utf8")) as { today: string; cases: Case[] };

/** Same JSON round trip the stored answers went through. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("the SIMAH reader matches the production reading", () => {
  it("has the full set of stored texts", () => {
    expect(cases.length).toBe(160);
  });

  it.each(cases.map((c, i) => [i + 1, c] as const))("report %i", (_n, c) => {
    expect(plain(parseSimahPages(c.pages, today))).toEqual(c.expected);
  });

  it("gives a reading the grading accepts", () => {
    for (const c of cases) {
      const { report } = parseSimahPages(c.pages, today);
      const analysis = analyzeCredit(report);
      expect(analysis.severity).toBeGreaterThanOrEqual(0);
      // An open enforcement order is read as a service suspension until someone checks, so it always blocks.
      if (report.judgments.some((j) => j.active)) expect(analysis.grade).toBe("E");
    }
  });

  it("reads the same pages the same way whatever today is, when the report carries its date", () => {
    const dated = cases.find((c) => parseSimahPages(c.pages, today).report.reportDate)!;
    const now = parseSimahPages(dated.pages, today);
    const later = parseSimahPages(dated.pages, "2027/06/01");
    expect(later.report.facilities).toEqual(now.report.facilities);
    expect(later.report.reportMonthsAgo).toBeGreaterThan(now.report.reportMonthsAgo ?? 0);
  });
});

describe("reading helpers", () => {
  it("tells who a debt is owed to from the name", () => {
    expect(creditorTypeOf("مصرف الراجحي")).toBe("bank");
    expect(creditorTypeOf("إمكان للتمويل")).toBe("finance_company");
    expect(creditorTypeOf("موبايلي")).toBe("telecom");
    expect(creditorTypeOf("مصرف الراجحي", "الهاتف الجوال")).toBe("telecom");
    expect(creditorTypeOf("جهة غير معروفة")).toBe("other");
  });

  it("counts whole months between two dates and never goes below zero", () => {
    expect(monthsBetween("2025/11/30", "2026/11/01")).toBe(12);
    expect(monthsBetween("2026/11/01", "2026/11/23")).toBe(0);
    expect(monthsBetween("2027/01/01", "2026/11/23")).toBe(0);
  });
});
