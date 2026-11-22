import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultDealInput, type DealInput } from "@/domain/deal";
import type { Connection } from "@/server/db/client";
import { auditLog, clients, dealItems, dealStageEvents, deals } from "@/server/db/schema";
import { getDeal, reviseDeal, setDealStage, startDeal } from "@/server/deals/service";
import { SYSTEM } from "@/server/shared/actor";
import { testDb } from "../helpers/db";

let c: Connection;
const now = new Date("2026-11-22T09:00:00Z");

beforeAll(async () => {
  c = await testDb();
});
afterAll(async () => {
  await c.close();
});

const borrower = { fullName: "عميل تجريبي", birthYear: 1991, sector: "gov", basicSalary: 12000, totalSalary: 16000, serviceMonths: 120 };

const input: DealInput = {
  ...defaultDealInput(),
  items: [
    { id: "a", kind: "execution", label: "قرار تنفيذ 4471 — شركة تمويل", original: 100000, pay: 100000, by: "company" },
    { id: "b", kind: "default", label: "تعثر — بنك", original: 50000, pay: 40000, by: "company" },
    { id: "c", kind: "mortgage_payoff", label: "مخالصة العقاري — بنك", original: 400000, pay: 380000, by: "company", confirmed: true },
    { id: "d", kind: "personal_payoff", label: "مخالصة الشخصي — بنك", original: 60000, pay: 60000, by: "bank", monthly: 2000 },
  ],
  propertyValue: 800000,
  transferTaxPct: 0,
  bankMortgage: 720000,
  bankPersonal: 200000,
};

describe("opening a deal for a new client", () => {
  it("creates the file, the deal and its first stage together", async () => {
    const { clientId, dealId, study } = await startDeal(c.db, { borrower, input, actor: SYSTEM, now });
    expect(study.clientNet).toBe(222000);

    const [client] = await c.db.select().from(clients).where(eq(clients.id, clientId));
    expect(client).toMatchObject({ fileNo: "C-001", fullName: "عميل تجريبي", birthYear: 1991, totalSalary: 16000, propertyValue: 800000 });
    const [deal] = await c.db.select().from(deals).where(eq(deals.id, dealId));
    expect(deal).toMatchObject({ clientId, stage: "study", capital: 530000, fee: 106000, clientNet: 222000, verdict: "go" });
    expect(await c.db.select().from(dealStageEvents).where(eq(dealStageEvents.dealId, dealId))).toHaveLength(1);

    const actions = (await c.db.select().from(auditLog)).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(["client.create", "deal.save"]));
  });

  it("numbers files in order, whatever other numbers exist", async () => {
    await c.db.insert(clients).values({ fileNo: "T-900", fullName: "ملف بترقيم آخر" });
    const second = await startDeal(c.db, { borrower, input, actor: SYSTEM, now });
    const third = await startDeal(c.db, { borrower, input, actor: SYSTEM, now });
    const numbers = await c.db.select({ id: clients.id, fileNo: clients.fileNo }).from(clients);
    expect(numbers.find((n) => n.id === second.clientId)!.fileNo).toBe("C-002");
    expect(numbers.find((n) => n.id === third.clientId)!.fileNo).toBe("C-003");
  });

  it("leaves no client behind when the numbers are refused", async () => {
    const before = (await c.db.select().from(clients)).length;
    await expect(startDeal(c.db, { borrower, input: { ...input, ltvPct: 500 }, actor: SYSTEM, now })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(startDeal(c.db, { borrower: { ...borrower, fullName: " " }, input, actor: SYSTEM, now })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(startDeal(c.db, { borrower: { ...borrower, basicSalary: 20000 }, input, actor: SYSTEM, now })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await c.db.select().from(clients)).toHaveLength(before);
  });
});

describe("revising a deal", () => {
  it("recomputes the deal from the new numbers and the new salary", async () => {
    const { clientId, dealId } = await startDeal(c.db, { borrower, input, actor: SYSTEM, now });
    await setDealStage(c.db, { dealId, stage: "agreement", actor: SYSTEM, now });

    const later = new Date(now.getTime() + 3600_000);
    const revised = await reviseDeal(c.db, {
      dealId,
      borrower: { ...borrower, totalSalary: 17000 },
      input: { ...input, items: input.items.slice(0, 3), bankPersonal: 150000 },
      actor: SYSTEM,
      now: later,
    });
    expect(revised.dealId).toBe(dealId);

    const view = await getDeal(c.db, { dealId, now: later });
    expect(view!.deal.stage).toBe("agreement");
    expect(view!.client.totalSalary).toBe(17000);
    expect(view!.input.bankPersonal).toBe(150000);
    expect(view!.deal.clientNet).toBe(view!.study.clientNet);
    expect(await c.db.select().from(dealItems).where(eq(dealItems.dealId, dealId))).toHaveLength(3);
    expect(await c.db.select().from(deals).where(eq(deals.clientId, clientId))).toHaveLength(1);

    const log = await c.db.select().from(auditLog).where(eq(auditLog.entityId, clientId));
    expect(log.find((row) => row.action === "client.update")!.details).toEqual({ changed: ["totalSalary"] });
  });

  it("refuses a deal that has ended, and a deal that does not exist", async () => {
    const { dealId } = await startDeal(c.db, { borrower, input, actor: SYSTEM, now });
    await setDealStage(c.db, { dealId, stage: "closed", actor: SYSTEM, now });
    await expect(reviseDeal(c.db, { dealId, borrower, input, actor: SYSTEM, now })).rejects.toMatchObject({ code: "DEAL_ENDED" });
    await expect(reviseDeal(c.db, { dealId: 99999, borrower, input, actor: SYSTEM, now })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
