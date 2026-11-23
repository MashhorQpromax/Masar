import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultDealInput, type DealInput } from "@/domain/deal";
import type { Connection } from "@/server/db/client";
import { auditLog, clients, deals, feeApprovals, users } from "@/server/db/schema";
import { approveFeePlan, planApprovalsOf, planOf } from "@/server/deals/plan";
import { amendDeal, getDeal, rejectDeal, saveDeal } from "@/server/deals/service";
import { setFeePolicy } from "@/server/settings/fees";
import type { Actor } from "@/server/shared/actor";
import { DomainError } from "@/server/shared/errors";
import { testDb } from "../helpers/db";

/**
 * Approving a deal's fee plan, end to end: the copy that is kept, what is refused, and how an approval
 * falls when the deal's numbers move and is approved again as a new copy.
 */
let c: Connection;
let actor: Actor;
const now = new Date("2026-11-23T09:00:00Z");

beforeAll(async () => {
  c = await testDb();
  const [user] = await c.db.insert(users).values({ name: "مدير المكتب", email: "boss@test.local", passwordHash: "x", role: "admin" }).returning();
  actor = { userId: user!.id };
});
afterAll(async () => {
  await c.close();
});

let seq = 0;
const newClient = async () => {
  const [row] = await c.db
    .insert(clients)
    .values({ fileNo: `P-${++seq}`, fullName: "عميل تجريبي", birthYear: 1990, basicSalary: 12000, totalSalary: 16000, serviceMonths: 120, sector: "gov" })
    .returning();
  return row!;
};

const input: DealInput = {
  ...defaultDealInput(),
  items: [
    { id: "a", kind: "execution", label: "قرار تنفيذ", original: 100000, pay: 100000, by: "company" },
    { id: "b", kind: "mortgage_payoff", label: "مخالصة العقاري", original: 400000, pay: 380000, by: "company", confirmed: true },
  ],
  propertyValue: 800000,
  bankMortgage: 720000,
  bankPersonal: 200000,
};

const refusal = async (run: () => Promise<unknown>): Promise<string | null> => {
  try {
    await run();
    return null;
  } catch (error) {
    if (error instanceof DomainError) return error.params.reason ?? error.code;
    throw error;
  }
};
const standing = async (dealId: number) => {
  const view = (await getDeal(c.db, { dealId, now }))!;
  return planApprovalsOf(c.db, { dealId, now: planOf(view.input, view.study) });
};

describe("approving a deal's fee plan", () => {
  it("keeps a copy of the plan with who approved it, and logs what the fee comes to", async () => {
    const { dealId, study } = await saveDeal(c.db, { clientId: (await newClient()).id, input, actor, now });
    const approval = await approveFeePlan(c.db, { dealId, actor, now });
    expect(approval).toMatchObject({ by: "مدير المكتب", stands: true, plan: { amounts: { total: study.fee }, clientNet: study.clientNet, fee: input.fee } });
    const [row] = await c.db.select().from(feeApprovals).where(eq(feeApprovals.id, approval.id));
    expect(row!.plan).toMatchObject({ verdict: study.verdict, capital: study.capital, bases: { finance: study.financeBase } });
    const [logged] = await c.db.select().from(auditLog).where(eq(auditLog.action, "deal.fee_approve"));
    expect(logged).toMatchObject({ entity: "deal", entityId: dealId, details: { amount: study.fee, clientNet: study.clientNet } });
    expect(await refusal(() => approveFeePlan(c.db, { dealId, actor, now }))).toBe("STANDS");
  });

  it("is refused for a deal that does not close, or that ended", async () => {
    const short = await saveDeal(c.db, { clientId: (await newClient()).id, input: { ...input, bankMortgage: 300000, bankPersonal: 50000 }, actor, now });
    expect(short.study.verdict).toBe("short");
    expect(await refusal(() => approveFeePlan(c.db, { dealId: short.dealId, actor, now }))).toBe("NOT_CLOSING");
    const gone = await newClient();
    const ended = await saveDeal(c.db, { clientId: gone.id, input, actor, now });
    await rejectDeal(c.db, { clientId: gone.id, reason: "العميل اعتذر عن المتابعة", actor, now });
    expect(await refusal(() => approveFeePlan(c.db, { dealId: ended.dealId, actor, now }))).toBe("DEAL_ENDED");
    expect(await refusal(() => approveFeePlan(c.db, { dealId: 99999, actor, now }))).toBe("NOT_FOUND");
  });

  it("falls when the numbers move, says what moved, and is approved again as a new copy beside the old", async () => {
    const { dealId } = await saveDeal(c.db, { clientId: (await newClient()).id, input, actor, now });
    const first = await approveFeePlan(c.db, { dealId, actor, now });
    // The lender offers less: the fee on the financing and what the client keeps both move.
    await c.db.transaction((tx) => amendDeal(tx, { dealId, terms: { bankPersonal: 180000 }, actor, now }));
    const [fell] = await standing(dealId);
    expect(fell!.stands).toBe(false);
    expect(fell!.moves.figures.map((f) => f.name)).toEqual(["fee", "clientNet", "financing"]);
    expect(fell!.plan).toEqual(first.plan);

    await approveFeePlan(c.db, { dealId, actor: { ...actor, name: "سارة" }, now });
    expect((await standing(dealId)).map((a) => [a.stands, a.by])).toEqual([
      [true, "سارة"],
      [false, "مدير المكتب"],
    ]);
  });

  it("does not fall when only the notes change, nor when the office's policy does", async () => {
    const { dealId } = await saveDeal(c.db, { clientId: (await newClient()).id, input, actor, now });
    await approveFeePlan(c.db, { dealId, actor, now });
    await c.db.update(deals).set({ notes: "اتصل العميل وأكد الموعد" }).where(eq(deals.id, dealId));
    await setFeePolicy(c.db, { input: { settlePct: 15, financePct: 15, financeBase: "total", min: 10, max: 35 }, actor, now });
    expect((await standing(dealId)).map((a) => a.stands)).toEqual([true]);
  });

  it("falls when the fee itself is set otherwise", async () => {
    const { dealId } = await saveDeal(c.db, { clientId: (await newClient()).id, input, actor, now });
    await approveFeePlan(c.db, { dealId, actor, now });
    await c.db.transaction((tx) => amendDeal(tx, { dealId, terms: { fee: { ...input.fee, financeBase: "net" } }, actor, now }));
    const [fell] = await standing(dealId);
    expect(fell!.stands).toBe(false);
    expect(fell!.moves.fee).toEqual(["financeBase"]);
  });
});
