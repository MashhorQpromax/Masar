import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultDealInput, type DealInput } from "@/domain/deal";
import { termsOf } from "@/domain/eligibility";
import { setConsent } from "@/server/clients/service";
import type { Connection } from "@/server/db/client";
import { auditLog, clients, users } from "@/server/db/schema";
import { approveFeePlan } from "@/server/deals/plan";
import { saveDeal } from "@/server/deals/service";
import { addPaper, keepFile, reviewPaper } from "@/server/documents/service";
import { applyRoute, getFunding } from "@/server/funding/service";
import { lenderReplies, recentDecisions, recordDecision, replyPapers } from "@/server/knowledge/service";
import { addLender, addProduct, confirmTerms, updateProductTerms } from "@/server/lenders/service";
import { getOpportunities, makeReport, reportById, reportsOf } from "@/server/opportunities/service";
import type { Actor } from "@/server/shared/actor";
import { DomainError } from "@/server/shared/errors";
import { testDb } from "../helpers/db";

/**
 * A deal's opportunities end to end: a lender's written answer kept against a paper of the file, the
 * classes it moves, the report that is saved only with the client's consent, and an approval that
 * falls when a lender's term changes.
 */
let c: Connection;
let actor: Actor;
let lenderId: number;
let productId: number;
const now = new Date("2026-11-23T09:00:00Z");
const LENDER = "جهة الاختبار";

/** A small PDF: what the office keeps for a paper. */
const pdf = (serial: string) => new TextEncoder().encode(`%PDF-1.4\n% ${serial}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`);

const terms = { rate: 3.3, rateType: "flat", maxAmount: 1_500_000, maxTenor: 60, maxAgeAtMaturity: 65, minSalary: 4000, minServiceMonths: 3, maxLtv: null, requiresSalaryTransfer: false, acceptsLateSimah: false, settledDefaultWaitMonths: 0 };

beforeAll(async () => {
  c = await testDb();
  const [user] = await c.db.insert(users).values({ name: "مدير المكتب", email: "boss@test.local", passwordHash: "x", role: "admin" }).returning();
  actor = { userId: user!.id };
  ({ lenderId } = await addLender(c.db, { input: { name: LENDER, type: "bank" }, actor }));
  ({ productId } = await addProduct(c.db, {
    lenderId,
    input: { financeType: "personal", scope: { name: "التمويل الشخصي", sectors: ["gov", "military", "semi_gov"], nationalities: ["saudi"], minAge: 21 }, terms },
    actor,
  }));
  await confirmTerms(c.db, { productId, input: { kind: "lender_document", reference: "دليل منتجات الجهة", terms: termsOf("personal") }, actor, now });
});
afterAll(async () => {
  await c.close();
});

let seq = 0;
const newClient = async () => {
  const [row] = await c.db
    .insert(clients)
    .values({ fileNo: `O-${++seq}`, fullName: "عميل تجريبي", birthYear: 1990, basicSalary: 12000, totalSalary: 16000, serviceMonths: 120, sector: "gov" })
    .returning();
  return row!;
};

const input: DealInput = {
  ...defaultDealInput(),
  structure: "settle_personal",
  items: [
    { id: "a", kind: "execution", label: "قرار تنفيذ", original: 100000, pay: 100000, by: "company", confirmed: true },
    { id: "b", kind: "default", label: "تعثر", original: 50000, pay: 40000, by: "company", confirmed: true },
  ],
  fixedCosts: 0,
};

const reason = async (run: () => Promise<unknown>): Promise<string | null> => {
  try {
    await run();
    return null;
  } catch (error) {
    if (error instanceof DomainError) return error.params.reason ?? error.code;
    throw error;
  }
};

/** A deal whose client has a paper holding a file, and the opportunity with the test lender. */
async function setUp() {
  const client = await newClient();
  const { dealId } = await saveDeal(c.db, { clientId: client.id, input, actor, now });
  const { code } = await addPaper(c.db, { clientId: client.id, label: "رد الجهة المكتوب", actor, now });
  const { paperId } = await c.db.transaction((tx) => keepFile(tx, { clientId: client.id, code, name: "رد.pdf", bytes: pdf(`${client.fileNo}`), actor, now }));
  const ours = async () => (await getOpportunities(c.db, { dealId, now }))!.list.find((o) => o.route.personal?.product.lenderName === LENDER)!;
  return { client, dealId, paperId, ours };
}
const yes = (paper: number | null, amount = 300000) => ({ lenderId, part: "personal", decision: "approved", approvedAmount: amount, asks: [], reason: null, note: null, onDeal: false, replyPaperId: paper });

