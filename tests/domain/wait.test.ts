import { describe, expect, it } from "vitest";
import {
  dealStudy,
  dealWait,
  defaultDealInput,
  holdingStage,
  holdOf,
  holdsOf,
  MARKET_WAIT_MONTHS,
  monthsToDays,
  paidAtOf,
  paysDefault,
  roadDays,
  waitAhead,
  waitEnds,
  waitMonths,
  waitOnRoad,
  type Borrower,
  type DealInput,
  type DealItem,
  type HoldTerm,
  type LenderHold,
} from "@/domain/deal";

/**
 * The wait after a default is paid. The owner said on 2026-11-27 that a lender holds such a client six
 * months to a year, and chose that every deal that pays a default shows it and counts its road and its
 * yearly return with it, while no deal is refused for it.
 */
const borrower: Borrower = { age: 35, basicSalary: 12000, totalSalary: 16000, serviceMonths: 120, sector: "gov" };

const order: DealItem = { id: "a", kind: "execution", label: "قرار تنفيذ — شركة تمويل", original: 100000, pay: 100000, by: "company" };
const fallen: DealItem = { id: "b", kind: "default", label: "تعثر — بنك", original: 50000, pay: 40000, by: "company" };
const home: DealItem = { id: "c", kind: "mortgage_payoff", label: "مخالصة العقاري — بنك", original: 600000, pay: 600000, by: "company", confirmed: true };
const card: DealItem = { id: "d", kind: "card", label: "بطاقة — بنك", original: 20000, pay: 20000, by: "bank" };

const deal = (items: DealItem[], over: Partial<DealInput> = {}): DealInput => ({ ...defaultDealInput(), items, propertyValue: 1_500_000, transferTaxPct: 0, ...over });
const day = (iso: string) => new Date(`${iso}T09:00:00Z`);

const hold = (lender: string, months: number | null, confirmed = true): LenderHold => ({ lender, months, confirmed });
const term = (lenderName: string, financeType: string, months: number | null, state = "confirmed"): HoldTerm => ({ lenderName, financeType, settledDefaultWaitMonths: months, terms: { settled: { state } } });

describe("which deals wait", () => {
  it("is a deal that pays a default or a court order", () => {
    expect(paysDefault(deal([order, home]))).toBe(true);
    expect(paysDefault(deal([fallen]))).toBe(true);
    expect(paysDefault(deal([home, card]))).toBe(false);
    expect(paysDefault(deal([]))).toBe(false);
  });

  it("is not a deal that leaves the default outside it", () => {
    expect(paysDefault(deal([{ ...fallen, by: "out" }, home]))).toBe(false);
    expect(waitMonths(deal([{ ...fallen, by: "out" }, home]))).toBeNull();
    expect(dealWait(deal([home]), dealStudy(deal([home]), borrower))).toBeNull();
  });
});

