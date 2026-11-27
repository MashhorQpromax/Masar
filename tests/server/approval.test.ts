import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvalsOf, approveAnalysis } from "@/server/analysis/approval";
import { getAnalysis } from "@/server/analysis/service";
import { setConsent } from "@/server/clients/service";
import type { Connection } from "@/server/db/client";
import { analysisApprovals, auditLog, clients, products } from "@/server/db/schema";
import { reviewCreditReport } from "@/server/credit/service";
import { seedDemoLenders } from "@/server/demo/lenders";
import { seedDemo } from "@/server/demo/seed";
import { confirmTerms, updateProductTerms } from "@/server/lenders/service";
import { SYSTEM } from "@/server/shared/actor";
import { DomainError } from "@/server/shared/errors";
import { testDb } from "../helpers/db";
import { withoutDemoConflict } from "../helpers/demo";

/**
 * Approving a client's analysis, end to end: what is kept, what is refused, and how an approval falls
 * when the file, the record, the recommended lender or the result is no longer what it rested on.
 */
let c: Connection;
const now = new Date("2026-11-22T09:00:00Z");
const people: Record<string, number> = {};

beforeAll(async () => {
  c = await testDb();
  await seedDemo(c.db, now);
  await seedDemoLenders(c.db, now);
  await withoutDemoConflict(c.db);
  for (const row of await c.db.select({ id: clients.id, name: clients.fullName }).from(clients)) people[row.name.split(" ")[0]!] = row.id;
});
afterAll(async () => {
  await c.close();
});

const REASON = "الجهة أكدت الشرط هاتفياً، وخطابها في الطريق";
const refusal = async (run: () => Promise<unknown>): Promise<string | null> => {
  try {
    await run();
    return null;
  } catch (error) {
    if (error instanceof DomainError) return error.code === "APPROVAL_REFUSED" ? (error.params.reason ?? error.code) : error.code;
    throw error;
  }
};
const standing = async (name: string, at: Date = now) => {
  const view = (await getAnalysis(c.db, { clientId: people[name]!, now: at }))!;
  return { view, approvals: await approvalsOf(c.db, { clientId: people[name]!, now: view.fingerprint }) };
};

