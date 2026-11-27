import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clientNet, dealStudy, defaultDealInput, linesTotal, type Borrower, type DealInput, type DealItem } from "@/domain/deal";

/**
 * What the client keeps, line by line: a figure from a written word is confirmed, a counted one is an
 * estimate, and a sum of both is an estimate that says which is which.
 */
const borrower: Borrower = { age: 35, basicSalary: 12000, totalSalary: 16000, serviceMonths: 120, sector: "gov" };

const items: DealItem[] = [
  { id: "a", kind: "execution", label: "قرار تنفيذ 4471 — شركة تمويل", original: 100000, pay: 100000, by: "company" },
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
const net = (input: DealInput) => clientNet(input, dealStudy(input, borrower));
const of = (input: DealInput) => Object.fromEntries(net(input).lines.map((l) => [l.part, l]));
const allConfirmed = items.map((item) => ({ ...item, confirmed: true }));

describe("the client's net, line by line", () => {
  it("adds up to what the study keeps for the client, to the riyal, on every golden case", () => {
    const golden = JSON.parse(readFileSync(new URL("../golden/deal.json", import.meta.url), "utf8"));
    const cases: { input: DealInput; borrower: Borrower; credit: never }[] = golden.cases ?? golden;
    expect(cases.length).toBeGreaterThan(200);
    for (const c of cases) {
      const study = dealStudy(c.input, c.borrower, c.credit);
      const said = clientNet(c.input, study);
      expect(linesTotal(said.lines)).toBe(study.clientNet);
      expect(said.net).toBe(study.clientNet);
      for (const line of said.lines) {
        expect(line.amount).toBeGreaterThanOrEqual(0);
        expect(line.confirmed).toBeLessThanOrEqual(line.amount);
        if (line.certainty === "confirmed") expect(line.confirmed).toBe(line.amount);
      }
      expect(said.certainty === "confirmed").toBe(said.lines.every((l) => l.certainty === "confirmed"));
      for (const part of said.partly) expect(said.estimated).toContain(part);
    }
  });

  it("reads a written offer as confirmed, and an obligation without its creditor's letter as an estimate", () => {
    // 720,000 + 200,000 - 580,000 obligations - 12,000 costs (2,000 lender fee + 10,000 fixed) - 106,000 fee = 222,000
    const said = net(base);
    expect(said.lines.map((l) => [l.part, l.amount, l.certainty])).toEqual([
      ["mortgage", 720000, "confirmed"],
      ["personal", 200000, "confirmed"],
      ["obligations", 580000, "estimated"],
      ["costs", 12000, "estimated"],
      ["fee", 106000, "estimated"],
    ]);
    expect(said.net).toBe(222000);
    expect(said.certainty).toBe("estimated");
    expect(said.confirmed).toEqual(["mortgage", "personal"]);
    expect(said.estimated).toEqual(["obligations", "costs", "fee"]);
    expect(said.partly).toEqual(["obligations"]);
    // Only the mortgage payoff has its letter: one of four, 380,000 of 580,000.
    expect(of(base).obligations).toMatchObject({ count: { all: 4, confirmed: 1 }, confirmed: 380000 });
  });

  it("counts the fee as sure as what its percents are counted on", () => {
    // The settlement percent rests on the court order and the default, which have no letter yet.
    expect(of({ ...base, items: allConfirmed }).fee!.certainty).toBe("confirmed");
    expect(of({ ...base, items: allConfirmed, bankPersonal: null }).fee!.certainty).toBe("estimated");
    // On the personal financing alone, an estimated mortgage does not touch it.
    const onPersonal = { ...base, items: allConfirmed, bankMortgage: null, fee: { ...base.fee, financeBase: "personal" as const } };
    expect(of(onPersonal).fee!.certainty).toBe("confirmed");
    // On what is left after the settlements, counted costs make it an estimate.
    expect(of({ ...base, items: allConfirmed, fee: { ...base.fee, financeBase: "net" as const } }).fee!.certainty).toBe("estimated");
    // A fee with no percent on the settlement does not wait on the obligations' letters.
    expect(of({ ...base, fee: { ...base.fee, settlePct: 0 } }).fee!.certainty).toBe("confirmed");
  });

  it("is confirmed only when every line is: a written offer, every letter, and nothing counted", () => {
    const sure: DealInput = { ...base, structure: "settle_refi", items: allConfirmed.filter((item) => item.kind !== "personal_payoff"), fixedCosts: 0, bankPersonal: null };
    const said = net(sure);
    expect(said.lines.map((l) => l.part)).toEqual(["mortgage", "obligations", "fee"]);
    expect(said.certainty).toBe("confirmed");
    expect(said.estimated).toEqual([]);
    // One counted cost and it is an estimate again, with that line named.
    expect(net({ ...sure, fixedCosts: 5000 }).estimated).toEqual(["costs"]);
  });

  it("says when a lender's ceiling is what holds a counted financing", () => {
    const counted = { ...base, bankMortgage: null, bankPersonal: null };
    expect(of(counted).mortgage).toMatchObject({ certainty: "estimated", confirmed: 0, held: false });
    expect(of({ ...counted, personalCeiling: 50000 }).personal).toMatchObject({ amount: 50000, held: true });
  });

  it("keeps the deduction after the financing beside its cap", () => {
    const study = dealStudy(base, borrower);
    expect(clientNet(base, study).deduction).toEqual({ after: study.financing.dbrAfter, cap: Math.round(study.financing.totalCap * 100) });
  });
});