describe("how long a deal waits", () => {
  const x = deal([order, fallen, home]);

  it("is the market's six months to a year while nobody confirmed the lender's own", () => {
    expect(MARKET_WAIT_MONTHS).toEqual({ from: 6, to: 12 });
    expect(waitMonths(x)).toEqual({ months: { from: 6, to: 12 }, basis: "market", lenders: [] });
    expect(waitMonths(x, [hold("", null, false)])).toEqual({ months: { from: 6, to: 12 }, basis: "market", lenders: [] });
  });

  it("is the lender's own months once its term is confirmed", () => {
    expect(waitMonths(x, [hold("بنك أ", 3)])).toEqual({ months: { from: 3, to: 3 }, basis: "lender", lenders: ["بنك أ"] });
    expect(waitMonths(x, [hold("بنك أ", 0)])).toEqual({ months: { from: 0, to: 0 }, basis: "lender", lenders: ["بنك أ"] });
    expect(waitMonths(x, [hold("بنك أ", 24)])).toEqual({ months: { from: 24, to: 24 }, basis: "lender", lenders: ["بنك أ"] });
  });

  it("is never shortened by a figure nobody confirmed, and is lengthened by a longer one", () => {
    // A recorded zero with no source is a hope: the office's money is not counted back on it.
    expect(waitMonths(x, [hold("بنك أ", 0, false)])).toEqual({ months: { from: 6, to: 12 }, basis: "market", lenders: [] });
    expect(waitMonths(x, [hold("بنك أ", 9, false)])).toEqual({ months: { from: 6, to: 12 }, basis: "market", lenders: [] });
    expect(waitMonths(x, [hold("بنك أ", 24, false)])).toEqual({ months: { from: 6, to: 24 }, basis: "market", lenders: [] });
  });

  it("is the longest among the deal's lenders: each of them has to take the client", () => {
    expect(waitMonths(x, [hold("بنك أ", 0), hold("شركة ب", 12)])).toEqual({ months: { from: 12, to: 12 }, basis: "lender", lenders: ["شركة ب"] });
    expect(waitMonths(x, [hold("بنك أ", 3), hold("بنك أ", 3)])).toEqual({ months: { from: 3, to: 3 }, basis: "lender", lenders: ["بنك أ"] });
    // One lender confirmed and one nobody asked: the one nobody asked may wait the market's year.
    expect(waitMonths(x, [hold("بنك أ", 0), hold("", null, false)])).toEqual({ months: { from: 6, to: 12 }, basis: "market", lenders: [] });
    expect(waitMonths(x, [hold("بنك أ", 18), hold("", null, false)])).toEqual({ months: { from: 18, to: 18 }, basis: "market", lenders: [] });
  });
});

describe("the lenders of a deal", () => {
  const products: HoldTerm[] = [
    term("بنك أ", "mortgage", 0),
    term("بنك أ", "personal", 3),
    term("شركة ب", "personal", 12),
    term("بنك ج", "mortgage", 6, "unconfirmed"),
    term("بنك ج", "personal", null, "unconfirmed"),
  ];

  it("are the mortgage's bank and the personal finance's lender, each with its own product", () => {
    expect(holdsOf({ structure: "settle_refi_personal", targetBank: "بنك أ", personalLender: "شركة ب" }, products)).toEqual([hold("بنك أ", 0), hold("شركة ب", 12)]);
    expect(holdsOf({ structure: "settle_refi", targetBank: "بنك أ", personalLender: "شركة ب" }, products)).toEqual([hold("بنك أ", 0)]);
    // Without a mortgage the one lender named is the personal finance's.
    expect(holdsOf({ structure: "settle_personal", targetBank: "بنك أ", personalLender: null }, products)).toEqual([hold("بنك أ", 3)]);
    expect(holdsOf({ structure: "settle_personal", targetBank: "بنك أ", personalLender: "شركة ب" }, products)).toEqual([hold("شركة ب", 12)]);
  });

  it("count as nobody asked when the lender was never named, is not in the catalogue, or has no source", () => {
    expect(holdsOf({ structure: "settle_refi_personal", targetBank: null, personalLender: null }, products)).toEqual([hold("", null, false), hold("", null, false)]);
    // With a mortgage, the bank's name speaks for the mortgage alone: the personal finance may come from another lender.
    expect(holdsOf({ structure: "settle_refi_personal", targetBank: "بنك أ" }, products)).toEqual([hold("بنك أ", 0), hold("", null, false)]);
    expect(holdsOf({ structure: "settle_refi", targetBank: "بنك لا نعرفه" }, products)).toEqual([hold("بنك لا نعرفه", null, false)]);
    expect(holdsOf({ structure: "settle_refi_personal", targetBank: "بنك ج", personalLender: "بنك ج" }, products)).toEqual([hold("بنك ج", 6, false), hold("بنك ج", null, false)]);
  });
});

