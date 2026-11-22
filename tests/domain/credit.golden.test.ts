import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeCredit, type CreditAnalysis, type CreditReport } from "@/domain/credit";
import { creditFlags, itemDrafts, type Owed } from "@/domain/deal";

/**
 * Locks the credit grading.
 *
 * tests/golden/credit.json holds the answers of the engine that ran in production before the rebuild,
 * for 320 generated SIMAH records: every grade, every door, every blocker, finding and step of the plan.
 * The new engine must give the same answer for each one.
 */
interface Case {
  report: CreditReport;
  obligations: Owed[];
  expected: Record<string, unknown> & { flags: unknown; items: { kind: string; label: string; original: number; pay: number; by: string; monthly: number | null }[] };
}

const file = path.join(import.meta.dirname, "../golden/credit.json");
const { cases } = JSON.parse(readFileSync(file, "utf8")) as { cases: Case[] };

/** Same JSON round trip the stored answers went through (drops undefined, turns -0 into 0). */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The old engine printed the rule's numbers only where its sentences named them. */
function comparable(a: CreditAnalysis) {
  return plain({
    grade: a.grade,
    severity: a.severity,
    standing: a.standing,
    banks: a.banks,
    financeCompanies: a.financeCompanies,
    stats: a.stats,
    blockers: a.blockers.map((b) => {
      if (b.code !== "JUDGMENT") return b;
      const { creditorGuessed: _creditorGuessed, ...params } = b.params;
      return { code: b.code, params };
    }),
    findings: a.findings.map((f) => {
      if (f.code === "RECENT_DELAYS") return { level: f.level, code: f.code, params: { count: f.params.count, worstDelay: f.params.worstDelay } };
      if (f.code === "OLD_DELAY") return { level: f.level, code: f.code, params: { worstDelay: f.params.worstDelay } };
      return { level: f.level, code: f.code, params: f.params };
    }),
    actions: a.actions,
  });
}

describe("credit grading matches the production answers", () => {
  it("has the full set of stored cases", () => {
    expect(cases.length).toBe(320);
  });

  it.each(cases.map((c, i) => [i + 1, c] as const))("record %i", (_n, c) => {
    const { flags: _flags, items: _items, ...expected } = c.expected;
    expect(comparable(analyzeCredit(c.report))).toEqual(expected);
  });

  it("leaves the report as it received it", () => {
    for (const c of cases) {
      const before = JSON.stringify(c.report);
      analyzeCredit(c.report);
      itemDrafts(c.report, c.obligations);
      expect(JSON.stringify(c.report)).toBe(before);
    }
  });

  it("hands the deal the same facts", () => {
    for (const c of cases) expect(creditFlags(c.report, analyzeCredit(c.report))).toEqual(c.expected.flags);
  });
});

/**
 * The first list of a deal's items. The old system paired a bounced cheque with a default of about the
 * same amount and then left that default out of the deal. A cheque is its own debt, so the new rule
 * pairs court orders only. Records with an open cheque are covered in credit.examples.test.ts.
 */
describe("deal items suggested from a record match the production answers", () => {
  const withoutOpenCheque = cases.filter((c) => !c.report.judgments.some((j) => j.active && j.kind === "bounced_cheque"));

  it("covers nearly every stored case", () => {
    expect(withoutOpenCheque.length).toBeGreaterThan(290);
  });

  it.each(withoutOpenCheque.map((c) => [cases.indexOf(c) + 1, c] as const))("items %i", (_n, c) => {
    const got = itemDrafts(c.report, c.obligations).map((d) => plain({ kind: d.kind, original: d.original, pay: d.pay, by: d.by, monthly: d.monthly ?? null }));
    expect(got).toEqual(c.expected.items.map(({ label: _label, ...numbers }) => numbers));
  });
});
