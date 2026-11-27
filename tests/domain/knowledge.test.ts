import { describe, expect, it } from "vitest";
import { acceptance, ASKS, DECISIONS, experience, FEW_DECISIONS, knownFor, REFUSALS, RULE_KINDS, rulesByLender, rulesFor, SIMILAR_SALARY_BAND, type DecisionFact, type Rule } from "@/domain/knowledge";

const rule = (id: number, lenderId: number | null, financeType: Rule["financeType"], kind: Rule["kind"] = "condition"): Rule => ({
  id,
  lenderId,
  lenderName: lenderId == null ? null : `جهة ${lenderId}`,
  financeType,
  kind,
  title: `ملاحظة ${id}`,
  body: null,
  author: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
});

const rules = [rule(1, null, null, "warning"), rule(2, 7, "mortgage"), rule(3, null, "personal", "tip"), rule(4, 7, null, "exception"), rule(5, 9, "mortgage"), rule(6, null, "mortgage", "tip")];

const fact = (lenderId: number, decision: DecisionFact["decision"], more: Partial<DecisionFact> = {}): DecisionFact => ({
  lenderId,
  financeType: "mortgage",
  sector: "gov",
  salary: 12000,
  decision,
  estimatedAmount: null,
  approvedAmount: null,
  conditions: [],
  reason: null,
  ...more,
});

describe("the notes that bear on a lender", () => {
  it("gives a lender its own notes first, then the ones written for every lender", () => {
    expect(rulesFor(rules, { lenderId: 7, financeType: "mortgage" }).map((r) => r.id)).toEqual([2, 4, 1, 6]);
    expect(rulesFor(rules, { lenderId: 7, financeType: "personal" }).map((r) => r.id)).toEqual([4, 1, 3]);
    expect(rulesFor(rules, { lenderId: 9, financeType: "mortgage" }).map((r) => r.id)).toEqual([5, 1, 6]);
  });

  it("gives a lender nobody wrote about only what holds for every lender", () => {
    expect(rulesFor(rules, { lenderId: 11, financeType: "auto" }).map((r) => r.id)).toEqual([1]);
    expect(rulesFor([], { lenderId: 7, financeType: "mortgage" })).toEqual([]);
  });

  it("groups notes lender by lender, with the ones for every lender first", () => {
    const groups = rulesByLender(rules);
    expect(groups.map((g) => g.lenderId)).toEqual([null, 7, 9]);
    expect(groups.map((g) => g.rules.map((r) => r.id))).toEqual([[1, 3, 6], [2, 4], [5]]);
    expect(groups[0]!.lenderName).toBeNull();
    expect(groups[1]!.lenderName).toBe("جهة 7");
    // Nothing is lost and nothing is said twice.
    expect(groups.flatMap((g) => g.rules).length).toBe(rules.length);
    expect(rulesByLender([])).toEqual([]);
  });

  it("leaves the notes it was given as they were", () => {
    const before = JSON.stringify(rules);
    rulesFor(rules, { lenderId: 7, financeType: "mortgage" });
    rulesByLender(rules);
    expect(JSON.stringify(rules)).toBe(before);
  });
});

describe("what is known about the lenders of a route", () => {
  const facts = [fact(7, "approved"), fact(7, "rejected"), fact(9, "approved", { financeType: "personal" })];
  const records = { mortgage: experience(facts, "mortgage"), personal: experience(facts, "personal") };

  it("gives each part its lender's record and its own notes, never the ones for every lender", () => {
    const known = knownFor(
      [
        { part: "mortgage", lenderId: 7 },
        { part: "personal", lenderId: 9 },
      ],
      rules,
      records,
    );
    expect(known.map((k) => [k.part, k.lenderId, k.record?.n ?? null, k.notes.map((r) => r.id)])).toEqual([
      ["mortgage", 7, 2, [2, 4]],
      // Lender 9 wrote nothing about personal finance, but it answered once.
      ["personal", 9, 1, []],
    ]);
  });

  it("lists a note that bears on both parts once, under the first", () => {
    const known = knownFor(
      [
        { part: "mortgage", lenderId: 7 },
        { part: "personal", lenderId: 7 },
      ],
      rules,
      records,
    );
    // Lender 7 never answered for personal finance, and its only other note was already said.
    expect(known.map((k) => [k.part, k.notes.map((r) => r.id)])).toEqual([["mortgage", [2, 4]]]);
    // Asked the other way round, the note for every kind goes under personal.
    const turned = knownFor(
      [
        { part: "personal", lenderId: 7 },
        { part: "mortgage", lenderId: 7 },
      ],
      rules,
      records,
    );
    expect(turned.map((k) => [k.part, k.notes.map((r) => r.id)])).toEqual([
      ["personal", [4]],
      ["mortgage", [2]],
    ]);
  });

  it("leaves out a part nothing is known about", () => {
    expect(knownFor([{ part: "mortgage", lenderId: 11 }], rules, records)).toEqual([]);
    expect(knownFor([], rules, records)).toEqual([]);
    // A record alone is enough, and so is a note alone.
    expect(knownFor([{ part: "mortgage", lenderId: 7 }], [], records).map((k) => k.record?.approved)).toEqual([1]);
    expect(knownFor([{ part: "mortgage", lenderId: 9 }], rules, { mortgage: new Map(), personal: new Map() }).map((k) => k.notes.map((r) => r.id))).toEqual([[5]]);
  });
});

