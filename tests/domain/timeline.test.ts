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

/**
 * A lender holds a client for months after their default is paid. The stage after the record's update
 * cannot start before that wait ends, so it and every stage after it move with it.
 */
describe("a deal's timeline with the wait after a paid default", () => {
  const DAY = 86_400_000;
  const plus = (date: Date, days: number) => new Date(date.getTime() + days * DAY);
  const at = (t: ReturnType<typeof dealTimeline>, stage: string) => t.steps.find((s) => s.stage === stage)?.expectedAt;
  const six = (paidAt: Date | null) => ({ days: 183, paidAt });

  it("starts the wait when the settlement is expected to end, while it is still ahead", () => {
    const now = day("2026-11-22");
    const plain = dealTimeline("settle_refi_personal", "study", now, now);
    const held = dealTimeline("settle_refi_personal", "study", now, now, six(null));
    expect(plain.daysToDisbursement).toBe(59);
    // Study 2, agreement 2, settlement 3: the defaults are paid on the 29th. The clearances and the record's update run beside the wait.
    expect(at(held, "clearance")).toEqual(day("2026-11-29"));
    expect(at(held, "simah_update")).toEqual(day("2026-12-04"));
    expect(at(held, "payoff")).toEqual(plus(day("2026-11-29"), 183));
    expect(at(held, "transfer")).toEqual(plus(day("2026-11-29"), 193));
    // 7 days to the payment, the wait, then payoff 10, transfer 3, submission 3, approval 14, disbursement 7.
    expect(held.daysToDisbursement).toBe(7 + 183 + 37);
    // The stage the deal is in is due as before, and does not stand still.
    expect(held.stageDueInDays).toBe(plain.stageDueInDays);
    expect(held.held).toBe(false);
    expect(held.position).toBe(plain.position);
  });

  it("counts the wait from the day the defaults were paid", () => {
    const paid = day("2026-10-30");
    const held = dealTimeline("settle_refi_personal", "simah_update", day("2026-11-04"), day("2026-11-10"), six(paid));
    expect(at(held, "payoff")).toEqual(plus(paid, 183));
    expect(held.stageDueInDays).toBe(4); // The record's update has its ten days from the 4th.
    expect(held.daysToDisbursement).toBe(183 + 37 - 11);
  });

  it("stands still at the stage that waits, and is not late there until the wait has ended", () => {
    const paid = day("2026-10-30");
    const now = day("2026-11-23");
    const plain = dealTimeline("settle_refi_personal", "payoff", day("2026-11-01"), now);
    const held = dealTimeline("settle_refi_personal", "payoff", day("2026-11-01"), now, six(paid));
    expect(plain.stageDueInDays).toBe(-12);
    // The payoff has its ten days from the end of the wait.
    expect(held.stageDueInDays).toBe(183 + 10 - 24);
    expect([plain.held, held.held]).toEqual([false, true]);
    expect(at(held, "payoff")).toEqual(day("2026-11-01")); // when the deal entered the stage
    expect(at(held, "transfer")).toEqual(plus(paid, 193));
    expect(held.daysToDisbursement).toBe(183 + 37 - 24);
  });

  it("counts from the current stage when the defaults were paid and nobody recorded the day", () => {
    const now = day("2026-11-23");
    const held = dealTimeline("settle_refi_personal", "clearance", day("2026-11-20"), now, six(null));
    expect(at(held, "payoff")).toEqual(plus(day("2026-11-20"), 183));
  });

  it("changes nothing once the wait has ended", () => {
    const now = day("2027-08-01");
    const plain = dealTimeline("settle_refi_personal", "payoff", day("2027-07-30"), now);
    expect(dealTimeline("settle_refi_personal", "payoff", day("2027-07-30"), now, six(day("2026-10-30")))).toEqual(plain);
  });

  it("changes nothing for a deal that went on past the stage that waits", () => {
    const now = day("2026-11-23");
    for (const stage of ["transfer", "bank_submit", "approval", "disbursement", "recovered", "closed"] as const) {
      expect(dealTimeline("settle_refi_personal", stage, day("2026-11-20"), now, six(day("2026-10-30"))), stage).toEqual(dealTimeline("settle_refi_personal", stage, day("2026-11-20"), now));
    }
    expect(dealTimeline("settle_refi", "lost", day("2026-11-20"), now, six(null))).toEqual(dealTimeline("settle_refi", "lost", day("2026-11-20"), now));
  });

  it("holds the submission to the lender where there is no property", () => {
    const paid = day("2026-10-30");
    const held = dealTimeline("settle_personal", "simah_update", day("2026-11-04"), day("2026-11-10"), six(paid));
    expect(at(held, "bank_submit")).toEqual(plus(paid, 183));
    expect(held.daysToDisbursement).toBe(183 + 3 + 14 + 7 - 11);
  });

  it("is the plain timeline without a wait", () => {
    const now = day("2026-11-22");
    expect(dealTimeline("settle_refi_personal", "study", now, now, null)).toEqual(dealTimeline("settle_refi_personal", "study", now, now));
  });
});
