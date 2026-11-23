import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { advise, BASIC_SHARE_ASSUMED, QUICK_DEFAULTS, QUICK_FINANCE_TYPES, quickBasicSalary, quickProfile, type Product, type Profile, type QuickFacts } from "@/domain/eligibility";

/**
 * The calculator's facts become the profile the old calculator built: a citizen with no salary bank
 * named, a basic salary taken as 70 percent of the total when it is not typed, and what is paid every
 * month as one consumer installment and one mortgage installment.
 */
const catalogue = (JSON.parse(readFileSync(path.join(import.meta.dirname, "../golden/advisor.json"), "utf8")) as { catalogue: Product[] }).catalogue;

const facts = (change: Partial<QuickFacts> = {}): QuickFacts => ({ ...QUICK_DEFAULTS, ...change });

describe("the calculator's profile", () => {
  it("starts where the old calculator started", () => {
    const expected: Profile = {
      age: 35,
      nationality: "saudi",
      sector: "gov",
      serviceMonths: 36,
      basicSalary: 12000 * 0.7,
      totalSalary: 12000,
      salaryBank: null,
      simah: "clean",
      housingSupport: false,
      financeType: "personal",
      requestedAmount: null,
      requestedTenor: null,
      obligations: [],
      firstHome: true,
      propertyValue: null,
      coIncome: null,
    };
    expect(quickProfile(QUICK_DEFAULTS)).toEqual(expected);
  });

  it("takes the basic salary as typed, and as a share of the total when it is not", () => {
    expect(BASIC_SHARE_ASSUMED).toBe(0.7);
    expect(quickBasicSalary({ totalSalary: 20000, basicSalary: null })).toBe(14000);
    expect(quickBasicSalary({ totalSalary: 20000, basicSalary: 0 })).toBe(14000);
    expect(quickBasicSalary({ totalSalary: 20000, basicSalary: 9000 })).toBe(9000);
    expect(quickBasicSalary({ totalSalary: null, basicSalary: null })).toBeNull();
    expect(quickProfile(facts({ totalSalary: 20000, basicSalary: 9000 })).basicSalary).toBe(9000);
  });

  it("reads what is paid every month as a consumer installment and a mortgage installment", () => {
    expect(quickProfile(facts({ installments: 1500 })).obligations).toEqual([{ kind: "personal", monthly: 1500 }]);
    expect(quickProfile(facts({ mortgageInstallment: 3200 })).obligations).toEqual([{ kind: "mortgage", monthly: 3200 }]);
    expect(quickProfile(facts({ installments: 1500, mortgageInstallment: 3200 })).obligations).toEqual([
      { kind: "personal", monthly: 1500 },
      { kind: "mortgage", monthly: 3200 },
    ]);
    expect(quickProfile(facts({ installments: 0, mortgageInstallment: 0 })).obligations).toEqual([]);
  });

  it("carries the facts of a mortgage", () => {
    const p = quickProfile(facts({ financeType: "mortgage", propertyValue: 900000, coIncome: 7000, secondHome: true, housingSupport: true, requestedAmount: 800000, requestedTenor: 240 }));
    expect(p).toMatchObject({ financeType: "mortgage", propertyValue: 900000, coIncome: 7000, firstHome: false, housingSupport: true, requestedAmount: 800000, requestedTenor: 240 });
  });

  it("keeps an empty number empty, so the engine says what is missing", () => {
    const p = quickProfile(facts({ totalSalary: null, age: null, serviceMonths: null, requestedAmount: 0, requestedTenor: 0, propertyValue: 0, coIncome: 0 }));
    expect(p).toMatchObject({ totalSalary: null, basicSalary: null, age: null, serviceMonths: null, requestedAmount: null, requestedTenor: null, propertyValue: null, coIncome: null });
  });

  it("makes a resident of someone who is not a citizen", () => {
    expect(quickProfile(facts({ resident: true })).nationality).toBe("non_saudi");
    expect(quickProfile(facts()).nationality).toBe("saudi");
  });

  it("does not change what was typed", () => {
    const typed = facts({ installments: 900, mortgageInstallment: 2000 });
    const before = JSON.stringify(typed);
    quickProfile(typed);
    expect(JSON.stringify(typed)).toBe(before);
  });
});

describe("a quick estimate on the base catalogue", () => {
  it("answers every kind of finance the calculator offers", () => {
    for (const financeType of QUICK_FINANCE_TYPES) {
      const answer = advise(quickProfile(facts({ financeType, propertyValue: financeType === "mortgage" ? 1_000_000 : null })), catalogue);
      expect(answer.matches.length, financeType).toBeGreaterThan(0);
      expect(answer.matches.every((m) => m.product.financeType === financeType)).toBe(true);
      expect(answer.bestAmount, financeType).toBeGreaterThan(0);
      expect(answer.eligible + answer.conditional, financeType).toBeGreaterThan(0);
    }
  });

  it("gives less to a client who already pays an installment, and names the way to more", () => {
    const free = advise(quickProfile(facts()), catalogue);
    const owing = advise(quickProfile(facts({ installments: 2000 })), catalogue);
    expect(owing.bestAmount).toBeLessThan(free.bestAmount);
    expect(owing.capacity.available).toBe(free.capacity.available - 2000);
    const settle = owing.ways.find((way) => way.code === "SETTLE");
    expect(settle?.amount).toBe(free.bestAmount);
    expect(settle?.gain).toBe(free.bestAmount - owing.bestAmount);
  });

  it("finds no lender for a client with a standing default, and says the record is what to fix", () => {
    const answer = advise(quickProfile(facts({ simah: "default" })), catalogue);
    expect(answer.eligible + answer.conditional).toBe(0);
    expect(answer.bestAmount).toBe(0);
    expect(answer.conditions[0]).toMatchObject({ code: "RECORD_DEFAULT", level: "block" });
    expect(answer.ways.find((way) => way.code === "CLEAR_RECORD")?.amount).toBeGreaterThan(0);
  });
});