describe("a lender's written answer", () => {
  it("is kept against a paper of the client's own file that holds a file, and only then confirms", async () => {
    const { client, dealId, paperId, ours } = await setUp();
    // No credit report was read: what the lender will see is not known, so the opportunity is theoretical.
    expect((await ours()).class).toBe("theoretical");

    // A paper of another client, or one with nothing in it, cannot hold the answer.
    const other = await setUp();
    expect(await reason(() => recordDecision(c.db, { dealId, decision: yes(other.paperId), actor, now }))).toBe("REPLY_PAPER");
    const { paperId: empty } = await addPaper(c.db, { clientId: client.id, label: "ورقة فارغة", actor, now });
    expect(await reason(() => recordDecision(c.db, { dealId, decision: yes(empty), actor, now }))).toBe("REPLY_PAPER");
    expect((await replyPapers(c.db, client.id)).map((p) => p.id)).toEqual([paperId]);

    // What the employee was told is kept, and moves nothing.
    await recordDecision(c.db, { dealId, decision: yes(null), actor, now });
    expect((await ours()).class).toBe("theoretical");

    await recordDecision(c.db, { dealId, decision: yes(paperId), actor, now });
    expect(await lenderReplies(c.db, client.id)).toMatchObject([{ lenderId: String(lenderId), part: "personal", decision: "approved", amount: 300000, on: "2026-11-23", written: true }, { written: false }]);
    const confirmed = await ours();
    expect(confirmed.class).toBe("confirmed");
    expect(confirmed.financing).toBe(300000);
    expect((await recentDecisions(c.db, { clientId: client.id }))[0]).toMatchObject({ written: true });
    const [logged] = (await c.db.select().from(auditLog).where(eq(auditLog.action, "lender.decision"))).filter((row) => row.entityId === client.id).slice(-1);
    expect(logged!.details).toMatchObject({ written: true });

    // The paper is sent back: the answer is no longer in writing, and the class falls with it.
    await reviewPaper(c.db, { clientId: client.id, paperId, review: { verdict: "rejected", note: "ليست من الجهة" }, actor, now });
    expect((await ours()).class).toBe("theoretical");
  });

  it("turns the opportunity down when the lender refuses, and no approval of the plan passes over it", async () => {
    const { dealId, ours } = await setUp();
    const route = (await ours()).route;
    await applyRoute(c.db, { dealId, key: route.key, actor, now });
    await recordDecision(c.db, { dealId, decision: { ...yes(null), decision: "rejected", approvedAmount: null, reason: "simah" }, actor, now });
    const refused = await ours();
    expect(refused.class).toBe("not_viable");
    expect(refused.chosen).toBe(true);
    expect(await reason(() => approveFeePlan(c.db, { dealId, actor, now }))).toBe("BLOCKED");
  });
});

describe("the plan the deal holds", () => {
  it("loses its approval when a term of its lender changes", async () => {
    const { dealId, ours } = await setUp();
    await applyRoute(c.db, { dealId, key: (await ours()).route.key, actor, now });
    await approveFeePlan(c.db, { dealId, actor, now });
    expect((await getOpportunities(c.db, { dealId, now }))!.plan).toBe("stands");

    // The lender's ceiling changes and nothing on the deal does: the approval falls, and says why.
    await updateProductTerms(c.db, { productId, terms: { ...terms, maxAmount: 1_400_000 }, actor });
    const view = (await getOpportunities(c.db, { dealId, now }))!;
    expect(view.plan).toBe("fell");
    expect(view.approval?.moves.lenders).toBe(true);
    await updateProductTerms(c.db, { productId, terms, actor });
    await confirmTerms(c.db, { productId, input: { kind: "lender_document", reference: "دليل منتجات الجهة", terms: termsOf("personal") }, actor, now });
  });
});

describe("the report of a deal's opportunities", () => {
  it("is not made before the client's consent is recorded, then keeps the figures the screen shows", async () => {
    const { client, dealId } = await setUp();
    expect(await reason(() => makeReport(c.db, { dealId, actor, now }))).toBe("NO_CONSENT");
    await setConsent(c.db, { clientId: client.id, given: true, actor, now });

    const { id } = await makeReport(c.db, { dealId, actor, now });
    const saved = (await reportById(c.db, { dealId, reportId: id }))!;
    const screen = (await getOpportunities(c.db, { dealId, now }))!;
    expect(saved.body.day).toBe("2026-11-23");
    expect(saved.by).toBe("مدير المكتب");
    expect(saved.body.cards.map((card) => [card.key, card.class, card.financing, card.cost, card.fee, card.net.net])).toEqual(
      screen.list.map((o) => [o.key, o.class, o.financing, o.cost, o.fee, o.net.net]),
    );
    // Each figure keeps whether it is confirmed or an estimate.
    expect(saved.body.cards[0]!.net.lines.every((line) => line.certainty === "confirmed" || line.certainty === "estimated")).toBe(true);
    expect(await reportsOf(c.db, dealId)).toMatchObject([{ id, by: "مدير المكتب", count: screen.list.length }]);
    expect(await reportById(c.db, { dealId: dealId + 1000, reportId: id })).toBeNull();
    const [logged] = await c.db.select().from(auditLog).where(eq(auditLog.action, "deal.report"));
    expect(logged).toMatchObject({ entity: "deal", entityId: dealId, details: { report: id, opportunities: screen.list.length } });
  });
});