describe("the road with the wait in it", () => {
  it("counts months as days of a year", () => {
    expect([0, 3, 6, 12, 24].map(monthsToDays)).toEqual([0, 91, 183, 365, 730]);
  });

  it("holds the stage after the record's update", () => {
    expect(holdingStage("settle_refi_personal")).toBe("payoff");
    expect(holdingStage("settle_refi")).toBe("payoff");
    expect(holdingStage("settle_personal")).toBe("bank_submit");
  });

  it("runs the wait beside the clearances and the record's update, counted from the payment", () => {
    // 62 days as planned, of which the clearances and the record's update are 15.
    expect(roadDays("settle_refi_personal", 0)).toBe(62);
    expect(roadDays("settle_refi_personal", 15)).toBe(62);
    expect(roadDays("settle_refi_personal", 183)).toBe(62 - 15 + 183);
    expect(roadDays("settle_refi_personal", 365)).toBe(412);
    // Without a property: no payoff and no transfer, 49 days.
    expect(roadDays("settle_personal", 0)).toBe(49);
    expect(roadDays("settle_personal", 183)).toBe(217);
    expect(roadDays("settle_personal", 365)).toBe(399);
  });

  it("is still ahead of a deal up to the stage that waits, and behind one that went on", () => {
    const stages = ["study", "agreement", "settlement", "clearance", "simah_update", "payoff", "transfer", "bank_submit", "approval", "disbursement", "recovered", "closed", "lost"] as const;
    expect(stages.filter((stage) => waitAhead("settle_refi_personal", stage))).toEqual(["study", "agreement", "settlement", "clearance", "simah_update", "payoff"]);
    expect(stages.filter((stage) => waitAhead("settle_personal", stage))).toEqual(["study", "agreement", "settlement", "clearance", "simah_update", "bank_submit"]);
    const wait = { months: { from: 6, to: 12 } };
    expect(waitOnRoad(wait, { structure: "settle_refi_personal", stage: "payoff" })).toBe(wait);
    expect(waitOnRoad(wait, { structure: "settle_refi_personal", stage: "approval" })).toBeNull();
    expect(waitOnRoad(null, { structure: "settle_refi_personal", stage: "study" })).toBeNull();
  });
});

describe("what the wait does to a deal", () => {
  const x = deal([order, fallen, home]);
  const study = dealStudy(x, borrower);

  it("changes no figure of the deal and reads no verdict", () => {
    const before = JSON.stringify(study);
    dealWait(x, study);
    dealWait(x, study, [hold("بنك أ", 12)]);
    expect(JSON.stringify(study)).toBe(before);
    expect(dealStudy(x, borrower)).toEqual(study);
    // The same wait whether the deal closes or not.
    const short = deal([order, fallen, { ...home, original: 1_400_000, pay: 1_400_000 }]);
    const shortStudy = dealStudy(short, borrower);
    expect(shortStudy.verdict).toBe("short");
    expect(dealWait(short, shortStudy)).toMatchObject({ months: { from: 6, to: 12 }, days: { from: 230, to: 412 } });
  });

  it("counts the road and the yearly return with it: the same count the study makes, on the longer road", () => {
    expect(study.days).toBe(62);
    const wait = dealWait(x, study)!;
    expect(wait).toMatchObject({ months: { from: 6, to: 12 }, basis: "market", lenders: [], days: { from: 230, to: 412 } });
    const yearly = (road: number) => Math.round(((study.roi! * 365) / road) * 10) / 10;
    expect(study.annualized).toBe(yearly(62));
    expect(wait.annualized).toEqual({ low: yearly(412), high: yearly(230) });
    expect(wait.annualized!.high).toBeLessThan(study.annualized!);
    expect(wait.annualized!.low).toBeLessThan(wait.annualized!.high);
  });

  it("says what the office has out through it: what it pays for the defaults and the court orders", () => {
    expect(dealWait(x, study)!.exposed).toBe(140000);
    // What the new financing buys out is not the office's money.
    const bought = deal([order, { ...fallen, by: "bank" }, home]);
    expect(dealWait(bought, dealStudy(bought, borrower))!.exposed).toBe(100000);
  });

  it("is the study's own road and return when the lender confirmed it takes the client at once", () => {
    const wait = dealWait(x, study, [hold("بنك أ", 0), hold("بنك أ", 0)])!;
    expect(wait).toMatchObject({ months: { from: 0, to: 0 }, basis: "lender", lenders: ["بنك أ"], days: { from: study.days, to: study.days } });
    expect(wait.annualized).toEqual({ low: study.annualized, high: study.annualized });
  });

  it("is one road, not a range, on a lender's confirmed months", () => {
    const wait = dealWait(x, study, [hold("شركة ب", 12)])!;
    expect(wait.days).toEqual({ from: 412, to: 412 });
    expect(wait.annualized!.low).toBe(wait.annualized!.high);
  });

  it("has no yearly return where the deal puts no capital in", () => {
    const bought = deal([{ ...fallen, by: "bank" }], { structure: "settle_personal" });
    const s = dealStudy(bought, borrower);
    expect(s.roi).toBeNull();
    expect(dealWait(bought, s)).toMatchObject({ annualized: null, exposed: 0, days: { from: 217, to: 399 } });
  });
});

