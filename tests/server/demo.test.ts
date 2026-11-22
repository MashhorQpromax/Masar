import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dealTimeline, fundsFlow, stationTimeline } from "@/domain/deal";
import type { Connection } from "@/server/db/client";
import { getDeal } from "@/server/deals/service";
import { roadView } from "@/server/deals/views";
import { seedDemo } from "@/server/demo/seed";
import { testDb } from "../helpers/db";

let c: Connection;
const now = new Date("2026-11-22T09:00:00Z");

beforeAll(async () => {
  c = await testDb();
  await seedDemo(c.db, now);
});
afterAll(async () => {
  await c.close();
});

describe("demo data on the road", () => {
  it("puts each deal at its station with the engine's verdict", async () => {
    const view = await roadView(c.db, now);
    const byName = Object.fromEntries(view.deals.map((d) => [d.clientName, d]));
    expect(view.deals).toHaveLength(4);
    expect(byName["فهد"]).toMatchObject({ station: "bank", stage: "approval", verdict: "go", daysToDisbursement: 12, stageDueInDays: 5 });
    expect(byName["سالم"]).toMatchObject({ station: "property", stage: "payoff", verdict: "go", stageDueInDays: 1 });
    expect(byName["نورة"]).toMatchObject({ station: "settle", stage: "settlement", verdict: "tight" });
    expect(byName["ريم"]).toMatchObject({ station: "study", stage: "study", verdict: "short" });
    expect(byName["ريم"]!.clientNet).toBeLessThan(0);
  });

  it("adds up the portfolio", async () => {
    const { portfolio, deals } = await roadView(c.db, now);
    const of = (name: string) => deals.find((d) => d.clientName === name)!;
    // Capital is out for every deal past the agreement: all but the one still under study.
    expect(portfolio.capitalOut).toBe(of("فهد").capital! + of("سالم").capital! + of("نورة").capital!);
    // A deal that does not close earns nothing.
    expect(portfolio.expectedFees).toBe(of("فهد").fee! + of("سالم").fee! + of("نورة").fee!);
    expect(portfolio.returningSoon).toBe(of("فهد").capital! + of("سالم").capital!);
    expect(portfolio.nearest?.dealId).toBe(of("فهد").dealId);
    expect(portfolio.next?.dealId).toBe(of("سالم").dealId);
  });

  it("reads a deal with its history, stations and where the financing goes", async () => {
    const { deals } = await roadView(c.db, now);
    const salem = deals.find((d) => d.clientName === "سالم")!;
    const view = (await getDeal(c.db, { dealId: salem.dealId, now }))!;
    expect(view.history.map((h) => h.stage)).toEqual(["study", "agreement", "settlement", "clearance", "simah_update", "payoff"]);

    const timeline = dealTimeline(view.deal.structure, view.deal.stage, view.stageEnteredAt, now);
    const stations = stationTimeline(view.deal.structure, timeline, view.history);
    expect(stations.steps.map((s) => [s.key, s.state])).toEqual([
      ["study", "done"],
      ["settle", "done"],
      ["credit", "done"],
      ["property", "current"],
      ["bank", "ahead"],
      ["payout", "ahead"],
    ]);
    expect(stations.position).toBe(4);
    expect(stations.steps[0]!.at).toEqual(new Date("2026-10-22T09:00:00Z"));
    expect(stations.steps[4]).toMatchObject({ expected: true, at: new Date("2026-11-26T09:00:00Z") }); // payoff 10 days from the 13th, then transfer 3

    const flow = fundsFlow(view.study);
    expect(flow.deficit).toBe(0);
    expect(flow.parts.reduce((sum, p) => sum + p.amount, 0)).toBe(flow.total);
    expect(flow.parts.find((p) => p.key === "client")!.amount).toBe(view.study.clientNet);
  });

  it("shows the shortfall of a deal that does not close", async () => {
    const { deals } = await roadView(c.db, now);
    const reem = deals.find((d) => d.clientName === "ريم")!;
    const view = (await getDeal(c.db, { dealId: reem.dealId, now }))!;
    const flow = fundsFlow(view.study);
    expect(flow.deficit).toBe(-view.study.clientNet);
    expect(flow.parts.some((p) => p.key === "client")).toBe(false);
    expect(flow.parts.reduce((sum, p) => sum + p.amount, 0)).toBe(flow.total + flow.deficit);
  });
});
