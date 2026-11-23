import { desc } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultDealInput, type DealInput } from "@/domain/deal";
import type { Connection } from "@/server/db/client";
import { auditLog, clients, users, waMessages } from "@/server/db/schema";
import { approveFeePlan, standingApproval } from "@/server/deals/plan";
import { amendDeal, getDeal, rejectDeal, saveDeal } from "@/server/deals/service";
import { DEMO_LINK_SECRET, openLink } from "@/server/messages/links";
import { portalView } from "@/server/messages/portal";
import { getMessages, noteSent, offerOf } from "@/server/messages/service";
import type { Actor } from "@/server/shared/actor";
import { testDb } from "../helpers/db";

/**
 * The client's final offer, end to end: a fee reaches a client only from a plan the manager approved
 * as the deal is now, in the message and on the client's own page alike, and never with what the
 * office puts in or earns on it.
 */
let c: Connection;
let actor: Actor;
const now = new Date("2026-11-23T17:30:00Z");
const secret = DEMO_LINK_SECRET;

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

/** A made-up client with a deal that closes and an open link. */
async function newDeal(terms: Partial<DealInput> = {}) {
  seq += 1;
  const [client] = await c.db
    .insert(clients)
    .values({
      fileNo: `F-${seq}`,
      fullName: "عميل تجريبي",
      phone: `05000001${String(seq).padStart(2, "0")}`,
      birthYear: 1990,
      basicSalary: 12000,
      totalSalary: 16000,
      serviceMonths: 120,
      sector: "gov",
    })
    .returning();
  const { dealId, study } = await saveDeal(c.db, { clientId: client!.id, input: { ...input, ...terms }, actor, now });
  const link = study.verdict === "go" || study.verdict === "tight" ? await openLink(c.db, { dealId, secret, actor, now }) : null;
  return { clientId: client!.id, dealId, study, token: link?.token ?? "" };
}

const messages = async (dealId: number) => (await getMessages(c.db, { dealId, secret, now }))!;
const code = async (run: () => Promise<unknown>) =>
  run().then(
    () => "ok",
    (error) => error.code ?? String(error),
  );
const lastAudit = async () => (await c.db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(1))[0]!;
const lastMessage = async () => (await c.db.select().from(waMessages).orderBy(desc(waMessages.id)).limit(1))[0]!;

