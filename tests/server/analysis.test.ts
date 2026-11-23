import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ClientAnalysis, Fit } from "@/domain/analysis";
import { getAnalysis } from "@/server/analysis/service";
import { setConsent } from "@/server/clients/service";
import type { Connection } from "@/server/db/client";
import { clients, documents } from "@/server/db/schema";
import { seedDemo } from "@/server/demo/seed";
import { SYSTEM } from "@/server/shared/actor";
import { testDb } from "../helpers/db";
import { withoutDemoConflict } from "../helpers/demo";

/**
 * The analysis of the demo clients, read from what is stored: the file, the newest credit record and
 * the catalogue. The domain's own examples check the arithmetic; these check that the service hands
 * the engine the right things.
 */
let c: Connection;
const now = new Date("2026-11-22T09:00:00Z");
const people: Record<string, number> = {};

beforeAll(async () => {
  c = await testDb();
  await seedDemo(c.db, now);
  // The conflict the demonstration carries has tests of its own. These read each client as the file stands.
  await withoutDemoConflict(c.db);
  for (const row of await c.db.select({ id: clients.id, name: clients.fullName }).from(clients)) people[row.name.split(" ")[0]!] = row.id;
});
afterAll(async () => {
  await c.close();
});

const read = async (name: string, at: Date = now) => (await getAnalysis(c.db, { clientId: people[name]!, now: at }))!;
const analysed = async (name: string, at: Date = now): Promise<ClientAnalysis> => (await read(name, at)).analysis!;
const codes = (fit: Fit): string[] => [...fit.conditions, ...fit.refusals].map((check) => check.code);
const stepCodes = (a: ClientAnalysis): string[] => a.steps.map((step) => (step.code === "CREDIT" ? step.action.code : step.code));

