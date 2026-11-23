import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_POLICY, defaultDealInput, type DealInput } from "@/domain/deal";
import type { Connection } from "@/server/db/client";
import { auditLog, clients, deals, users } from "@/server/db/schema";
import { reviseDeal, saveDeal, startDeal } from "@/server/deals/service";
import { feePolicy, setFeePolicy } from "@/server/settings/fees";
import type { Actor } from "@/server/shared/actor";
import { DomainError } from "@/server/shared/errors";
import { testDb } from "../helpers/db";

/**
 * The fee policy and a deal's fee, end to end: what a new deal starts from, what a saved deal keeps,
 * and what changing a fee asks of the person who does it.
 */
let c: Connection;
let actor: Actor;
const now = new Date("2026-11-23T09:00:00Z");

beforeAll(async () => {
  c = await testDb();
  const [user] = await c.db.insert(users).values({ name: "مدير", email: "manager@test.local", passwordHash: "x", role: "admin" }).returning();
  actor = { userId: user!.id };
});
afterAll(async () => {
  await c.close();
});

let seq = 0;
const newClient = async () => {
  const [row] = await c.db
    .insert(clients)
    .values({ fileNo: `F-${++seq}`, fullName: "عميل تجريبي", birthYear: 1990, basicSalary: 12000, totalSalary: 16000, serviceMonths: 120, sector: "gov" })
    .returning();
  return row!;
};
const borrower = { fullName: "عميل جديد", birthYear: 1990, sector: "gov", basicSalary: 12000, totalSalary: 16000, serviceMonths: 120 };

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
const reason = "تعثر لدى شركة تمويل والجهد أكبر من المعتاد";
const may = { may: true, reason: null };

const refusal = async (run: () => Promise<unknown>): Promise<string | null> => {
  try {
    await run();
    return null;
  } catch (error) {
    if (error instanceof DomainError) return error.params.reason ?? error.code;
    throw error;
  }
};
const feeLog = async () => c.db.select().from(auditLog).where(eq(auditLog.action, "deal.fee"));

describe("the office's fee policy", () => {
  it("stands at the default until the manager sets it", async () => {
    expect(await feePolicy(c.db)).toEqual(DEFAULT_POLICY);
  });

  it("is refused when it does not hold, and kept with what it was before when it does", async () => {
    expect(await refusal(() => setFeePolicy(c.db, { input: { ...DEFAULT_POLICY, min: 40 }, actor, now }))).toBe("RANGE");
    expect(await refusal(() => setFeePolicy(c.db, { input: { ...DEFAULT_POLICY, settlePct: 8 }, actor, now }))).toBe("START_OUTSIDE");
    expect(await refusal(() => setFeePolicy(c.db, { input: { ...DEFAULT_POLICY, financeBase: "everything" }, actor, now }))).toBe("INVALID_INPUT");
    await setFeePolicy(c.db, { input: { settlePct: 12, financePct: 11, financeBase: "total", min: 10, max: 30 }, actor, now });
    expect(await feePolicy(c.db)).toEqual({ settlePct: 12, financePct: 11, financeBase: "total", min: 10, max: 30 });
    const [logged] = await c.db.select().from(auditLog).where(eq(auditLog.action, "settings.fees"));
    expect(logged).toMatchObject({ userId: actor.userId, details: { before: DEFAULT_POLICY, after: { settlePct: 12, max: 30 } } });
  });
});

describe("a deal's fee", () => {
  it("starts a new deal from the policy without a word, and asks why one starts otherwise", async () => {
    const policy = await feePolicy(c.db);
    const atPolicy = { ...input, fee: { ...input.fee, settlePct: policy.settlePct, financePct: policy.financePct } };
    await startDeal(c.db, { borrower, input: atPolicy, actor, now, fee: may });
    expect(await refusal(() => startDeal(c.db, { borrower, input: { ...atPolicy, fee: { ...atPolicy.fee, financePct: 20 } }, actor, now, fee: may }))).toBe("REASON_NEEDED");
    expect(await feeLog()).toEqual([]);
  });

  it("keeps a saved deal's fee when the policy changes, and lets it be saved again as it was", async () => {
    const client = await newClient();
    // Saved by the system as given: an old deal at 10 percent on each part.
    const { dealId } = await saveDeal(c.db, { clientId: client.id, input, actor, now });
    await setFeePolicy(c.db, { input: { settlePct: 15, financePct: 15, financeBase: "total", min: 15, max: 30 }, actor, now });
    const [kept] = await c.db.select().from(deals).where(eq(deals.id, dealId));
    expect([kept!.feeSettlePct, kept!.feeFinancePct]).toEqual([10, 10]);
    // Outside today's range, and still saved again untouched, by someone without the right.
    expect(await refusal(() => reviseDeal(c.db, { dealId, borrower, input: { ...input, notes: "اتصل العميل" }, actor, now, fee: { may: false, reason: null } }))).toBeNull();
  });

  it("keeps a fee counted on what is left after the settlements, and reads it back", async () => {
    const client = await newClient();
    const net = { ...input, fee: { ...input.fee, financeBase: "net" as const } };
    const { dealId, study } = await saveDeal(c.db, { clientId: client.id, input: net, actor, now });
    const [row] = await c.db.select().from(deals).where(eq(deals.id, dealId));
    expect(row!.feeFinanceBase).toBe("net");
    expect(study.financeBase).toBe(study.summary.afterSettle);
  });

  it("refuses a change from someone without the right, outside the range, or without a reason", async () => {
    const client = await newClient();
    const { dealId } = await saveDeal(c.db, { clientId: client.id, input: { ...input, fee: { ...input.fee, settlePct: 20, financePct: 20 } }, actor, now });
    const raised = { ...input, fee: { ...input.fee, settlePct: 20, financePct: 25 } };
    expect(await refusal(() => reviseDeal(c.db, { dealId, borrower, input: raised, actor, now, fee: { may: false, reason } }))).toBe("NOT_ALLOWED");
    expect(await refusal(() => reviseDeal(c.db, { dealId, borrower, input: { ...raised, fee: { ...raised.fee, financePct: 31 } }, actor, now, fee: { may: true, reason } }))).toBe("OUT_OF_RANGE");
    expect(await refusal(() => reviseDeal(c.db, { dealId, borrower, input: raised, actor, now, fee: { may: true, reason: "أعلى" } }))).toBe("REASON_NEEDED");
    const [still] = await c.db.select().from(deals).where(eq(deals.id, dealId));
    expect(still!.feeFinancePct).toBe(20);
  });

  it("keeps a change with the reason, the fee before and after, and the amount it comes to", async () => {
    const client = await newClient();
    const { dealId } = await saveDeal(c.db, { clientId: client.id, input: { ...input, fee: { ...input.fee, settlePct: 20, financePct: 20 } }, actor, now });
    const { study } = await reviseDeal(c.db, { dealId, borrower, input: { ...input, fee: { ...input.fee, settlePct: 20, financePct: 25 } }, actor, now, fee: { may: true, reason: `  ${reason}  ` } });
    const [logged] = (await feeLog()).filter((row) => row.entityId === dealId);
    expect(logged).toMatchObject({
      entity: "deal",
      userId: actor.userId,
      details: { before: { financePct: 20 }, after: { financePct: 25 }, changed: ["financePct"], reason, amount: study.fee },
    });
  });
});