describe("what a lender's answers add up to", () => {
  it("counts a yes on other terms as a yes", () => {
    const e = experience([fact(1, "approved"), fact(1, "approved_modified"), fact(1, "rejected", { reason: "dbr" })], "mortgage").get(1)!;
    expect(e).toMatchObject({ n: 3, approved: 2, rejected: 1, reasons: [["dbr", 1]] });
    expect(acceptance(e)).toBe(67);
  });

  it("says nothing about a lender that never answered", () => {
    expect(experience([], "mortgage").size).toBe(0);
    expect(experience([fact(1, "approved")], "personal").size).toBe(0);
    expect(acceptance({ n: 0, approved: 0 })).toBeNull();
    expect(acceptance({ n: 4, approved: 4 })).toBe(100);
    expect(acceptance({ n: 4, approved: 0 })).toBe(0);
  });

  it("counts as similar a client of the same sector whose salary is near", () => {
    const rows = [
      fact(1, "approved", { salary: 12000 }),
      // The edge of the band is inside it: 16,200 is 35% above 12,000.
      fact(1, "rejected", { salary: 16200 }),
      fact(1, "approved", { salary: 16201 }),
      fact(1, "approved", { sector: "private" }),
      // A decision that kept no salary cannot be told apart, so it counts.
      fact(1, "approved", { salary: null }),
    ];
    expect(SIMILAR_SALARY_BAND).toBe(0.35);
    const e = experience(rows, "mortgage", { sector: "gov", salary: 12000 }).get(1)!;
    expect(e).toMatchObject({ n: 5, similarN: 3, similarApproved: 2 });
    // Asked about nobody in particular, every decision is similar.
    expect(experience(rows, "mortgage").get(1)).toMatchObject({ similarN: 5, similarApproved: 4 });
  });

  it("compares what was given with what was expected only where both are known", () => {
    const rows = [
      fact(1, "approved", { estimatedAmount: 800000, approvedAmount: 720000 }),
      fact(1, "approved_modified", { estimatedAmount: 500000, approvedAmount: 500000 }),
      fact(1, "approved", { estimatedAmount: null, approvedAmount: 400000 }),
      fact(1, "rejected", { estimatedAmount: 900000 }),
      fact(2, "approved", { approvedAmount: 300000 }),
    ];
    const all = experience(rows, "mortgage");
    expect(all.get(1)!.ratio).toBe(0.95);
    expect(all.get(2)!.ratio).toBeNull();
  });

  it("ranks what a lender asked for by how often it asked", () => {
    const rows = [fact(1, "approved", { conditions: ["medical", "salary_transfer"] }), fact(1, "approved_modified", { conditions: ["salary_transfer"] }), fact(1, "rejected", { conditions: ["guarantor"], reason: "simah" })];
    const e = experience(rows, "mortgage").get(1)!;
    expect(e.conditions).toEqual([
      ["salary_transfer", 2],
      ["medical", 1],
      ["guarantor", 1],
    ]);
    expect(e.reasons).toEqual([["simah", 1]]);
  });

  it("keeps its lists of codes free of repeats", () => {
    for (const list of [RULE_KINDS, DECISIONS, ASKS, REFUSALS]) expect(new Set(list).size).toBe(list.length);
    expect(ASKS).toContain("other");
    expect(REFUSALS).toContain("other");
    expect(FEW_DECISIONS).toBeGreaterThan(1);
  });
});
