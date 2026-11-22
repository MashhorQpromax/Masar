import { describe, expect, it } from "vitest";
import { dealStudy, defaultDealInput, splitItems, stagesFor, type Borrower, type DealInput, type DealItem } from "@/domain/deal";

/** Deals small enough to check with a calculator. Bank offers are fixed, so no estimate is involved. */
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
  fixedCosts: 10000,
  bankMortgage: 720000,
  bankPersonal: 200000,
};

describe("a deal that closes", () => {
  const s = dealStudy(base, borrower);

  it("counts the capital the company puts in", () => {
    expect(s.paidByCompany).toBe(520000); // 100,000 + 40,000 + 380,000
    expect(s.paidByBank).toBe(60000);
    expect(s.capital).toBe(530000); // + 10,000 fixed costs
  });

  it("charges 10 percent on the settlement and 10 percent on the financing", () => {
    expect(s.settleBase).toBe(140000); // enforcement order + default, not the mortgage payoff
    expect(s.feeSettle).toBe(14000);
    expect(s.financeBase).toBe(920000);
    expect(s.feeFinance).toBe(92000);
    expect(s.fee).toBe(106000);
  });

  it("works out what the client keeps", () => {
    expect(s.personalCash).toBe(138000); // 200,000 - 60,000 buyout - 2,000 lender fee
    expect(s.downPayment).toBe(80000); // 800,000 price - 720,000 mortgage
    expect(s.dueFromClient).toBe(-164000); // 530,000 + 106,000 - 800,000 from the sale
    expect(s.clientNet).toBe(222000); // 138,000 - 80,000 + 164,000
    expect(s.summary.net).toBe(222000); // 920,000 - 580,000 - 12,000 costs - 106,000 fee
    expect(s.summary.discountTotal).toBe(10000);
    expect(s.verdict).toBe("go");
  });

  it("measures the return and the security", () => {
    expect(s.roi).toBe(20); // 106,000 / 530,000
    expect(s.days).toBe(62);
    expect(s.annualized).toBe(117.7);
    expect(s.cover).toBe(1.51); // 800,000 / 530,000
  });
});

describe("a deal that does not close", () => {
  const s = dealStudy({ ...base, bankMortgage: 500000, bankPersonal: 100000 }, borrower);

  it("reports the deficit and the discount that would cover it", () => {
    expect(s.personalCash).toBe(39000); // 100,000 - 60,000 - 1,000
    expect(s.downPayment).toBe(300000);
    expect(s.fee).toBe(74000); // 14,000 + 60,000
    expect(s.clientNet).toBe(-65000);
    expect(s.verdict).toBe("short");
    expect(s.breakEvenDiscount).toBe(42.2); // 65,000 / (140,000 x 1.1)
    expect(s.risks[0]).toMatchObject({ level: "block", code: "DEFICIT", params: { deficit: 65000 } });
  });
});

describe("personal finance only", () => {
  const s = dealStudy(
    { ...base, structure: "settle_personal", items: [items[0]!, items[2]!, items[3]!], bankPersonal: 250000 },
    borrower,
  );

  it("leaves the property and its costs out", () => {
    expect(splitItems({ structure: "settle_personal", items }).kept.map((i) => i.id)).toEqual(["c"]);
    expect(s.capital).toBe(100000);
    expect(s.fixedCosts).toBe(0);
    expect(s.financing.mortgage).toBe(0);
    expect(s.cover).toBeNull();
  });

  it("recovers capital and fee from the personal finance", () => {
    expect(s.personalCash).toBe(187500); // 250,000 - 60,000 - 2,500
    expect(s.fee).toBe(35000); // 10,000 + 25,000
    expect(s.dueFromClient).toBe(135000);
    expect(s.clientNet).toBe(52500);
    expect(s.risks.map((r) => r.code)).toContain("NO_COLLATERAL");
  });

  it("skips the payoff and transfer stages", () => {
    expect(stagesFor("settle_personal").map((x) => x.stage)).not.toContain("transfer");
    expect(s.days).toBe(49);
  });
});

describe("guards", () => {
  it("asks for the valuation before judging a property deal", () => {
    const s = dealStudy({ ...base, propertyValue: null }, borrower);
    expect(s.verdict).toBe("needs_info");
    expect(s.risks[0]?.code).toBe("PROPERTY_VALUE_MISSING");
  });

  it("blocks when an enforcement order is left outside the deal", () => {
    const s = dealStudy({ ...base, items: [{ ...items[0]!, by: "out" }, ...items.slice(1)] }, borrower);
    expect(s.risks).toContainEqual(expect.objectContaining({ level: "block", code: "EXECUTION_OUTSIDE_DEAL" }));
  });
});