describe("the client's final offer", () => {
  it("is not written, sent or shown before the fee plan is approved", async () => {
    const deal = await newDeal();
    const view = await messages(deal.dealId);
    expect(view.offer).toBeNull();
    expect(view.gate.allowed).toEqual(["study", "papers", "progress", "reply", "internal"]);
    expect(await code(() => noteSent(c.db, { dealId: deal.dealId, kind: "offer", body: "عرضك النهائي", actor, now }))).toBe("GATE_CLOSED");
    const page = (await portalView(c.db, { token: deal.token, now }))!;
    expect(page.offer).toBeNull();
    // The page still tells the client what they may know without the fee.
    expect(page.facts!.financing.length).toBe(2);
    expect(JSON.stringify(page).toLowerCase()).not.toContain("fee");
    expect(await standingApproval(c.db, (await getDeal(c.db, { dealId: deal.dealId, now }))!, now)).toBeNull();
  });

  it("opens once the manager approves the plan, with the fee as the approval kept it", async () => {
    const deal = await newDeal();
    const approval = await approveFeePlan(c.db, { dealId: deal.dealId, actor, now });
    const view = await messages(deal.dealId);
    expect(view.gate.allowed).toEqual(["study", "offer", "papers", "progress", "reply", "internal"]);
    expect(view.offer).toMatchObject({
      keeps: deal.study.clientNet,
      fee: {
        total: approval.plan.amounts.total,
        items: [
          { kind: "settle", pct: 10, base: 100000, amount: 10000 },
          { kind: "finance", pct: 10, base: 920000, on: "total", amount: 92000 },
        ],
      },
      obligations: { amount: 480000, certainty: "confirmed" },
    });
    // The client's own page shows the same offer, and nothing of the office's side of the deal.
    const page = (await portalView(c.db, { token: deal.token, now }))!;
    expect(page.offer).toEqual(view.offer);
    const text = JSON.stringify(page).toLowerCase();
    for (const word of ["capital", "roi", "annualized", "cover", "ledger", "risk", "phone", "nationalid", 'salary"', "print", "approver"]) expect(text, word).not.toContain(word);
    expect(text).not.toContain(String(deal.study.capital));

    await noteSent(c.db, { dealId: deal.dealId, kind: "offer", body: "عرضك النهائي: أتعابنا 102,000 ريال", actor, now });
    expect(await lastMessage()).toMatchObject({ clientId: deal.clientId, direction: "out", status: "manual", body: "عرضك النهائي: أتعابنا 102,000 ريال" });
    expect(await lastAudit()).toMatchObject({ action: "wa.send", entityId: deal.clientId, details: { kind: "offer", via: "manual" } });
  });

  it("shuts the moment a number moves, and opens again only with a new approval", async () => {
    const deal = await newDeal();
    await approveFeePlan(c.db, { dealId: deal.dealId, actor, now });
    expect((await messages(deal.dealId)).offer!.fee.total).toBe(102000);

    // The lender offers less. The approved fee is no longer the deal's fee, so no fee is shown at all.
    await c.db.transaction((tx) => amendDeal(tx, { dealId: deal.dealId, terms: { bankPersonal: 180000 }, actor, now }));
    const fell = await messages(deal.dealId);
    expect(fell.offer).toBeNull();
    expect(fell.gate.allowed).not.toContain("offer");
    expect(await code(() => noteSent(c.db, { dealId: deal.dealId, kind: "offer", body: "عرضك النهائي", actor, now }))).toBe("GATE_CLOSED");
    const page = (await portalView(c.db, { token: deal.token, now }))!;
    expect(page.offer).toBeNull();
    expect(page.facts).not.toBeNull();

    await approveFeePlan(c.db, { dealId: deal.dealId, actor, now });
    const again = await messages(deal.dealId);
    expect(again.offer!.fee.total).toBe(100000);
    expect((await portalView(c.db, { token: deal.token, now }))!.offer).toEqual(again.offer);
  });

  it("falls with the fee itself: a fee set otherwise is not the fee that was approved", async () => {
    const deal = await newDeal();
    await approveFeePlan(c.db, { dealId: deal.dealId, actor, now });
    await c.db.transaction((tx) => amendDeal(tx, { dealId: deal.dealId, terms: { fee: { ...input.fee, financePct: 15 } }, actor, now }));
    expect((await messages(deal.dealId)).offer).toBeNull();
    expect((await portalView(c.db, { token: deal.token, now }))!.offer).toBeNull();
  });

  it("is shut with everything else for a cancelled deal, even one whose plan was approved", async () => {
    const deal = await newDeal();
    await approveFeePlan(c.db, { dealId: deal.dealId, actor, now });
    await rejectDeal(c.db, { clientId: deal.clientId, reason: "العميل اعتذر عن المتابعة", actor, now });
    const view = await messages(deal.dealId);
    expect(view.offer).toBeNull();
    expect(view.gate).toEqual({ allowed: ["internal"], reason: "REJECTED" });
    expect(await portalView(c.db, { token: deal.token, now })).toBeNull();
    expect(await offerOf(c.db, (await getDeal(c.db, { dealId: deal.dealId, now }))!, now)).toBeNull();
  });

  it("does not exist for a deal that does not close: there is no plan to approve", async () => {
    const deal = await newDeal({ bankMortgage: 300000, bankPersonal: 50000 });
    expect(deal.study.verdict).toBe("short");
    expect(await code(() => approveFeePlan(c.db, { dealId: deal.dealId, actor, now }))).toBe("PLAN_REFUSED");
    const view = await messages(deal.dealId);
    expect(view.offer).toBeNull();
    expect(view.gate).toEqual({ allowed: ["internal"], reason: "DEFICIT" });
  });
});
