import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONDITION_CODES, CONDITION_LEVEL, CONDITION_SOURCE, conditionDetail, conditionExit, conditionTitle, EFFORT, WAY_OUT_CODES, wayDetail, waySteps, wayTitle } from "@/copy/advisor";
import { advise, type Condition, type Product, type Profile, type WayOut } from "@/domain/eligibility";

const golden = JSON.parse(readFileSync(new URL("../golden/advisor.json", import.meta.url), "utf8")) as {
  catalogue: Product[];
  cases: { profile: Profile; expected: { conditions: [string, string, string, boolean, unknown[]][] } }[];
};
const broken = /undefined|NaN|null|\[object|—/;
const strip = (text: string) => text.replace(/[⁦⁩]/g, "");

describe("the advisor's wording", () => {
  it("has a title, a sentence and a way out for everything the advisor says about 360 clients", () => {
    const conditions = new Set<string>();
    const ways = new Set<string>();
    for (const c of golden.cases) {
      const all = advise(c.profile, golden.catalogue);
      all.conditions.forEach((condition, i) => {
        const title = conditionTitle(condition);
        expect(title.length, condition.code).toBeGreaterThan(3);
        expect(title.endsWith("."), condition.code).toBe(false);
        const detail = conditionDetail(condition);
        expect(detail.length, condition.code).toBeGreaterThan(30);
        expect(detail, condition.code).not.toMatch(broken);
        expect(detail.endsWith("."), condition.code).toBe(true);
        // The same conditions carried a way out before the rebuild, and no others.
        const exit = conditionExit(condition);
        expect(exit != null, condition.code).toBe(c.expected.conditions[i]![3]);
        if (exit != null) {
          expect(exit, condition.code).not.toMatch(broken);
          expect(exit.endsWith("."), condition.code).toBe(true);
        }
        expect(CONDITION_LEVEL[condition.level]).toBeTruthy();
        expect(CONDITION_SOURCE[condition.source]).toBeTruthy();
        conditions.add(condition.code);
      });
      for (const way of all.ways) {
        const title = wayTitle(way);
        expect(title.length, way.code).toBeGreaterThan(8);
        expect(title, way.code).not.toMatch(broken);
        expect(title.endsWith("."), way.code).toBe(false);
        const detail = wayDetail(way);
        expect(detail, way.code).not.toMatch(broken);
        expect(detail.endsWith("."), way.code).toBe(true);
        const steps = waySteps(way);
        expect(steps.length, way.code).toBeGreaterThan(0);
        for (const step of steps) expect(step.endsWith("."), step).toBe(true);
        expect(EFFORT[way.effort]).toBeTruthy();
        ways.add(way.code);
      }
    }
    // Every condition and every way the advisor knows was said at least once.
    expect([...conditions].sort()).toEqual([...CONDITION_CODES].sort());
    expect([...ways].sort()).toEqual([...WAY_OUT_CODES].sort());
    expect(CONDITION_CODES.length).toBe(26);
    expect(WAY_OUT_CODES.length).toBe(7);
  });

  it("says why a medical report may be asked for, reason by reason", () => {
    const medical = (params: { age: number | null; ageAtEnd: number | null; largeAmount: boolean }): Condition => ({ code: "MEDICAL", level: "warn", source: "MARKET", params });
    expect(strip(conditionDetail(medical({ age: 54, ageAtEnd: null, largeAmount: false })))).toContain("العمر 54، فتطلب");
    expect(strip(conditionDetail(medical({ age: null, ageAtEnd: 68, largeAmount: false })))).toContain("التمويل ينتهي وعمره 68 سنة، فتطلب");
    expect(strip(conditionDetail(medical({ age: 54, ageAtEnd: 79, largeAmount: true })))).toContain("العمر 54، والتمويل ينتهي وعمره 79 سنة، والمبلغ فوق 2,500,000، فتطلب");
  });

  it("names the salary bank it knows, and does not print a code for one it does not", () => {
    const lock = (bank: string, sameBank: boolean): Condition => ({ code: "TRANSFER_LOCK", level: "warn", source: "MARKET", params: { bank, sameBank } });
    expect(conditionDetail(lock("rajhi", false))).toContain("نقل الراتب من الراجحي يتطلب");
    expect(conditionDetail(lock("rajhi", true))).toContain("والالتزام مسجل عند بنك الراتب نفسه.");
    expect(conditionDetail(lock("other", false))).toContain("نقل الراتب من بنكه الحالي يتطلب");
    expect(conditionDetail(lock("other", false))).not.toContain("other");
  });

  it("names a debt by its lender, or by its kind when no lender is written", () => {
    const settle = (kind: "personal" | "auto" | "card" | "other", lender: string | null, remaining: number | null, net: number | null): WayOut => ({
      code: "SETTLE",
      params: { index: 0, kind, lender, monthly: 1500, remaining, net },
      amount: 200000,
      gain: 40000,
      verdictAfter: "eligible",
      lifts: false,
      effort: kind === "card" ? "easy" : "medium",
    });
    expect(wayTitle(settle("personal", "بنك الرياض", null, null))).toBe("شراء مديونية بنك الرياض");
    expect(wayTitle(settle("auto", null, null, null))).toBe("شراء مديونية تمويل السيارة");
    expect(wayTitle(settle("card", "مصرف الراجحي", null, null))).toBe("سداد بطاقة مصرف الراجحي وإلغاؤها");
    expect(wayTitle(settle("card", null, null, null))).toBe("سداد البطاقة وإلغاؤها");
    expect(waySteps(settle("card", null, null, null))[0]).toBe("سدّد الرصيد.");
    expect(waySteps(settle("auto", null, null, null))[0]).toBe("اطلب خطاب مديونية محدثاً.");
    // What is left after the debt is paid, or how far the new finance falls short of it.
    expect(strip(wayDetail(settle("personal", null, null, null)))).toBe("يحرر 1,500 من القسط الشهري.");
    expect(strip(wayDetail(settle("personal", null, 60000, 140000)))).toBe("يحرر 1,500 من القسط الشهري. المتبقي 60,000، وصافي النقد بعد سداده 140,000.");
    expect(strip(wayDetail(settle("personal", null, 260000, -60000)))).toBe("يحرر 1,500 من القسط الشهري. المتبقي 260,000، وهو أكثر مما يعطيه التمويل الجديد بمبلغ 60,000.");
  });

  it("says whether a co-borrower's income is what the request needs or only an example", () => {
    const co = (income: number, covers: number | null): WayOut => ({ code: "CO_BORROWER", params: { income, covers }, amount: 900000, gain: 200000, verdictAfter: "eligible", lifts: false, effort: "medium" });
    expect(strip(wayTitle(co(6500, 900000)))).toBe("متضامن دخله 6,500 تقريباً");
    expect(strip(wayDetail(co(6500, 900000)))).toBe("هذا أقل دخل لمتضامن يغطي المطلوب، وهو 900,000.");
    expect(wayTitle(co(8000, null))).toBe("إضافة متضامن");
    expect(strip(wayDetail(co(8000, null)))).toContain("مثال بمتضامن دخله 8,000.");
  });
});