describe("approving a client's analysis", () => {
  it("is refused for a client with no record to analyse, and for one who does not exist", async () => {
    expect(await refusal(() => approveAnalysis(c.db, { clientId: people["فهد"]!, actor: SYSTEM, now }))).toBe("PENDING");
    expect(await refusal(() => approveAnalysis(c.db, { clientId: 9999, actor: SYSTEM, now }))).toBe("NOT_FOUND");
  });

  it("asks for the reason an incomplete recommendation is approved, and keeps it with what was open", async () => {
    const { view } = await standing("سالم");
    expect(view.analysis!.verdict).not.toBe("pending");
    expect(await refusal(() => approveAnalysis(c.db, { clientId: people["سالم"]!, actor: SYSTEM, now }))).toBe("REASON_NEEDED");
    expect(await refusal(() => approveAnalysis(c.db, { clientId: people["سالم"]!, reason: "قصير", actor: SYSTEM, now }))).toBe("REASON_NEEDED");

    const approval = await approveAnalysis(c.db, { clientId: people["سالم"]!, reason: `  ${REASON}  `, actor: SYSTEM, now });
    expect(approval).toMatchObject({ complete: false, reason: REASON, changed: [], verdict: view.analysis!.verdict });
    expect(approval.summary.completeness.complete).toBe(false);

    const [row] = await c.db.select().from(analysisApprovals).where(eq(analysisApprovals.id, approval.id));
    expect(row!.fingerprint).toEqual(view.fingerprint);
    // What the analysis read and found is kept as it was.
    expect(row!.basis).toMatchObject({ recordId: view.record!.id, file: { totalSalary: view.file.totalSalary } });
    expect((row!.basis as { analysis: { verdict: string } }).analysis.verdict).toBe(view.analysis!.verdict);

    const [logged] = await c.db.select().from(auditLog).where(eq(auditLog.action, "study.approve"));
    expect(logged).toMatchObject({ entity: "client", entityId: people["سالم"], details: { complete: false, reason: REASON, recordId: view.record!.id } });
  });

  it("does not approve twice what an approval already stands on", async () => {
    const { approvals } = await standing("سالم");
    expect(approvals.map((a) => a.changed)).toEqual([[]]);
    expect(await refusal(() => approveAnalysis(c.db, { clientId: people["سالم"]!, reason: REASON, actor: SYSTEM, now }))).toBe("STANDS");
  });

  it("falls when the file changes, says so, and can be approved again", async () => {
    await c.db.update(clients).set({ serviceMonths: 140 }).where(eq(clients.id, people["سالم"]!));
    const { approvals } = await standing("سالم");
    expect(approvals[0]!.changed).toContain("file");
    expect(approvals[0]!.changed).not.toContain("record");

    // The approver's name is kept with the approval, so the log reads the same once their account is gone.
    await approveAnalysis(c.db, { clientId: people["سالم"]!, reason: REASON, actor: { userId: null, name: "سارة" }, now });
    const again = await standing("سالم");
    // Newest first: the new one stands, the old one stays in the log as fallen.
    expect(again.approvals.map((a) => [a.changed.length === 0, a.by])).toEqual([
      [true, "سارة"],
      [false, null],
    ]);
  });

  it("does not fall when a lender it does not send the client to confirms its terms", async () => {
    const before = await standing("سالم");
    const sent = new Set(before.approvals[0]!.summary.apply.map((apply) => `${apply.lender}|${apply.product}`));
    const catalogue = await c.db.select({ id: products.id, name: products.name, lenderId: products.lenderId }).from(products);
    const listed = (await getAnalysis(c.db, { clientId: people["سالم"]!, now }))!.analysis!.kinds.flatMap((k) => k.today.fits.map((fit) => fit.product));
    const elsewhere = listed.find((product) => !sent.has(`${product.lenderName}|${product.name}`) && !product.verified)!;
    expect(elsewhere).toBeDefined();
    expect(catalogue.some((row) => String(row.id) === elsewhere.id)).toBe(true);
    await confirmTerms(c.db, { productId: Number(elsewhere.id), input: { terms: ["rate"], kind: "lender_website", reference: "https://example.com/rates" }, actor: SYSTEM, now });
    const after = await standing("سالم");
    expect(after.approvals[0]!.changed).toEqual([]);
  });

  it("falls when the lender it sends the client to changes its terms", async () => {
    const before = await standing("سالم");
    const apply = before.approvals[0]!.summary.apply[0]!;
    const product = before.view.analysis!.kinds.flatMap((k) => k.today.fits.map((fit) => fit.product)).find((p) => p.lenderName === apply.lender && p.name === apply.product)!;
    const { rateType, maxAmount, maxTenor, maxAgeAtMaturity, minSalary, minServiceMonths, maxLtv, requiresSalaryTransfer, acceptsLateSimah, settledDefaultWaitMonths } = product;
    const terms = { rateType, maxAmount, maxTenor, maxAgeAtMaturity, minSalary, minServiceMonths, maxLtv, requiresSalaryTransfer, acceptsLateSimah, settledDefaultWaitMonths };
    await updateProductTerms(c.db, { productId: Number(product.id), terms: { ...terms, rate: product.rate + 0.4 }, actor: SYSTEM });
    const after = await standing("سالم");
    expect(after.approvals[0]!.changed).toContain("lenders");
  });

  it("is refused once the client's consent is withdrawn, and every approval of theirs has fallen", async () => {
    await approveAnalysis(c.db, { clientId: people["نورة"]!, reason: REASON, actor: SYSTEM, now });
    await setConsent(c.db, { clientId: people["نورة"]!, given: false, actor: SYSTEM, now });
    const { approvals } = await standing("نورة");
    expect(approvals[0]!.changed).toEqual(expect.arrayContaining(["file", "result"]));
    expect(await refusal(() => approveAnalysis(c.db, { clientId: people["نورة"]!, reason: REASON, actor: SYSTEM, now }))).toBe("PENDING");
    await setConsent(c.db, { clientId: people["نورة"]!, given: true, actor: SYSTEM, now });
  });

  it("falls when the record is answered: a suspension someone checked is not the one that was assumed", async () => {
    await approveAnalysis(c.db, { clientId: people["ريم"]!, reason: REASON, actor: SYSTEM, now });
    const { view } = await standing("ريم");
    await reviewCreditReport(c.db, { clientId: people["ريم"]!, reportId: view.record!.id, review: { suspension: true, travelBan: null, note: null }, actor: SYSTEM, now });
    const { approvals } = await standing("ريم");
    expect(approvals[0]!.changed).toContain("record");
  });
});
