import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { advise, bankShortName, bestAmount, hiddenConditions, study, WAY_OUT_MIN_GAIN, waysOut, type Condition, type Product, type Profile, type StudyVerdict, type WayOut } from "@/domain/eligibility";

/**
 * Locks the advisor.
 *
 * tests/golden/advisor.json holds what the advisor that ran in production said about 360 generated
 * clients held against the lender catalogue production was seeded with: every condition a lender may
 * ask for, with its level, and every way to a larger amount, with what the engine gave once it was
 * taken. The new advisor must say the same about each one.
 */
interface Case {
  profile: Profile;
  expected: { base: number; conditions: [string, string, string, boolean, unknown[]][]; exits: [string, number, number, string, string, string, number[], number][] };
}

const file = path.join(import.meta.dirname, "../golden/advisor.json");
const golden = JSON.parse(readFileSync(file, "utf8")) as { catalogue: Product[]; cases: Case[] };

/** The name the old advisor gave each condition. */
const OLD_ID: Record<Condition["code"], string> = {
  MEDICAL: "medical",
  YOUNG_FOR_MORTGAGE: "young",
  ENDS_AFTER_RETIREMENT: "retire_personal",
  STEP_DOWN: "stepdown",
  RESIDENT: "iqama",
  RESIDENT_MORTGAGE: "expat_mortgage",
  EMPLOYER_NOT_LISTED: "employer_list",
  SHORT_SERVICE: "probation",
  GOSI_MATCH: "gosi_match",
  ALLOWANCES: "allowances",
  SELF_EMPLOYED: "self",
  MILITARY: "military",
  RETIRED: "retired",
  RECORD_LATE: "simah_late",
  RECORD_DEFAULT: "simah_default",
  RECORD_UNKNOWN: "simah_unknown",
  TRANSFER_LOCK: "transfer_lock",
  CARDS: "cards",
  TOP_UP: "topup",
  SECOND_HOME: "second_home",
  HOUSING_SUPPORT: "sakani",
  VALUATION: "valuation",
  CAR_COSTS: "auto_ins",
  CARD_LIMIT: "card_limit",
  LIVING_COSTS: "living",
  ONE_AT_A_TIME: "inquiries",
};

/** What the old sentence of a condition said about this client. */
function facts(c: Condition): unknown[] {
  switch (c.code) {
    case "MEDICAL":
      return [c.params.age, c.params.ageAtEnd, c.params.largeAmount];
    case "ENDS_AFTER_RETIREMENT":
      return [c.params.ageAtEnd];
    case "STEP_DOWN":
      return [c.params.retirementAge, c.params.months, Math.round(c.params.pension), Math.round(c.params.installmentAfter)];
    case "SHORT_SERVICE":
      return [c.params.months];
    case "ALLOWANCES":
      return [Math.round(c.params.basic), Math.round(c.params.total)];
    case "TRANSFER_LOCK":
      return [bankShortName(c.params.bank), c.params.sameBank];
    default:
      return [];
  }
}

const KIND_SAID: Record<string, string> = { card: "بطاقة", auto: "سيارة" };
const years = (months: number) => Math.round((months / 12) * 10) / 10;
const said = (n: number) => Math.round(n).toLocaleString("en-US");

/** The old name, title and numbers of a way out. */
function old(way: WayOut): { key: string; title: string; numbers: number[]; steps: number } {
  switch (way.code) {
    case "SETTLE": {
      const { index, kind, lender, monthly, remaining, net } = way.params;
      const name = `${lender ?? ""} (${KIND_SAID[kind] ?? "شخصي"})`.trim();
      return {
        key: `settle-${index}`,
        title: kind === "card" ? `إلغاء/سداد بطاقة ${lender ?? ""}` : `شراء مديونية ${name}`,
        numbers: [Math.round(monthly), ...(remaining ? [Math.round(remaining), Math.round(net ?? 0)] : [])],
        steps: 3,
      };
    }
    case "CONSOLIDATE":
      return { key: "consolidate", title: "إعادة تمويل شاملة (دمج كل الأقساط)", numbers: way.params.remaining ? [Math.round(way.params.remaining)] : [], steps: 3 };
    case "LONGER_TENOR":
      return { key: "tenor", title: "مدّ المدة لأقصى ما تسمح به الجهة", numbers: [way.params.tenor, years(way.params.tenor)], steps: 1 };
    case "CO_BORROWER":
      return way.params.covers != null
        ? { key: "co", title: `إضافة متضامن براتب ${said(way.params.income)} ريال تقريباً`, numbers: [Math.round(way.params.covers)], steps: 3 }
        : { key: "co", title: "إضافة متضامن (الزوج/الزوجة)", numbers: [way.params.income], steps: 3 };
    case "HOUSING_SUPPORT":
      return { key: "sakani", title: "التسجيل في الدعم السكني (سكني)", numbers: [65, 15], steps: 3 };
    case "CLEAR_RECORD":
      return { key: "simah", title: "تسوية سمة ثم إعادة التقديم", numbers: [30], steps: 4 };
    case "END_AT_RETIREMENT":
      return { key: "pre-ret", title: `مدة تنتهي عند التقاعد (${years(way.params.months)} سنة)`, numbers: [Math.round(way.params.installment)], steps: 1 };
  }
}

const RANK: Record<StudyVerdict, number> = { not_eligible: 0, pending: 1, conditional: 2, eligible: 3 };

describe("the advisor matches the production answers", () => {
  it("has the full set of stored cases", () => {
    expect(golden.cases.length).toBe(360);
    expect(golden.catalogue.length).toBe(14);
  });

  it.each(golden.cases.map((c, i) => [i + 1, c] as const))("client %i", (_n, c) => {
    const before = JSON.stringify(c.profile);
    const s = study(c.profile, golden.catalogue);
    const conditions = hiddenConditions(c.profile, s);
    const ways = waysOut(c.profile, golden.catalogue, s);
    expect(JSON.stringify(c.profile)).toBe(before);

    expect(bestAmount(s)).toBe(c.expected.base);
    expect(conditions.map((x) => [OLD_ID[x.code], x.level, x.source, facts(x)])).toEqual(c.expected.conditions.map(([id, level, source, , f]) => [id, level, source, f]));
    expect(
      ways.map((way) => {
        const o = old(way);
        return [o.key, way.amount, way.gain, way.verdictAfter, way.effort, o.title, o.numbers, o.steps];
      }),
    ).toEqual(c.expected.exits);

    // A way is listed for what it adds or for the verdict it lifts, and says which.
    for (const way of ways) {
      expect(way.lifts, way.code).toBe(RANK[way.verdictAfter] > RANK[s.verdict]);
      if (way.code !== "END_AT_RETIREMENT") expect(way.gain > WAY_OUT_MIN_GAIN || way.lifts, way.code).toBe(true);
    }

    const all = advise(c.profile, golden.catalogue);
    expect(all.conditions).toEqual(conditions);
    expect(all.ways).toEqual(ways);
    expect(all.bestAmount).toBe(c.expected.base);
  });
});
