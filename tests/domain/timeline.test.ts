import { describe, expect, it } from "vitest";
import { dealTimeline } from "@/domain/deal";

const day = (iso: string) => new Date(`${iso}T09:00:00Z`);

describe("deal timeline", () => {
  it("marks what is done, where the deal is, and when the rest is expected", () => {
    const t = dealTimeline("settle_refi_personal", "payoff", day("2026-11-20"), day("2026-11-22"));
    expect(t.position).toBe(6);
    expect(t.total).toBe(12);
    expect(t.steps.filter((s) => s.state === "done").map((s) => s.stage)).toEqual(["study", "agreement", "settlement", "clearance", "simah_update"]);
    expect(t.steps.find((s) => s.stage === "payoff")).toMatchObject({ state: "current", expectedAt: day("2026-11-20") });
    expect(t.steps.find((s) => s.stage === "transfer")?.expectedAt).toEqual(day("2026-11-30")); // payoff takes 10 days
    // payoff 10 + transfer 3 + submit 3 + approval 14 + disbursement 7 = 37 days from the 20th, 35 from today
    expect(t.daysToDisbursement).toBe(35);
  });

  it("has no payoff or transfer without a property", () => {
    const t = dealTimeline("settle_personal", "study", day("2026-11-22"), day("2026-11-22"));
    expect(t.steps.map((s) => s.stage)).not.toContain("payoff");
    expect(t.total).toBe(10);
    expect(t.daysToDisbursement).toBe(46); // 2 + 2 + 3 + 5 + 10 + 3 + 14 + 7
  });

  it("stops counting once the capital is back", () => {
    expect(dealTimeline("settle_refi", "recovered", day("2026-11-22"), day("2026-11-23")).daysToDisbursement).toBeNull();
    expect(dealTimeline("settle_refi", "lost", day("2026-11-22"), day("2026-11-23")).position).toBe(0);
  });
});
