import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dealStudy, fundsFlow, portfolio, stationOf, stationsFor, type PortfolioDeal } from "@/domain/deal";

const golden = JSON.parse(readFileSync(new URL("../golden/deal.json", import.meta.url), "utf8"));
const cases: { input: never; borrower: never; credit: never }[] = golden.cases ?? golden;

describe("where the financing goes", () => {
  it("adds up exactly on every golden case, and costs are the lender's fee plus the sale tax", () => {
    expect(cases.length).toBeGreaterThan(200);
    for (const c of cases) {
      const study = dealStudy(c.input, c.borrower, c.credit);
      const flow = fundsFlow(study);
      const sum = flow.parts.reduce((total, p) => total + p.amount, 0);
      expect(sum).toBe(flow.total + flow.deficit);
      const adminFee = study.summary.costs.find((k) => k.kind === "admin_fee")?.amount ?? 0;
      const costs = flow.parts.find((p) => p.key === "costs")?.amount ?? 0;
      expect(Math.abs(costs - (adminFee + study.saleTax))).toBeLessThanOrEqual(2);
      for (const part of flow.parts) expect(part.amount).toBeGreaterThan(0);
    }
  });
});

describe("stations", () => {
  it("places every active stage at a station and ended deals nowhere", () => {
    expect(stationOf("agreement")).toBe("study");
    expect(stationOf("clearance")).toBe("settle");
    expect(stationOf("transfer")).toBe("property");
    expect(stationOf("approval")).toBe("bank");
    expect(stationOf("recovered")).toBe("payout");
    expect(stationOf("closed")).toBeNull();
    expect(stationOf("lost")).toBeNull();
  });

  it("skips the property station without a property", () => {
    expect(stationsFor("settle_refi_personal")).toHaveLength(6);
    expect(stationsFor("settle_personal")).toEqual(["study", "settle", "credit", "bank", "payout"]);
  });
});

describe("portfolio", () => {
  const now = new Date("2026-11-22T09:00:00Z");
  const ago = (days: number) => new Date(now.getTime() - days * 86400000);
  const deal = (over: Partial<PortfolioDeal>): PortfolioDeal => ({
    dealId: 1,
    stage: "study",
    structure: "settle_refi_personal",
    capital: 100000,
    fee: 20000,
    verdict: "go",
    stageEnteredAt: now,
    ...over,
  });

  it("counts capital only while it is out, and fees only for deals that close", () => {
    const p = portfolio(
      [
        deal({ dealId: 1, stage: "study" }),
        deal({ dealId: 2, stage: "settlement", capital: 300000, fee: 50000 }),
        deal({ dealId: 3, stage: "approval", capital: 500000, fee: 90000, stageEnteredAt: ago(10) }),
        deal({ dealId: 4, stage: "study", verdict: "short", fee: 70000 }),
        deal({ dealId: 5, stage: "recovered", capital: 200000, fee: 30000 }),
      ],
      now,
    );
    expect(p.count).toBe(5);
    expect(p.capitalOut).toBe(800000);
    expect(p.expectedFees).toBe(20000 + 50000 + 90000 + 30000);
    expect(p.returningSoon).toBe(500000); // approval 14 + disbursement 7, ten days in: 11 days left
    expect(p.nearest?.dealId).toBe(3);
    expect(p.nearest?.daysToDisbursement).toBe(11);
  });

  it("puts the stage that is most overdue first", () => {
    const p = portfolio([deal({ dealId: 1, stageEnteredAt: ago(1) }), deal({ dealId: 2, stage: "agreement", stageEnteredAt: ago(6) })], now);
    expect(p.next).toMatchObject({ dealId: 2, stageDueInDays: -4 });
  });

  it("is empty without deals", () => {
    expect(portfolio([], now)).toMatchObject({ count: 0, capitalOut: 0, expectedFees: 0, nearest: null, next: null });
  });
});