describe("when the wait ends", () => {
  const events = (...list: [string, string][]) => list.map(([stage, iso]) => ({ stage: stage as "study", at: day(iso) }));

  it("is counted from the day the deal first went past the settlement", () => {
    expect(paidAtOf(events(["study", "2026-10-01"], ["agreement", "2026-10-03"], ["settlement", "2026-10-05"]))).toBeNull();
    expect(paidAtOf(events(["study", "2026-10-01"], ["settlement", "2026-10-05"], ["clearance", "2026-10-08"], ["simah_update", "2026-10-13"]))).toEqual(day("2026-10-08"));
    // A step back and forward again does not move the day.
    expect(paidAtOf(events(["settlement", "2026-10-05"], ["clearance", "2026-10-08"], ["settlement", "2026-10-09"], ["clearance", "2026-10-12"]))).toEqual(day("2026-10-08"));
    // A deal that skipped a stage is past the settlement all the same.
    expect(paidAtOf(events(["study", "2026-10-01"], ["payoff", "2026-10-20"]))).toEqual(day("2026-10-20"));
    expect(paidAtOf(events(["study", "2026-10-01"], ["lost", "2026-10-20"]))).toBeNull();
    expect(paidAtOf([])).toBeNull();
  });

  it("is a day on a confirmed wait and two days on the market's", () => {
    const market = waitMonths(deal([fallen]))!;
    expect(waitEnds(market, day("2026-10-08"))).toEqual({ from: day("2027-04-09"), to: day("2027-10-08") });
    const year = waitMonths(deal([fallen]), [hold("شركة ب", 12)])!;
    expect(waitEnds(year, day("2026-10-08"))).toEqual({ from: day("2027-10-08"), to: day("2027-10-08") });
    expect(waitEnds(market, null)).toBeNull();
    expect(waitEnds(null, day("2026-10-08"))).toBeNull();
    expect(waitEnds(waitMonths(deal([fallen]), [hold("بنك أ", 0)]), day("2026-10-08"))).toBeNull();
  });

  it("is counted by the timeline on its shortest", () => {
    const market = waitMonths(deal([fallen]))!;
    expect(holdOf(market, day("2026-10-08"))).toEqual({ days: 183, paidAt: day("2026-10-08") });
    expect(holdOf(market, null)).toEqual({ days: 183, paidAt: null });
    expect(holdOf(waitMonths(deal([fallen]), [hold("شركة ب", 12)]), null)).toEqual({ days: 365, paidAt: null });
    // Nothing to hold where the wait may be nothing.
    expect(holdOf(waitMonths(deal([fallen]), [hold("بنك أ", 0)]), null)).toBeNull();
    expect(holdOf(waitMonths(deal([fallen]), [hold("بنك أ", 0, false)]), null)).toEqual({ days: 183, paidAt: null });
    expect(holdOf(null, day("2026-10-08"))).toBeNull();
  });
});
