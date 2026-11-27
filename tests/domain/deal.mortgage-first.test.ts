import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dealStudy, defaultDealInput, mortgageFirst, type Borrower, type CreditFlags, type DealInput, type DealItem } from "@/domain/deal";
import { principalFrom } from "@/domain/finance/amortization";
import { SAMA } from "@/domain/finance/sama";

/**
 * The mortgage first: the same deal with the monthly room given to the mortgage before the personal
 * finance. It stands beside the deal and never instead of it.
 */
const borrower: Borrower = { age: 35, basicSalary: 12000, totalSalary: 16000, serviceMonths: 120, sector: "gov" };

const items = (payoff: number): DealItem[] => [
  { id: "a", kind: "execution", label: "قرار تنفيذ — شركة تمويل", original: 100000, pay: 100000, by: "company" },
  { id: "b", kind: "default", label: "تعثر — بنك", original: 50000, pay: 40000, by: "company" },
  { id: "c", kind: "mortgage_payoff", label: "مخالصة العقاري — بنك", original: payoff, pay: payoff, by: "company", confirmed: true },
];

/** A salary of 16,000 has 65 percent of it for every installment: 10,400 a month. */
const deal = (payoff: number, propertyValue: number): DealInput => ({ ...defaultDealInput(), items: items(payoff), propertyValue, transferTaxPct: 0 });

describe("the mortgage first", () => {
  const x = deal(900000, 1500000);
  const now = dealStudy(x, borrower);
  const first = dealStudy(x, borrower, null, "mortgage");

  it("leaves the deal's own count as it is", () => {
    expect(dealStudy(x, borrower, null, "personal")).toEqual(now);
    // The personal finance first: its third of the salary, and the mortgage has the rest of the room.
    expect(now.financing.personalInstallment).toBe(5333);
    expect(now.financing.mortgagePre).toBe(5067);
    expect(now.financing.mortgage).toBe(825127);
    expect(now.financing.personal).toBe(278243);
    expect(now.clientNet).toBe(-73749);
    expect(now.verdict).toBe("short");
  });

  it("fills the mortgage up to the property's value, then gives the personal finance what is left", () => {
    expect(first.financing.mortgageByLtv).toBe(1350000); // 1,500,000 × 90%
    expect(first.financing.mortgage).toBe(1350000);
    // The smallest installment that raises it over 300 months at 5.5 percent.
    expect(first.financing.mortgagePre).toBe(8291);
    expect(principalFrom(8291, 300, 5.5, "reducing")).toBeGreaterThanOrEqual(1350000);
    expect(principalFrom(8290, 300, 5.5, "reducing")).toBeLessThan(1350000);
    expect(first.financing.personalInstallment).toBe(2109); // 10,400 − 8,291
    expect(first.financing.personal).toBe(110035); // 2,109 × 60 ÷ 1.15
    expect(first.financing.mortgageByIncome).toBe(1693570); // what all of the room would carry
    expect(first.financing.dbrAfter).toBe(65);
    expect(first.risks.map((risk) => risk.code)).not.toContain("DBR_OVER_CAP");
    expect(first.clientNet).toBe(248931);
    expect(first.verdict).toBe("go");
  });

  it("raises nothing more where the property's value already holds the mortgage", () => {
    const held = deal(700000, 700000);
    const a = dealStudy(held, borrower);
    const b = dealStudy(held, borrower, null, "mortgage");
    expect(a.financing.mortgage).toBe(630000);
    expect(b.financing.mortgage).toBe(630000);
    // The personal finance keeps its third of the salary either way, to the riyal of an installment.
    expect(Math.abs(b.financing.personalInstallment - a.financing.personalInstallment)).toBeLessThanOrEqual(1);
    expect(mortgageFirst(held, borrower)).toBeNull();
  });

  it("gives the mortgage all of the room when the income falls short of the property's value", () => {
    const s = dealStudy(deal(900000, 3000000), borrower, null, "mortgage");
    expect(s.financing.mortgagePre).toBe(10400);
    expect(s.financing.personalInstallment).toBe(0);
    expect(s.financing.personal).toBe(0);
    expect(s.financing.mortgage).toBe(1693570);
    expect(s.risks.map((risk) => risk.code)).toContain("INCOME_BOUND");
  });

  it("steps the installment down at retirement", () => {
    const s = dealStudy(deal(700000, 1200000), { ...borrower, age: 50, serviceMonths: 300 }, null, "mortgage");
    expect(s.financing.mortgage).toBe(1080000);
    expect(s.financing.mortgagePost).toBeLessThan(s.financing.mortgagePre);
    expect(s.financing.mortgagePre + s.financing.personalInstallment).toBeLessThanOrEqual(10400);
  });

  it("counts the installments that stay outside the deal", () => {
    const kept: DealItem = { id: "k", kind: "other", label: "تمويل سيارة — شركة", original: 60000, pay: 60000, by: "out", monthly: 1500 };
    const s = dealStudy({ ...x, items: [...x.items, kept] }, borrower, null, "mortgage");
    expect(s.keptMonthly).toBe(1500);
    expect(s.financing.mortgagePre + s.financing.personalInstallment).toBeLessThanOrEqual(10400 - 1500);
    expect(s.financing.mortgage).toBe(1350000);
  });

  it("stops at a lender's ceiling, and a bank's own offer stands as it is", () => {
    const ceiling = dealStudy({ ...x, mortgageCeiling: 1000000 }, borrower, null, "mortgage");
    expect(ceiling.financing.mortgage).toBe(1000000);
    expect(ceiling.financing.personalInstallment).toBeGreaterThan(first.financing.personalInstallment);
    const offer = dealStudy({ ...x, bankMortgage: 900000 }, borrower, null, "mortgage");
    expect(offer.financing.mortgage).toBe(900000);
  });

  it("changes nothing in a structure with one part", () => {
    for (const structure of ["settle_personal", "settle_refi"] as const) {
      const one = { ...x, structure };
      expect(dealStudy(one, borrower, null, "mortgage")).toEqual(dealStudy(one, borrower));
    }
  });

  it("never goes past the cap, the third of the salary or the property's value", () => {
    let seen = 0;
    for (const salary of [7000, 11000, 15000, 16000, 22000, 30000]) {
      for (const age of [27, 38, 46, 52, 57]) {
        for (const value of [400000, 900000, 1600000, 2800000]) {
          for (const monthly of [0, 1800]) {
            const who: Borrower = { age, basicSalary: Math.round(salary * 0.7), totalSalary: salary, serviceMonths: (age - 24) * 12, sector: "gov" };
            const kept: DealItem[] = monthly ? [{ id: "k", kind: "other", label: "قسط — جهة", original: 50000, pay: 50000, by: "out", monthly }] : [];
            const s = dealStudy({ ...deal(300000, value), items: [...items(300000), ...kept] }, who, null, "mortgage");
            const f = s.financing;
            const room = Math.max(0, salary * f.totalCap - monthly);
            expect(f.mortgagePre + f.personalInstallment).toBeLessThanOrEqual(room);
            expect(f.personalInstallment).toBeLessThanOrEqual(salary * SAMA.salaryDeductionEmployee);
            expect(f.mortgage).toBeLessThanOrEqual(f.mortgageByLtv!);
            expect(f.mortgage).toBeLessThanOrEqual(f.mortgageByIncome);
            expect(f.mortgagePost).toBeLessThanOrEqual(f.mortgagePre);
            expect(s.risks.map((risk) => risk.code)).not.toContain("DBR_OVER_CAP");
            seen += 1;
          }
        }
      }
    }
    expect(seen).toBe(240);
  });
});

