import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyReport, type CreditReport, type ParsedReport } from "@/domain/credit";
import { addCreditReport, creditHistory, latestCredit, reviewCreditReport } from "@/server/credit/service";
import type { Connection } from "@/server/db/client";
import { auditLog, clients, creditReports } from "@/server/db/schema";
import { SYSTEM } from "@/server/shared/actor";
import { testDb } from "../helpers/db";

let c: Connection;
let clientId: number;
const now = new Date("2026-11-23T09:00:00Z");

beforeAll(async () => {
  c = await testDb();
  const [client] = await c.db.insert(clients).values({ fileNo: "C-001", fullName: "عميل تجريبي" }).returning({ id: clients.id });
  clientId = client!.id;
});
afterAll(async () => {
  await c.close();
});

const reading = (report: Partial<CreditReport>, extra: Partial<ParsedReport> = {}) => ({
  report: { ...emptyReport(), ...report },
  warnings: [],
  confidence: "high" as const,
  ...extra,
});

/** A finance company default of 128,000 with the enforcement order raised for it, read as a suspension until checked. */
const blocked = reading(
  {
    reportDate: "2026/11/01",
    facilities: [{ lender: "شركة تمويل", creditorType: "finance_company", product: "قرض شخصي", status: "default", defaultAmount: 128000, defaultNow: 128000 }],
    judgments: [{ kind: "enforcement", active: true, amount: 128400, remaining: 128400, date: "2026/03/11", state: "عدم تنفيذ", decisionNo: "4410077123", creditor: null }],
    serviceSuspension: true,
    suspensionAssumed: true,
  },
  { warnings: [{ code: "SUSPENSION_ASSUMED", params: { orders: 1 } }], confidence: "medium" },
);

