import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultDealInput, type DealInput } from "@/domain/deal";
import type { Connection } from "@/server/db/client";
import { auditLog, clients, deals, users } from "@/server/db/schema";
import { recordCollectedFee } from "@/server/deals/collected";
import { approveFeePlan, standingApproval } from "@/server/deals/plan";
import { getDeal, saveDeal, setDealStage } from "@/server/deals/service";
import { DEMO_LINK_SECRET, openLink } from "@/server/messages/links";
import { portalView } from "@/server/messages/portal";
import { monthView } from "@/server/reports/service";
import type { Actor } from "@/server/shared/actor";
import { testDb } from "../helpers/db";

/**
 * The fee the office actually collected, end to end: one amount a person records on a closed deal,
 * kept apart from the fee as counted, written to the log, and read by the month's report. It moves
 * no figure of the deal and never reaches the client.
 */
let c: Connection;
let actor: Actor;
const opened = new Date("2026-10-05T09:00:00Z");
const closed = new Date("2026-11-18T09:00:00Z");
const now = new Date("2026-11-27T12:00:00Z");

beforeAll(async () => {
  c = await testDb();
  const [user] = await c.db.insert(users).values({ name: "مدير المكتب", email: "boss@test.local", passwordHash: "x", role: "admin" }).returning();
  actor = { userId: user!.id };
});
afterAll(async () => {
  await c.close();
});

let seq = 0;
const input: DealInput = {
  ...defaultDealInput(),
  items: [
    { id: "a", kind: "execution", label: "قرار تنفيذ", original: 100000, pay: 100000, by: "company", confirmed: true },
    { id: "b", kind: "mortgage_payoff", label: "مخالصة العقاري", original: 400000, pay: 380000, by: "company", confirmed: true },
  ],
  propertyValue: 800000,
  bankMortgage: 720000,
  bankPersonal: 200000,
};

/** A made-up client with a deal that closes on its numbers, opened in October. */
async function newDeal() {
  seq += 1;
  const [client] = await c.db
    .insert(clients)
    .values({ fileNo: `K-${seq}`, fullName: "عميل تجريبي", phone: `05000002${String(seq).padStart(2, "0")}`, birthYear: 1990, basicSalary: 12000, totalSalary: 16000, serviceMonths: 120, sector: "gov" })
    .returning();
  const { dealId, study } = await saveDeal(c.db, { clientId: client!.id, input, actor, now: opened });
  return { clientId: client!.id, fileNo: client!.fileNo, dealId, fee: study.fee };
}

const reason = async (run: () => Promise<unknown>) =>
  run().then(
    () => "ok",
    (error) => error.params?.reason ?? error.code ?? String(error),
  );
const row = async (dealId: number) => (await c.db.select().from(deals).where(eq(deals.id, dealId)))[0]!;
const lastAudit = async () => (await c.db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(1))[0]!;

