import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultDealInput, type DealInput } from "@/domain/deal";
import type { Connection } from "@/server/db/client";
import { auditLog, clients, dealItems, dealStageEvents, deals, notes, shareLinks, users } from "@/server/db/schema";
import { getDeal, listOpenDeals, rejectDeal, reopenDeal, saveDeal, setDealStage } from "@/server/deals/service";
import type { Actor } from "@/server/shared/actor";
import { testDb } from "../helpers/db";

let c: Connection;
let actor: Actor;
const now = new Date("2026-11-22T09:00:00Z");

beforeAll(async () => {
  c = await testDb();
  const [user] = await c.db.insert(users).values({ name: "محلل", email: "analyst@test.local", passwordHash: "x", role: "analyst" }).returning();
  actor = { userId: user!.id, ip: "127.0.0.1" };
});
afterAll(async () => {
  await c.close();
});

let seq = 0;
const newClient = async () => {
  const [row] = await c.db
    .insert(clients)
    .values({ fileNo: `T-${++seq}`, fullName: "عميل تجريبي", birthYear: 1991, basicSalary: 12000, totalSalary: 16000, serviceMonths: 120, sector: "gov" })
    .returning();
  return row!;
};

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

describe("saving a deal", () => {
  it("stores the inputs, the items and the engine's result", async () => {
    const client = await newClient();
    const { dealId, study } = await saveDeal(c.db, { clientId: client.id, input, actor, now });
    expect(study.clientNet).toBe(222000);

    const [deal] = await c.db.select().from(deals).where(eq(deals.id, dealId));
    expect(deal).toMatchObject({ stage: "study", capital: 530000, fee: 106000, clientNet: 222000, verdict: "go", ownerId: actor.userId });
    expect(await c.db.select().from(dealItems).where(eq(dealItems.dealId, dealId))).toHaveLength(4);
    expect(await c.db.select().from(dealStageEvents).where(eq(dealStageEvents.dealId, dealId))).toHaveLength(1);

    const [updated] = await c.db.select().from(clients).where(eq(clients.id, client.id));
    expect(updated!.propertyValue).toBe(800000);
    const [log] = await c.db.select().from(auditLog).where(eq(auditLog.entityId, dealId));
    expect(log).toMatchObject({ action: "deal.save", entity: "deal", userId: actor.userId, ip: "127.0.0.1" });
  });

  it("reads back exactly what was saved", async () => {
    const client = await newClient();
    const { dealId, study } = await saveDeal(c.db, { clientId: client.id, input, actor, now });
    const view = await getDeal(c.db, { dealId, now });
    expect(view!.input).toEqual({ ...input, personalLender: null, personalLenderKind: null, items: input.items.map((i) => ({ ...i, monthly: i.monthly ?? null })) });
    expect(view!.study.clientNet).toBe(study.clientNet);
    expect(view!.study.ledger).toEqual(study.ledger);
  });

  it("updates the deal in progress instead of opening a second one", async () => {
    const client = await newClient();
    const first = await saveDeal(c.db, { clientId: client.id, input, actor, now });
    const second = await saveDeal(c.db, { clientId: client.id, input: { ...input, bankPersonal: 100000, bankMortgage: 500000 }, actor, now });
    expect(second.dealId).toBe(first.dealId);
    const [deal] = await c.db.select().from(deals).where(eq(deals.id, first.dealId));
    expect(deal).toMatchObject({ clientNet: -65000, verdict: "short" });
    expect(await c.db.select().from(dealItems).where(eq(dealItems.dealId, first.dealId))).toHaveLength(4);
  });

  it("refuses input outside the allowed limits, and saves nothing", async () => {
    const client = await newClient();
    await expect(saveDeal(c.db, { clientId: client.id, input: { ...input, transferTaxPct: 140 }, actor, now })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(saveDeal(c.db, { clientId: client.id, input: { ...input, items: [input.items[0], input.items[0]] }, actor, now })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(saveDeal(c.db, { clientId: 999999, input, actor, now })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await c.db.select().from(deals).where(eq(deals.clientId, client.id))).toHaveLength(0);
  });
});

describe("moving a deal", () => {
  it("records each stage and when it was entered", async () => {
    const client = await newClient();
    const { dealId } = await saveDeal(c.db, { clientId: client.id, input, actor, now });
    const later = new Date("2026-11-25T09:00:00Z");
    await setDealStage(c.db, { dealId, stage: "agreement", note: "وقّع العميل", actor, now: later });
    const view = await getDeal(c.db, { dealId, now: later });
    expect(view!.deal.stage).toBe("agreement");
    expect(view!.stageEnteredAt).toEqual(later);
    const open = await listOpenDeals(c.db);
    expect(open.find((d) => d.dealId === dealId)).toMatchObject({ stage: "agreement", stageEnteredAt: later, capital: 530000, fileNo: client.fileNo });
  });

  it("refuses a stage the structure does not have", async () => {
    const client = await newClient();
    const { dealId } = await saveDeal(c.db, { clientId: client.id, input: { ...input, structure: "settle_personal" }, actor, now });
    await expect(setDealStage(c.db, { dealId, stage: "transfer", actor, now })).rejects.toMatchObject({ code: "INVALID_STAGE" });
    await expect(setDealStage(c.db, { dealId, stage: "lost", actor, now })).rejects.toMatchObject({ code: "INVALID_STAGE" });
  });
});

describe("rejecting and reopening", () => {
  it("marks the deal lost, the client rejected, and cuts every shared link", async () => {
    const client = await newClient();
    const { dealId } = await saveDeal(c.db, { clientId: client.id, input, actor, now });
    await c.db.insert(shareLinks).values({ tokenHash: `h-${client.id}`, clientId: client.id, expiresAt: new Date("2026-12-31T00:00:00Z") });

    await rejectDeal(c.db, { clientId: client.id, reason: "الصفقة لا تقفل", actor, now });

    const [deal] = await c.db.select().from(deals).where(eq(deals.id, dealId));
    const [after] = await c.db.select().from(clients).where(eq(clients.id, client.id));
    const [link] = await c.db.select().from(shareLinks).where(eq(shareLinks.clientId, client.id));
    expect(deal!.stage).toBe("lost");
    expect(after!.status).toBe("rejected");
    expect(link!.revoked).toBe(true);
    expect(await c.db.select().from(notes).where(eq(notes.clientId, client.id))).toHaveLength(1);
    expect((await listOpenDeals(c.db)).some((d) => d.dealId === dealId)).toBe(false);

    await reopenDeal(c.db, { clientId: client.id, note: "أُعيد فتح الملف", actor, now });
    const [reopened] = await c.db.select().from(deals).where(eq(deals.id, dealId));
    const [again] = await c.db.select().from(clients).where(eq(clients.id, client.id));
    expect(reopened!.stage).toBe("study");
    expect(again!.status).toBe("study");
  });
});