describe("a client's analysis", () => {
  it("is not found for a client that does not exist", async () => {
    expect(await getAnalysis(c.db, { clientId: 9999, now })).toBeNull();
  });

  it("has nothing to analyse before a report is read", async () => {
    const fahad = await read("فهد");
    expect(fahad.record).toBeNull();
    expect(fahad.analysis).toBeNull();
    // The file is read all the same: his salary certificate was checked by a person.
    expect(fahad.file.incomeVerified).toBe(true);
    expect((await read("ماجد")).analysis).toBeNull();
  });

  it("reads the file, the record and the catalogue together", async () => {
    const view = await read("سالم");
    const a = view.analysis!;
    expect(view.deal).toMatchObject({ open: true });
    expect(view.salaryBank).toBe("مصرف الراجحي");
    // No real lender's terms are confirmed in the demonstration: as written they take him, and nobody knows that they do.
    expect(a.verdict).toBe("needs_verification");
    expect(a.afterClearing).toBeNull();
    // The salary is on the file and the paper that states it was sent back, so it is stated and not verified.
    expect(a.income).toEqual({ basis: "stated", salary: 15200, basicOnly: false, other: 0, total: 15200 });
    // 3,100 for the mortgage and 1,900 for the loan. The card gives no installment and is not counted.
    expect(a.burden).toEqual({ monthly: 5000, mortgage: 3100, nonMortgage: 1900, share: 32.9, uncounted: 1 });
    expect(a.kinds.map((k) => [k.kind, k.room.available, k.room.rule])).toEqual([
      ["personal", 3166, "SALARY_DEDUCTION"],
      ["mortgage", 4880, "TOTAL_CAP"],
    ]);
    // The bank his salary is paid into leads: it asks for nothing but what nobody has confirmed with it yet.
    for (const k of a.kinds) {
      expect(k.cleared).toBeNull();
      expect(k.today.fits[0]!.product.lenderName).toBe("مصرف الراجحي");
      expect(codes(k.today.fits[0]!)).toEqual(["SETTLED_UNCONFIRMED"]);
      expect(k.today.fits.every((fit) => fit.eligibility === "needs_verification" || fit.eligibility === "not_eligible")).toBe(true);
      expect([k.today.open, k.today.conditional]).toEqual([0, 0]);
    }
    expect(a.gaps.map((gap) => [gap.kind, gap.code])).toEqual([
      ["unconfirmed", "INCOME_PROOF"],
      ["unconfirmed", "CARD_SHARE"],
      ["unconfirmed", "TERMS"],
    ]);
    // His bank is asked once, for both kinds of finance, before anybody is told to apply.
    expect(stepCodes(a)).toEqual(["VERIFY_INCOME", "CONFIRM_TERMS", "APPLY", "APPLY"]);
    expect(a.steps[1]).toMatchObject({ lender: "مصرف الراجحي", kinds: ["personal", "mortgage"], beforePaying: false });
    for (const step of a.steps) if (step.code === "APPLY") expect(step).toMatchObject({ lender: "مصرف الراجحي", eligibility: "needs_verification", afterClearing: false });
  });

  it("holds the lenders against the record as it is and as it will be, and promises nothing", async () => {
    const a = await analysed("نورة");
    expect(a.verdict).toBe("not_eligible");
    expect(a.afterClearing).toBe("needs_verification");
    for (const k of a.kinds) {
      // Today the unpaid order closes every lender, and that is certain whoever confirmed what.
      for (const fit of k.today.fits) {
        expect(fit.status).toBe("fail");
        expect(codes(fit)).toContain("RECORD_OPEN");
        expect(fit.eligibility).toBe("not_eligible");
      }
      // Once it is paid nobody refuses, and nobody takes her either: no lender was asked what it does with a default just paid.
      expect([k.cleared!.open, k.cleared!.conditional]).toEqual([0, 0]);
      expect(k.cleared!.unsure).toBe(k.cleared!.fits.length);
      for (const fit of k.cleared!.fits) expect(codes(fit)).toContain("SETTLED_UNCONFIRMED");
    }
    expect(a.steps[0]).toEqual({ code: "COMPLETE_FILE", missing: ["SALARY_BANK"] });
    // Each lender she would go to is asked before anything is paid for her: paying a default does not buy a yes.
    expect(stepCodes(a)).toEqual(["COMPLETE_FILE", "CONFIRM_TERMS", "CONFIRM_TERMS", "LIFT_SUSPENSION", "SETTLE_JUDGMENTS", "PAY_DEFAULT", "REFRESH_REPORT", "VERIFY_INCOME", "APPLY", "APPLY"]);
    const asked = a.steps.flatMap((step) => (step.code === "CONFIRM_TERMS" ? [step] : []));
    const applied = a.steps.flatMap((step) => (step.code === "APPLY" ? [step] : []));
    expect(asked.map((step) => [step.lender, step.kinds])).toEqual(applied.map((step) => [step.lender, [step.kind]]));
    for (const step of asked) {
      expect(step.beforePaying).toBe(true);
      // What the lender does with a client who has just paid a default is the first thing to ask.
      expect(step.terms).toContain("settled");
    }
    for (const step of applied) expect(step).toMatchObject({ afterClearing: true, eligibility: "needs_verification", estimated: false });
  });

  it("lists what the record does not give instead of guessing it", async () => {
    const a = await analysed("هند");
    // Only the mortgage has an installment on the record. The card and the installment company's loan have none.
    expect(a.burden).toMatchObject({ monthly: 4300, uncounted: 2, share: 36.4 });
    expect(a.commitments.map((x) => [x.kind, x.monthly])).toEqual([
      ["mortgage", 4300],
      ["card", null],
      ["personal", null],
    ]);
    expect(a.gaps).toContainEqual({ kind: "unconfirmed", code: "CARD_SHARE", lender: "بنك", limit: 15000, balance: 9200 });
    expect(a.gaps).toContainEqual({ kind: "missing", code: "INSTALLMENT", lender: "شركة تقسيط", product: "تمويل شخصي", balance: 27000 });
    // A share measured without every installment is a floor, so it is never called low.
    expect(a.strengths.some((mark) => mark.source === "file" && mark.point.code === "DEBT_SHARE")).toBe(false);
  });

  it("asks about a suspension nobody has confirmed", async () => {
    const a = await analysed("ريم");
    expect(a.gaps).toContainEqual({ kind: "unconfirmed", code: "SUSPENSION" });
    expect(stepCodes(a)[0]).toBe("CONFIRM_SUSPENSION");
    // Her late payments stay on the record after the default is paid, and the banks refuse them.
    const personal = a.kinds.find((k) => k.kind === "personal")!;
    expect(personal.cleared!.fits.filter((fit) => fit.status !== "fail").map((fit) => fit.product.lenderType)).toEqual(["finance_company", "finance_company"]);
  });

  it("flags a report once it is three months old", async () => {
    const view = await read("سالم");
    expect(view.analysis!.gaps.some((gap) => gap.code === "REPORT_AGE")).toBe(false);
    const [year, month, day] = view.record!.report.reportDate!.split("/").map(Number) as [number, number, number];
    // The day before it turns three months old it still stands. On the day itself it is flagged.
    const before = await analysed("سالم", new Date(Date.UTC(year, month + 2, day - 1, 9)));
    expect(before.gaps.some((gap) => gap.code === "REPORT_AGE")).toBe(false);
    const after = await analysed("سالم", new Date(Date.UTC(year, month + 2, day, 9)));
    expect(after.gaps).toContainEqual({ kind: "unconfirmed", code: "REPORT_AGE", months: 3 });
    expect(stepCodes(after)).toContain("REFRESH_REPORT");
  });

  it("takes the income as verified once a person has written the salary a checked paper states", async () => {
    const clientId = people["سالم"]!;
    const certificate = and(eq(documents.clientId, clientId), eq(documents.code, "salary_cert"));
    const keep = async (status: "verified" | "received", stated: Record<string, number> | null) =>
      c.db.insert(documents).values({ clientId, code: "salary_cert", status, stated }).onConflictDoUpdate({ target: [documents.clientId, documents.code], set: { status, stated } });

    // The certificate was checked and the salary written from it is the one on the file.
    await keep("verified", { totalSalary: 15200 });
    const a = await analysed("سالم");
    expect(a.income.basis).toBe("verified");
    expect(a.gaps.some((gap) => gap.code === "INCOME_PROOF")).toBe(false);
    expect(stepCodes(a)).toEqual(["CONFIRM_TERMS", "APPLY", "APPLY"]);

    // A rounding is not a difference: 15,250 against 15,200 is within one part in a hundred.
    await keep("verified", { totalSalary: 15250 });
    expect((await analysed("سالم")).income.basis).toBe("verified");

    // A checked paper nobody wrote a figure from proves no figure.
    await keep("verified", null);
    const unwritten = await analysed("سالم");
    expect(unwritten.income.basis).toBe("stated");
    expect(unwritten.gaps.some((gap) => gap.code === "INCOME_PROOF")).toBe(true);
    expect(stepCodes(unwritten)).toContain("VERIFY_INCOME");

    // A paper that states another salary puts the income in dispute, and settling it comes before anything else.
    await keep("verified", { totalSalary: 13000 });
    const disputed = await analysed("سالم");
    expect(disputed.income.basis).toBe("disputed");
    expect(disputed.gaps[0]).toEqual({ kind: "conflict", code: "CONFLICT", fact: "totalSalary", file: 15200, stated: [{ code: "salary_cert", label: null, value: 13000 }] });
    expect(disputed.gaps.some((gap) => gap.code === "INCOME_PROOF")).toBe(false);
    expect(disputed.steps[0]).toEqual({ code: "SETTLE_CONFLICTS", facts: ["totalSalary"] });
    expect(stepCodes(disputed)).not.toContain("VERIFY_INCOME");
    expect(disputed.verdict).toBe("needs_verification");

    // A paper that came in and nobody has checked yet proves nothing, whatever is kept beside it.
    await keep("received", { totalSalary: 13000 });
    const waiting = await analysed("سالم");
    expect(waiting.income.basis).toBe("stated");
    expect(waiting.gaps.some((gap) => gap.code === "CONFLICT")).toBe(false);
    await c.db.update(documents).set({ stated: null }).where(certificate);
  });

  it("says so when the client's consent is not on the file", async () => {
    expect((await analysed("نورة")).gaps.some((gap) => gap.code === "CONSENT")).toBe(false);
    await setConsent(c.db, { clientId: people["نورة"]!, given: false, actor: SYSTEM, now });
    const withdrawn = await analysed("نورة");
    expect(withdrawn.gaps).toContainEqual({ kind: "missing", code: "CONSENT" });
    // Without it the analysis waits, and recording it is the first thing to do.
    expect(withdrawn.verdict).toBe("pending");
    expect(withdrawn.steps[0]).toEqual({ code: "RECORD_CONSENT" });
    await setConsent(c.db, { clientId: people["نورة"]!, given: true, actor: SYSTEM, now });
    expect((await analysed("نورة")).verdict).toBe("not_eligible");
  });
});