describe("the fee the office collected", () => {
  it("is not taken before the deal is closed", async () => {
    const deal = await newDeal();
    expect(await reason(() => recordCollectedFee(c.db, { dealId: deal.dealId, amount: 100000, actor }))).toBe("NOT_CLOSED");
    await setDealStage(c.db, { dealId: deal.dealId, stage: "recovered", actor, now: closed });
    expect(await reason(() => recordCollectedFee(c.db, { dealId: deal.dealId, amount: 100000, actor }))).toBe("NOT_CLOSED");
    expect((await row(deal.dealId)).feeCollected).toBeNull();
    expect(await reason(() => recordCollectedFee(c.db, { dealId: 999999, amount: 1, actor }))).toBe("NOT_FOUND");
  });

  it("is recorded on a closed deal beside the fee as counted, with who recorded it, and moves nothing else", async () => {
    const deal = await newDeal();
    await approveFeePlan(c.db, { dealId: deal.dealId, actor, now: opened });
    await setDealStage(c.db, { dealId: deal.dealId, stage: "closed", actor, now: closed });
    const before = await row(deal.dealId);
    expect(deal.fee).toBe(102000);

    expect(await recordCollectedFee(c.db, { dealId: deal.dealId, amount: 100000, actor })).toEqual({ changed: true });
    const after = await row(deal.dealId);
    expect(after.feeCollected).toBe(100000);
    // The fee as counted, the figures and the day the deal last changed are as they were.
    expect({ ...after, feeCollected: null }).toEqual(before);
    expect(await lastAudit()).toMatchObject({ action: "deal.fee_collected", entity: "deal", entityId: deal.dealId, userId: actor.userId, details: { clientId: deal.clientId, counted: 102000, before: null, after: 100000 } });
    // The approval of the fee plan still stands: what was collected is no number of the deal.
    expect(await standingApproval(c.db, (await getDeal(c.db, { dealId: deal.dealId, now }))!, now)).not.toBeNull();

    // The same amount again writes nothing.
    const logged = (await lastAudit()).id;
    expect(await recordCollectedFee(c.db, { dealId: deal.dealId, amount: 100000, actor })).toEqual({ changed: false });
    expect((await lastAudit()).id).toBe(logged);

    // A correction keeps what it replaced, to the halala; nothing collected is an amount too.
    await recordCollectedFee(c.db, { dealId: deal.dealId, amount: 100250.757, actor });
    expect((await row(deal.dealId)).feeCollected).toBe(100250.76);
    expect((await lastAudit()).details).toMatchObject({ before: 100000, after: 100250.76 });
    await recordCollectedFee(c.db, { dealId: deal.dealId, amount: 0, actor });
    expect((await row(deal.dealId)).feeCollected).toBe(0);

    // What is not an amount is refused and the record stays; an empty field takes it back.
    for (const amount of [-5, Number.NaN, 100_000_001]) expect(await reason(() => recordCollectedFee(c.db, { dealId: deal.dealId, amount, actor }))).toBe("AMOUNT");
    expect((await row(deal.dealId)).feeCollected).toBe(0);
    await recordCollectedFee(c.db, { dealId: deal.dealId, amount: null, actor });
    expect((await row(deal.dealId)).feeCollected).toBeNull();
    expect((await lastAudit()).details).toMatchObject({ before: 0, after: null });
  });

  it("is read by the month's report apart from the fees as counted", async () => {
    const one = await newDeal();
    const two = await newDeal();
    for (const deal of [one, two]) await setDealStage(c.db, { dealId: deal.dealId, stage: "closed", actor, now: closed });
    await recordCollectedFee(c.db, { dealId: one.dealId, amount: 99000, actor });
    const month = await monthView(c.db, { month: "2026-11", now });
    const ours = month.closed.filter((deal) => deal.fileNo === one.fileNo || deal.fileNo === two.fileNo);
    expect(ours.map((deal) => [deal.fileNo, deal.fee, deal.collected]).sort()).toEqual(
      [
        [one.fileNo, 102000, 99000],
        [two.fileNo, 102000, null],
      ].sort(),
    );
    expect(month.collectedFees).toBe(month.closed.reduce((sum, deal) => sum + (deal.collected ?? 0), 0));
    expect(month.collectedOn).toBe(month.closed.filter((deal) => deal.collected != null).length);
    expect(month.closedFees).toBe(month.closed.reduce((sum, deal) => sum + (deal.fee ?? 0), 0));
  });

  it("never reaches the client's own page", async () => {
    const deal = await newDeal();
    const link = await openLink(c.db, { dealId: deal.dealId, secret: DEMO_LINK_SECRET, actor, now });
    await setDealStage(c.db, { dealId: deal.dealId, stage: "closed", actor, now });
    await recordCollectedFee(c.db, { dealId: deal.dealId, amount: 98765, actor });
    const page = JSON.stringify(await portalView(c.db, { token: link.token, now }));
    expect(page).not.toContain("98765");
    expect(page.toLowerCase()).not.toContain("collected");
  });
});
