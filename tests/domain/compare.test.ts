import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compareScenarios,
  dealStudy,
  defaultDealInput,
  movedLevers,
  scenarioFigures,
  scenarioInput,
  type Borrower,
  type DealInput,
  type DealItem,
  type Levers,
} from "@/domain/deal";

/** Two scenarios of one deal on the same rows, with the difference in riyals on each. */
const borrower: Borrower = { age: 35, basicSalary: 12000, totalSalary: 16000, serviceMonths: 120, sector: "gov" };

const items: DealItem[] = [
  { id: "a", kind: "execution", label: "قرار تنفيذ 4471 — شركة تمويل", original: 100000, pay: 100000, by: "company", confirmed: true },
  { id: "b", kind: "default", label: "تعثر — بنك", original: 50000, pay: 40000, by: "company" },
  { id: "c", kind: "mortgage_payoff", label: "مخالصة العقاري — بنك", original: 400000, pay: 380000, by: "company", confirmed: true },
  { id: "d", kind: "personal_payoff", label: "مخالصة الشخصي — بنك", original: 60000, pay: 60000, by: "bank", monthly: 2000 },
];

const base: DealInput = {
  ...defaultDealInput(),
  items,
  propertyValue: 800000,
  transferTaxPct: 0,
  saleTaxPct: 0,
  fixedCosts: 10000,
  bankMortgage: 720000,
  bankPersonal: 200000,
};
const figures = (input: DealInput) => scenarioFigures(input, dealStudy(input, borrower));
const both = (levers: Levers) => compareScenarios(figures(base), figures(scenarioInput(base, levers)));
const row = (rows: ReturnType<typeof both>, name: string) => rows.find((r) => r.row === name)!;

describe("two scenarios side by side", () => {
  it("reads the deal as it stands on the same rows the client's net is read on", () => {
    const a = figures(base);
    // 720,000 + 200,000 - 580,000 - 12,000 - 106,000 = 222,000; the office puts in 530,000.
    expect(a.figures).toEqual({ mortgage: 720000, personal: 200000, obligations: 580000, costs: 12000, fee: 106000, clientNet: 222000, capital: 530000 });
    expect(a.verdict).toBe("go");
  });

  it("gives the difference in riyals on every row, and nothing moves when no lever does", () => {
    const same = both({});
    expect(same.every((r) => r.diff === 0)).toBe(true);
    expect(same.map((r) => r.row)).toEqual(["mortgage", "personal", "obligations", "costs", "fee", "clientNet", "capital"]);

    // Fifteen percent on the financing instead of ten: 46,000 more for the office, 46,000 less for the client.
    const fee = both({ financePct: 15 });
    expect(row(fee, "fee")).toMatchObject({ a: 106000, b: 152000, diff: 46000 });
    expect(row(fee, "clientNet")).toMatchObject({ a: 222000, b: 176000, diff: -46000 });
    expect(row(fee, "mortgage").diff).toBe(0);
  });

  it("takes a discount off the court orders and defaults only, and the settlement fee with it", () => {
    // Twenty percent off 140,000 is 28,000 less to settle, and 2,800 less of settlement fee.
    const rows = both({ discountPct: 20 });
    expect(row(rows, "obligations").diff).toBe(-28000);
    expect(row(rows, "fee").diff).toBe(-2800);
    expect(row(rows, "clientNet").diff).toBe(30800);
    expect(row(rows, "capital").diff).toBe(-28000);
    // A discounted amount is no longer what a letter says.
    const discounted = scenarioInput(base, { discountPct: 20 }).items;
    expect(discounted.map((item) => [item.pay, !!item.confirmed])).toEqual([
      [80000, false],
      [32000, false],
      [380000, true],
      [60000, false],
    ]);
  });

  it("leaves out a row that is nothing in both, and keeps one that is nothing in one", () => {
    const rows = both({ structure: "settle_refi" });
    expect(row(rows, "personal")).toMatchObject({ a: 200000, b: 0, diff: -200000 });
    const neither = compareScenarios(figures({ ...base, structure: "settle_refi" }), figures(scenarioInput({ ...base, structure: "settle_refi" }, { financePct: 12 })));
    expect(neither.map((r) => r.row)).not.toContain("personal");
  });

  it("names only the levers that move something", () => {
    expect(movedLevers(base, { financePct: 10, settlePct: 10, structure: "settle_refi_personal" })).toEqual([]);
    expect(movedLevers(base, { financePct: 15, bankPersonal: 200000, propertyValue: 900000 })).toEqual(["financePct", "propertyValue"]);
    expect(movedLevers(base, { discountPct: 0 })).toEqual([]);
  });

  it("adds up on every golden case: what the client keeps is what comes in less what goes out", () => {
    const golden = JSON.parse(readFileSync(new URL("../golden/deal.json", import.meta.url), "utf8"));
    const cases: { input: DealInput; borrower: Borrower; credit: never }[] = golden.cases ?? golden;
    for (const c of cases) {
      const b = scenarioInput(c.input, { discountPct: 10, financePct: 12 });
      const { figures: f } = scenarioFigures(b, dealStudy(b, c.borrower, c.credit));
      expect(f.mortgage + f.personal - f.obligations - f.costs - f.fee).toBe(f.clientNet);
    }
  });
});