describe("a client's credit record", () => {
  it("has none until a report is read", async () => {
    expect(await latestCredit(c.db, clientId)).toBeNull();
    expect(await creditHistory(c.db, clientId)).toEqual([]);
  });

  it("stores a reading, grades it and marks the client's standing", async () => {
    const { reportId, analysis } = await addCreditReport(c.db, { clientId, reading: blocked, actor: SYSTEM, now });
    expect(analysis).toMatchObject({ grade: "E", standing: "default", stats: { totalToClear: 128400 } });

    const [row] = await c.db.select().from(creditReports).where(eq(creditReports.id, reportId));
    expect(row).toMatchObject({ clientId, grade: "E", derivedSimah: "default" });
    const [client] = await c.db.select().from(clients).where(eq(clients.id, clientId));
    expect(client!.simah).toBe("default");

    const record = await latestCredit(c.db, clientId);
    expect(record).toMatchObject({ id: reportId, confidence: "medium", warnings: [{ code: "SUSPENSION_ASSUMED", params: { orders: 1 } }] });
    expect(record!.report.facilities[0]).toMatchObject({ lender: "شركة تمويل", defaultAmount: 128000 });
    expect(record!.analysis.blockers.map((b) => b.code)).toEqual(["SUSPENSION", "JUDGMENT", "ACTIVE_DEFAULT"]);

    const [entry] = await c.db.select().from(auditLog).where(eq(auditLog.action, "credit.report_add"));
    expect(entry).toMatchObject({ entity: "client", entityId: clientId, details: { reportId, grade: "E", facilities: 1, judgments: 1, confidence: "medium" } });
  });

  it("records what a person found in Najiz and grades again", async () => {
    const record = (await latestCredit(c.db, clientId))!;
    // No suspension after all, but the order and the default still stand.
    const { analysis } = await reviewCreditReport(c.db, {
      clientId,
      reportId: record.id,
      review: { suspension: false, travelBan: false, note: "تحققنا من ناجز: لا إيقاف" },
      actor: SYSTEM,
      now,
    });
    expect(analysis.blockers.map((b) => b.code)).toEqual(["JUDGMENT", "ACTIVE_DEFAULT"]);
    expect(analysis.severity).toBeLessThan(100);

    const after = (await latestCredit(c.db, clientId))!;
    expect(after.report).toMatchObject({ serviceSuspension: false, suspensionAssumed: false, travelBan: false, notes: "تحققنا من ناجز: لا إيقاف" });
    // The warnings of the reading stay with the record.
    expect(after.warnings).toHaveLength(1);

    // Leaving the suspension question unanswered keeps it as it was, and a ban can be set and lifted.
    await reviewCreditReport(c.db, { clientId, reportId: record.id, review: { suspension: null, travelBan: true, note: null }, actor: SYSTEM, now });
    expect((await latestCredit(c.db, clientId))!.report).toMatchObject({ serviceSuspension: false, travelBan: true, notes: "تحققنا من ناجز: لا إيقاف" });
    await reviewCreditReport(c.db, { clientId, reportId: record.id, review: { suspension: null, travelBan: null, note: null }, actor: SYSTEM, now });
    expect((await latestCredit(c.db, clientId))!.report.travelBan).toBe(true);
    await reviewCreditReport(c.db, { clientId, reportId: record.id, review: { suspension: null, travelBan: false, note: null }, actor: SYSTEM, now });
    expect((await latestCredit(c.db, clientId))!.report.travelBan).toBe(false);

    const entries = await c.db.select().from(auditLog).where(eq(auditLog.action, "credit.report_review"));
    expect(entries).toHaveLength(4);
    expect(entries[0]!.details).toMatchObject({ suspension: false, travelBan: false, note: true });
  });

  it("keeps every reading, and the newest one is the record", async () => {
    const first = (await latestCredit(c.db, clientId))!;
    const later = new Date("2027-01-10T09:00:00Z");
    const clean = reading({
      reportDate: "2027/01/09",
      facilities: [{ lender: "شركة تمويل", creditorType: "finance_company", product: "قرض شخصي", status: "settled", defaultAmount: 128000, defaultNow: 0, settledMonthsAgo: 1 }],
    });
    const { reportId, analysis } = await addCreditReport(c.db, { clientId, reading: clean, actor: SYSTEM, now: later });
    expect(analysis).toMatchObject({ grade: "B", standing: "late", banks: { access: "closed", reopenInMonths: 23 }, financeCompanies: { access: "closed", reopenInMonths: 5 } });
    expect((await latestCredit(c.db, clientId))!.id).toBe(reportId);
    expect((await creditHistory(c.db, clientId)).map((h) => [h.id, h.grade])).toEqual([
      [reportId, "B"],
      [first.id, "E"],
    ]);
    const [client] = await c.db.select().from(clients).where(eq(clients.id, clientId));
    expect(client!.simah).toBe("late");

    // Reviewing the older reading rewrites history, not the client's standing today.
    await reviewCreditReport(c.db, { clientId, reportId: first.id, review: { suspension: true, travelBan: false, note: null }, actor: SYSTEM, now: later });
    const [still] = await c.db.select().from(clients).where(eq(clients.id, clientId));
    expect(still!.simah).toBe("late");
  });

  it("refuses a reading that is not a credit record, and stores nothing", async () => {
    const before = (await creditHistory(c.db, clientId)).length;
    const bad = [
      { report: { facilities: "none" }, warnings: [], confidence: "high" },
      reading({ facilities: [{ lender: "بنك", creditorType: "bank", product: "قرض", status: "default", defaultAmount: -5 }] }),
      reading({ facilities: [{ lender: "بنك", creditorType: "bank", product: "قرض", status: "default", defaultAmount: 441007712350000 }] }),
      reading({ judgments: [{ kind: "enforcement", active: true, date: "11/03/2026" }] }),
      { ...reading({}), confidence: "certain" },
    ];
    for (const value of bad) {
      await expect(addCreditReport(c.db, { clientId, reading: value, actor: SYSTEM, now })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    expect((await creditHistory(c.db, clientId)).length).toBe(before);
  });

  it("cuts an over-long name instead of refusing the report", async () => {
    const long = "ا".repeat(900);
    const { reportId } = await addCreditReport(c.db, {
      clientId,
      reading: reading({ facilities: [{ lender: `  ${long}  `, creditorType: "other", product: "منتج", status: "current" }] }),
      actor: SYSTEM,
      now: new Date("2027-02-01T09:00:00Z"),
    });
    const record = (await latestCredit(c.db, clientId))!;
    expect(record.id).toBe(reportId);
    expect(record.report.facilities[0]!.lender).toHaveLength(300);
  });

  it("answers for an unknown client or report with not found", async () => {
    await expect(addCreditReport(c.db, { clientId: 99999, reading: blocked, actor: SYSTEM, now })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const review = { suspension: null, travelBan: false, note: null };
    await expect(reviewCreditReport(c.db, { clientId, reportId: 99999, review, actor: SYSTEM, now })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // A report of one client cannot be reviewed through another client.
    const [other] = await c.db.insert(clients).values({ fileNo: "C-002", fullName: "عميل آخر" }).returning({ id: clients.id });
    const mine = (await latestCredit(c.db, clientId))!;
    await expect(reviewCreditReport(c.db, { clientId: other!.id, reportId: mine.id, review, actor: SYSTEM, now })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reads a stored record that carries warnings in a form it does not know", async () => {
    const [other] = await c.db.insert(clients).values({ fileNo: "C-003", fullName: "عميل قديم" }).returning({ id: clients.id });
    await c.db.insert(creditReports).values({
      clientId: other!.id,
      report: { ...emptyReport(), warnings: ["تحذير نصي من النظام القديم", { code: "NO_FACILITIES", params: {} }], confidence: "low" },
      grade: "A",
      derivedSimah: "clean",
    });
    const record = (await latestCredit(c.db, other!.id))!;
    expect(record.warnings).toEqual([{ code: "NO_FACILITIES", params: {} }]);
    expect(record.confidence).toBe("low");
    expect(record.analysis.grade).toBe("A");
  });
});
