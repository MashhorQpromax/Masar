import { describe, expect, it } from "vitest";
import { firstMonth, isMonth, monthOf, monthReport, shiftMonth, type MonthAnswer, type MonthDeal, type MonthRequest } from "@/domain/report";

/** The office's month, counted from what the system holds. */
const deal = (parts: Partial<MonthDeal> = {}): MonthDeal => ({ dealId: 1, clientName: "عميل", fileNo: "C-1", openedOn: "2026-11-02", stage: "study", stageOn: null, fee: 40000, collected: null, ...parts });
const answer = (parts: Partial<MonthAnswer> = {}): MonthAnswer => ({ lenderId: 1, lender: "بنك المثال", decision: "approved", written: true, on: "2026-11-10", ...parts });
const request = (parts: Partial<MonthRequest> = {}): MonthRequest => ({ sentOn: "2026-11-05", answeredOn: null, waiting: true, ...parts });

describe("the months", () => {
  it("are read and stepped through whole", () => {
    expect(isMonth("2026-11")).toBe(true);
    for (const bad of ["2026-13", "2026-1", "26-11", "2026-11-01", 202611, null]) expect(isMonth(bad)).toBe(false);
    expect(monthOf("2026-11-25")).toBe("2026-11");
    expect(shiftMonth("2026-11", 1)).toBe("2026-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
    expect(shiftMonth("2026-03", -14)).toBe("2025-01");
    expect(firstMonth([deal({ openedOn: "2026-10-30" }), deal({ openedOn: "2026-08-03" })])).toBe("2026-08");
    expect(firstMonth([])).toBeNull();
  });
});

describe("the office's month", () => {
  it("counts the deals opened, closed and lost in it, and only in it", () => {
    const report = monthReport({
      month: "2026-11",
      deals: [
        deal({ dealId: 1 }),
        deal({ dealId: 2, openedOn: "2026-10-31" }),
        deal({ dealId: 3, openedOn: "2026-09-01", stage: "closed", stageOn: "2026-11-20", fee: 43000 }),
        deal({ dealId: 4, openedOn: "2026-10-01", stage: "closed", stageOn: "2026-11-11", fee: 21000 }),
        deal({ dealId: 5, openedOn: "2026-08-01", stage: "closed", stageOn: "2026-10-29", fee: 99000 }),
        deal({ dealId: 6, openedOn: "2026-11-03", stage: "lost", stageOn: "2026-11-04", fee: 12000 }),
      ],
      answers: [],
      requests: [],
    });
    expect(report.opened).toBe(2);
    expect(report.closed.map((d) => [d.dealId, d.on, d.days])).toEqual([
      [3, "2026-11-20", 80],
      [4, "2026-11-11", 41],
    ]);
    expect(report.lost.map((d) => [d.dealId, d.days])).toEqual([[6, 1]]);
    // A lost deal earns nothing, and a deal closed last month is last month's.
    expect(report.closedFees).toBe(64000);
    expect(report.closedDays).toBe(61);
  });

  it("adds up what was collected apart from what was counted, and counts the deals with nothing recorded", () => {
    const report = monthReport({
      month: "2026-11",
      deals: [
        deal({ dealId: 3, stage: "closed", stageOn: "2026-11-20", fee: 43000, collected: 41000 }),
        deal({ dealId: 4, stage: "closed", stageOn: "2026-11-11", fee: 21000 }),
        // Nothing collected is an amount, not a deal left unrecorded.
        deal({ dealId: 7, stage: "closed", stageOn: "2026-11-09", fee: 10000, collected: 0 }),
        // Collected last month, or on a deal that is not closed: not this month's.
        deal({ dealId: 5, stage: "closed", stageOn: "2026-10-29", fee: 99000, collected: 99000 }),
        deal({ dealId: 6, stage: "recovered", stageOn: "2026-11-21", fee: 12000, collected: 12000 }),
      ],
      answers: [],
      requests: [],
    });
    expect(report).toMatchObject({ closedFees: 74000, collectedFees: 41000, collectedOn: 2 });
    expect(report.closed.map((d) => [d.dealId, d.fee, d.collected])).toEqual([
      [3, 43000, 41000],
      [4, 21000, null],
      [7, 10000, 0],
    ]);
    expect(monthReport({ month: "2026-11", deals: [], answers: [], requests: [] })).toMatchObject({ collectedFees: 0, collectedOn: 0 });
  });

  it("says nothing of an average when nothing closed, and counts a fee never worked out as none", () => {
    const empty = monthReport({ month: "2026-11", deals: [], answers: [], requests: [] });
    expect(empty).toMatchObject({ opened: 0, closed: [], lost: [], closedFees: 0, closedDays: null, lenders: [], requests: { sent: 0, answered: 0, waiting: 0 } });
    const noFee = monthReport({ month: "2026-11", deals: [deal({ stage: "closed", stageOn: "2026-11-02", fee: null })], answers: [], requests: [] });
    expect(noFee.closedFees).toBe(0);
    expect(noFee.closed[0]!.days).toBe(0);
    // A deal whose closing day was never recorded is in no month.
    expect(monthReport({ month: "2026-11", deals: [deal({ stage: "closed", stageOn: null })], answers: [], requests: [] }).closed).toEqual([]);
  });

  it("gathers the lenders' answers of the month, the busiest lender first", () => {
    const report = monthReport({
      month: "2026-11",
      deals: [],
      answers: [
        answer(),
        answer({ decision: "approved_modified", written: false }),
        answer({ decision: "rejected" }),
        answer({ lenderId: 2, lender: "المثال للتمويل", decision: "rejected", written: false }),
        answer({ lenderId: 3, lender: "جهة قديمة", on: "2026-10-30" }),
      ],
      requests: [],
    });
    expect(report.lenders).toEqual([
      { lenderId: 1, lender: "بنك المثال", answers: 3, approved: 2, refused: 1, written: 2 },
      { lenderId: 2, lender: "المثال للتمويل", answers: 1, approved: 0, refused: 1, written: 0 },
    ]);
  });

  it("counts the requests sent and answered in the month, and those waiting now", () => {
    const report = monthReport({
      month: "2026-11",
      deals: [],
      answers: [],
      requests: [request(), request({ sentOn: "2026-10-28", answeredOn: "2026-11-02", waiting: false }), request({ sentOn: null, waiting: false }), request({ sentOn: "2026-10-01" })],
    });
    expect(report.requests).toEqual({ sent: 1, answered: 1, waiting: 2 });
  });
});