describe("the mortgage first as a way out of a deal that is short", () => {
  it("says what it raises when it closes the deal", () => {
    expect(mortgageFirst(deal(900000, 1500000), borrower)).toEqual({
      closes: true,
      mortgage: 1350000,
      personal: 110035,
      mortgageNow: 825127,
      personalNow: 278243,
      clientNet: 248931,
      installment: 8291,
      installmentPct: 52,
    });
  });

  it("says the deficit that stays when it does not", () => {
    const way = mortgageFirst(deal(1500000, 1500000), borrower);
    expect(way?.closes).toBe(false);
    expect(way?.clientNet).toBe(-351069);
    expect(way?.mortgage).toBe(1350000);
  });

  it("says nothing of a deal that closes as it is counted", () => {
    const x = deal(700000, 1200000);
    const older = { ...borrower, age: 50, serviceMonths: 300 };
    expect(dealStudy(x, older).verdict).toBe("go");
    expect(mortgageFirst(x, older)).toBeNull();
  });

  it("says nothing once a bank has answered, or where the deal has one part or no property value", () => {
    const x = deal(900000, 1500000);
    expect(mortgageFirst({ ...x, bankMortgage: 800000 }, borrower)).toBeNull();
    expect(mortgageFirst({ ...x, bankPersonal: 250000 }, borrower)).toBeNull();
    expect(mortgageFirst({ ...x, structure: "settle_personal" }, borrower)).toBeNull();
    expect(mortgageFirst({ ...x, structure: "settle_refi" }, borrower)).toBeNull();
    expect(mortgageFirst({ ...x, propertyValue: null }, borrower)).toBeNull();
  });

  it("is a way only where it leaves the client more, on every stored case", () => {
    const { cases } = JSON.parse(readFileSync(new URL("../golden/deal.json", import.meta.url), "utf8")) as {
      cases: { input: DealInput; borrower: Borrower; credit: CreditFlags | null }[];
    };
    let ways = 0;
    for (const c of cases) {
      const way = mortgageFirst(c.input, c.borrower, c.credit);
      if (!way) continue;
      ways += 1;
      const now = dealStudy(c.input, c.borrower, c.credit);
      expect(now.verdict).toBe("short");
      expect(way.clientNet).toBeGreaterThan(now.clientNet);
      expect(way.mortgage).toBeGreaterThan(way.mortgageNow);
      expect(way.personal).toBeLessThanOrEqual(way.personalNow);
      expect(way.closes ? way.clientNet >= 0 : way.clientNet < 0).toBe(true);
    }
    expect(ways).toBeGreaterThan(0);
  });
});
