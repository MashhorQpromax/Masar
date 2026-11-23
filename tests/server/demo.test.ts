import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { draftLabel } from "@/copy/credit";
import { dealTimeline, fundsFlow, pendingDrafts, recordDifferences, reportDrafts, stationTimeline } from "@/domain/deal";
import { approvalsOf } from "@/server/analysis/approval";
import { getAnalysis } from "@/server/analysis/service";
import { getAsked } from "@/server/clients/conditions";
import { getClientCard, listClients } from "@/server/clients/directory";
import { getCredit } from "@/server/credit/service";
import type { Connection } from "@/server/db/client";
import { getDeal } from "@/server/deals/service";
import { roadView } from "@/server/deals/views";
import { DEMO_ANSWERED, DEMO_BANK, DEMO_COMPANY, DEMO_PAPER, DEMO_WORD, seedDemoLenders } from "@/server/demo/lenders";
import { DEMO_APPROVED, DEMO_FALLEN, DEMO_REASON, seedDemoApprovals } from "@/server/demo/approvals";
import { seedDemo } from "@/server/demo/seed";
import { relyOnPaper } from "@/server/documents/facts";
import { getPapers } from "@/server/documents/service";
import { getFunding } from "@/server/funding/service";
import { listCatalogue } from "@/server/lenders/service";
import { SYSTEM } from "@/server/shared/actor";
import { riyadhDay } from "@/server/shared/clock";
import { testDb } from "../helpers/db";

let c: Connection;
const now = new Date("2026-11-22T09:00:00Z");

beforeAll(async () => {
  c = await testDb();
  await seedDemo(c.db, now);
});
afterAll(async () => {
  await c.close();
});

describe("demo data on the road", () => {
  it("puts each deal at its station with the engine's verdict", async () => {
    const view = await roadView(c.db, now);
    const byName = Object.fromEntries(view.deals.map((d) => [d.clientName, d]));
    expect(view.deals).toHaveLength(4);
    expect(byName["فهد"]).toMatchObject({ station: "bank", stage: "approval", verdict: "go", daysToDisbursement: 12, stageDueInDays: 5 });
    expect(byName["سالم"]).toMatchObject({ station: "property", stage: "payoff", verdict: "go", stageDueInDays: 1 });
    expect(byName["نورة"]).toMatchObject({ station: "settle", stage: "settlement", verdict: "tight" });
    expect(byName["ريم"]).toMatchObject({ station: "study", stage: "study", verdict: "short" });
    expect(byName["ريم"]!.clientNet).toBeLessThan(0);
  });

  it("adds up the portfolio", async () => {
    const { portfolio, deals } = await roadView(c.db, now);
    const of = (name: string) => deals.find((d) => d.clientName === name)!;
    // Capital is out for every deal past the agreement: all but the one still under study.
    expect(portfolio.capitalOut).toBe(of("فهد").capital! + of("سالم").capital! + of("نورة").capital!);
    // A deal that does not close earns nothing.
    expect(portfolio.expectedFees).toBe(of("فهد").fee! + of("سالم").fee! + of("نورة").fee!);
    expect(portfolio.returningSoon).toBe(of("فهد").capital! + of("سالم").capital!);
    expect(portfolio.nearest?.dealId).toBe(of("فهد").dealId);
    expect(portfolio.next?.dealId).toBe(of("سالم").dealId);
  });

  it("reads a deal with its history, stations and where the financing goes", async () => {
    const { deals } = await roadView(c.db, now);
    const salem = deals.find((d) => d.clientName === "سالم")!;
    const view = (await getDeal(c.db, { dealId: salem.dealId, now }))!;
    expect(view.history.map((h) => h.stage)).toEqual(["study", "agreement", "settlement", "clearance", "simah_update", "payoff"]);

    const timeline = dealTimeline(view.deal.structure, view.deal.stage, view.stageEnteredAt, now);
    const stations = stationTimeline(view.deal.structure, timeline, view.history);
    expect(stations.steps.map((s) => [s.key, s.state])).toEqual([
      ["study", "done"],
      ["settle", "done"],
      ["credit", "done"],
      ["property", "current"],
      ["bank", "ahead"],
      ["payout", "ahead"],
    ]);
    expect(stations.position).toBe(4);
    expect(stations.steps[0]!.at).toEqual(new Date("2026-10-22T09:00:00Z"));
    expect(stations.steps[4]).toMatchObject({ expected: true, at: new Date("2026-11-26T09:00:00Z") }); // payoff 10 days from the 13th, then transfer 3

    const flow = fundsFlow(view.study);
    expect(flow.deficit).toBe(0);
    expect(flow.parts.reduce((sum, p) => sum + p.amount, 0)).toBe(flow.total);
    expect(flow.parts.find((p) => p.key === "client")!.amount).toBe(view.study.clientNet);
  });

  it("shows the shortfall of a deal that does not close", async () => {
    const { deals } = await roadView(c.db, now);
    const reem = deals.find((d) => d.clientName === "ريم")!;
    const view = (await getDeal(c.db, { dealId: reem.dealId, now }))!;
    const flow = fundsFlow(view.study);
    expect(flow.deficit).toBe(-view.study.clientNet);
    expect(flow.parts.some((p) => p.key === "client")).toBe(false);
    expect(flow.parts.reduce((sum, p) => sum + p.amount, 0)).toBe(flow.total + flow.deficit);
  });
});

describe("demo credit records", () => {
  it("shows each state of the credit page, and tells the same story as the deal", async () => {
    const { deals } = await roadView(c.db, now);
    const of = async (name: string) => {
      const deal = (await getDeal(c.db, { dealId: deals.find((d) => d.clientName === name)!.dealId, now }))!;
      return { credit: (await getCredit(c.db, deal.client.id))!, deal };
    };

    // No report read yet: the page's empty state, and a deal the record adds nothing to.
    const fahad = await of("فهد");
    expect(fahad.credit.record).toBeNull();
    expect(fahad.credit.dealId).toBe(fahad.deal.deal.id);
    expect(fahad.deal.creditFlags).toBeNull();

    // Read again after the debt was cleared: nothing blocks, both doors open on conditions, nothing left to do.
    const salem = (await of("سالم")).credit.record!;
    expect(salem.analysis).toMatchObject({ grade: "B", blockers: [], banks: { access: "conditional" }, financeCompanies: { access: "conditional" }, actions: [{ code: "NONE" }] });
    expect(salem.analysis.stats.totalToClear).toBe(0);

    // A suspension someone confirmed. What must be cleared is what the deal settles.
    const noura = await of("نورة");
    expect(noura.credit.record!.report).toMatchObject({ serviceSuspension: true, suspensionAssumed: false });
    expect(noura.credit.record!.analysis).toMatchObject({ grade: "E", stats: { totalToClear: 153000 } });
    expect(noura.credit.record!.analysis.actions[0]!.code).toBe("LIFT_SUSPENSION");
    expect(noura.deal.creditFlags).toEqual({ bankReopenMonths: null, suspension: true, financeCoDefault: true });
    expect(noura.deal.study.risks.map((r) => r.code)).toEqual(expect.arrayContaining(["FINANCE_CO_DEFAULT_HISTORY", "SUSPENSION_LIFT"]));

    // A suspension nobody checked yet: the page asks about it.
    const reem = (await of("ريم")).credit.record!;
    expect(reem.report.suspensionAssumed).toBe(true);
    expect(reem.confidence).toBe("high");
    expect(reem.warnings).toEqual([{ code: "SUSPENSION_ASSUMED", params: { orders: 1 } }]);
    expect(reem.analysis).toMatchObject({ grade: "E", stats: { totalToClear: 200000 } });
    expect(reem.report.reportDate).toBe(riyadhDay(new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)));
  });

  it("offers each deal what its record shows and it does not hold, and no more", async () => {
    const { deals } = await roadView(c.db, now);
    const lacking = async (name: string) => {
      const deal = (await getDeal(c.db, { dealId: deals.find((d) => d.clientName === name)!.dealId, now }))!;
      const drafts = reportDrafts(deal.credit?.report ?? null).map((draft) => ({ ...draft, label: draftLabel(draft.source) }));
      return pendingDrafts(drafts, deal.input.items).map((draft) => [draft.label, draft.original]);
    };
    // The card on the record of سالم is the one thing his deal does not settle.
    expect(await lacking("سالم")).toEqual([["مخالصة بطاقة — بنك", 6500]]);
    // The others hold everything their records show, and a file with no record is offered nothing.
    expect(await lacking("نورة")).toEqual([]);
    expect(await lacking("ريم")).toEqual([]);
    expect(await lacking("فهد")).toEqual([]);
  });

  it("says which debt a deal holds at another amount than its record, until the creditor confirms the deal's", async () => {
    const { deals } = await roadView(c.db, now);
    const differing = async (name: string, confirmed = false) => {
      const deal = (await getDeal(c.db, { dealId: deals.find((d) => d.clientName === name)!.dealId, now }))!;
      const drafts = reportDrafts(deal.credit?.report ?? null).map((draft) => ({ ...draft, label: draftLabel(draft.source) }));
      const items = deal.input.items.map((item) => (confirmed ? { ...item, confirmed: true } : item));
      return recordDifferences(drafts, items).map((d) => [deal.input.items[d.item]!.label, d.deal, d.record]);
    };
    // The default of نورة grew since her deal was written. Its order is the same on both.
    expect(await differing("نورة")).toEqual([["تعثر تمويل سيارة — شركة تمويل", 46000, 49000]]);
    expect(await differing("نورة", true)).toEqual([]);
    for (const name of ["سالم", "ريم", "فهد"]) expect(await differing(name), name).toEqual([]);
  });

  it("gives a new deal for the client who was turned down what her record shows, with what it lacks", async () => {
    const hind = (await listClients(c.db, { q: "هند" })).rows.find((client) => client.name === "هند")!;
    const card = (await getClientCard(c.db, hind.id))!;
    // Her one deal ended, so a new one can start.
    expect(card.deals.every((deal) => deal.stage === "lost" || deal.stage === "closed")).toBe(true);
    const record = (await getCredit(c.db, hind.id))!.record!;
    const drafts = reportDrafts(record.report);
    // The order and the default it enforces are one debt, and the loan with no installment says so.
    expect(drafts.map((draft) => [draftLabel(draft.source), draft.original, draft.missing])).toEqual([
      ["قرار تنفيذ 61877 — شركة تمويل (2026/03/02)", 188000, []],
      ["مخالصة العقاري — بنك", 455000, []],
      ["مخالصة بطاقة — بنك", 9200, []],
      ["مخالصة الشخصي — شركة تقسيط", 27000, ["monthly"]],
    ]);
    // The mortgage's payoff is an estimate below the balance. Nothing else is discounted.
    expect(drafts[1]!.pay).toBeLessThan(455000);
    expect(drafts.filter((draft) => draft.pay !== draft.original)).toHaveLength(1);
  });

  it("leaves every figure of the deals as it was", async () => {
    // The record adds notes to a deal. It never moves its money.
    const { deals } = await roadView(c.db, now);
    for (const d of deals) {
      const view = (await getDeal(c.db, { dealId: d.dealId, now }))!;
      expect([view.study.capital, view.study.fee, view.study.clientNet, view.study.verdict]).toEqual([d.capital, d.fee, d.clientNet, d.verdict]);
    }
  });
});

// Last in this file: it adds to the catalogue the deals above were read against.
describe("the two example lenders of the demonstration", () => {
  it("adds them once, confirmed by sources that say they are made up", async () => {
    const before = await listCatalogue(c.db, { now });
    await seedDemoLenders(c.db, now);
    await seedDemoLenders(c.db, now);
    const after = await listCatalogue(c.db, { now });
    const added = after.filter((lender) => !before.some((known) => known.id === lender.id));
    expect(added.map((lender) => [lender.name, lender.type, lender.products.map((product) => product.financeType)])).toEqual([
      [DEMO_BANK, "bank", ["personal", "mortgage"]],
      [DEMO_COMPANY, "finance_company", ["personal", "mortgage"]],
    ]);
    const references = added.flatMap((lender) => lender.products).flatMap((product) => Object.values(product.terms!).flatMap((standing) => (standing.state === "unconfirmed" ? [] : [standing.source.reference])));
    expect(new Set(references)).toEqual(new Set([DEMO_PAPER, DEMO_WORD]));
    // One confirmation is shown as having run out, so its product is no longer confirmed as a whole.
    const mortgage = added[0]!.products[1]!;
    expect(mortgage.terms!.rate).toMatchObject({ state: "expired" });
    expect(mortgage.verified).toBe(false);
    expect(added[0]!.products[0]!.verified).toBe(true);
    expect(added[1]!.products[0]!.terms!.salary).toMatchObject({ state: "confirmed", strength: "verbal" });
  });

  it("never shows a real lender's term as confirmed", async () => {
    const real = (await listCatalogue(c.db, { stopped: true, now })).filter((lender) => lender.name !== DEMO_BANK && lender.name !== DEMO_COMPANY);
    expect(real).toHaveLength(10);
    for (const product of real.flatMap((lender) => lender.products)) {
      expect(Object.values(product.terms!).every((standing) => standing.state === "unconfirmed"), `${product.lenderName} ${product.name}`).toBe(true);
    }
  });

  it("shows each kind of special condition on an example product, and invents none for a real lender", async () => {
    const catalogue = await listCatalogue(c.db, { stopped: true, now });
    const example = catalogue.filter((lender) => lender.name === DEMO_BANK || lender.name === DEMO_COMPANY).flatMap((lender) => lender.products);
    expect(example.map((product) => [product.lenderName, product.financeType, (product.special ?? []).map((condition) => condition.kind)])).toEqual([
      [DEMO_BANK, "personal", ["min_amount"]],
      [DEMO_BANK, "mortgage", ["inquiries"]],
      [DEMO_COMPANY, "personal", ["guarantor"]],
      [DEMO_COMPANY, "mortgage", ["contract"]],
    ]);
    // The made-up source speaks for the list as well: a condition written down alone confirms nothing.
    for (const product of example) expect(product.terms!.special, `${product.lenderName} ${product.name}`).toMatchObject({ state: "confirmed", source: { reference: product.lenderName === DEMO_COMPANY && product.financeType === "personal" ? DEMO_WORD : DEMO_PAPER } });
    // Nobody asked a real lender what it wants beyond its terms: its list is empty, and its being empty is not confirmed.
    for (const product of catalogue.filter((lender) => lender.name !== DEMO_BANK && lender.name !== DEMO_COMPANY).flatMap((lender) => lender.products)) {
      expect(product.special ?? [], `${product.lenderName} ${product.name}`).toEqual([]);
      expect(product.terms!.special, `${product.lenderName} ${product.name}`).toMatchObject({ state: "unconfirmed" });
    }
  });

  it("has one invented client's answer about the guarantor on file, and leaves it a question for the others", async () => {
    const people = (await listClients(c.db, {})).rows;
    const askedOf = async (name: string) => (await getAsked(c.db, { clientId: people.find((client) => client.name === name)!.id }))!;
    const noura = await askedOf("نورة");
    expect(noura.client.fileNo).toBe(DEMO_ANSWERED);
    expect(noura.open).toBe(0);
    expect(noura.lenders.map((lender) => [lender.name, lender.products.map((product) => product.conditions.map((condition) => [condition.kind, condition.unmet, condition.answer]))])).toEqual([[DEMO_COMPANY, [[["guarantor", "action", "met"]]]]]);
    // The same question about anyone else: nobody asked, and no answer is assumed.
    for (const name of ["سالم", "ريم", "فهد", "هند"]) {
      const asked = await askedOf(name);
      expect(asked.open, name).toBe(1);
      expect(asked.lenders.flatMap((lender) => lender.products).flatMap((product) => product.conditions).map((condition) => condition.answer), name).toEqual([null]);
    }
  });

  it("lets every result of the strict reading be seen on the invented deals", async () => {
    const { deals } = await roadView(c.db, now);
    const seen = new Map<string, Set<string>>();
    for (const deal of deals) {
      const view = (await getFunding(c.db, { dealId: deal.dealId, now }))!;
      seen.set(deal.clientName, new Set(view.routes.map((route) => route.eligibility)));
      // A route through a real lender alone is never more than a question to ask.
      for (const route of view.routes) {
        const lendersOf = [route.mortgage, route.personal].flatMap((leg) => (leg ? [leg.product.lenderName] : []));
        if (!lendersOf.some((name) => name === DEMO_BANK || name === DEMO_COMPANY)) expect(route.eligibility, `${deal.clientName} ${route.key}`).toBe("needs_verification");
      }
    }
    expect(new Set([...seen.values()].flatMap((results) => [...results]))).toEqual(new Set(["eligible", "conditional", "not_eligible", "needs_verification"]));
    // A personal deal with a clean record: one lender takes her as she is, one wants the salary moved.
    expect(seen.get("نورة")).toEqual(new Set(["eligible", "conditional", "needs_verification"]));
    // She paid late last month: a lender confirmed not to take late payments refuses, and no calculation overrides it.
    expect(seen.get("ريم")).toEqual(new Set(["not_eligible", "needs_verification"]));
    // No credit record was read for him: even confirmed terms cannot answer for a fact that is missing.
    expect([...seen.get("فهد")!]).not.toContain("eligible");
    expect([...seen.get("فهد")!]).not.toContain("conditional");
  });

  it("leaves one invented client to the real lenders, where the plan asks before anything is paid", async () => {
    const people = (await listClients(c.db, {})).rows;
    const analysisOf = async (name: string) => (await getAnalysis(c.db, { clientId: people.find((client) => client.name === name)!.id, now }))!.analysis!;
    // She works in the private sector and neither example lender takes it: that is confirmed, and it settles nothing about the others.
    const hind = await analysisOf("هند");
    expect([hind.verdict, hind.afterClearing]).toEqual(["not_eligible", "needs_verification"]);
    const steps = hind.steps.map((step) => step.code);
    expect(steps).toContain("CONFIRM_TERMS");
    expect(steps.indexOf("CONFIRM_TERMS")).toBeLessThan(steps.indexOf("CREDIT"));
    for (const step of hind.steps) {
      if (step.code === "CONFIRM_TERMS") expect(step).toMatchObject({ beforePaying: true });
      if (step.code === "CONFIRM_TERMS" || step.code === "APPLY") expect([DEMO_BANK, DEMO_COMPANY]).not.toContain(step.lender);
    }
    // Everyone else is answered by an example lender, so the two kinds of plan are both on show.
    const noura = await analysisOf("نورة");
    expect(noura.afterClearing).toBe("eligible");
    expect(noura.steps.map((step) => step.code)).not.toContain("CONFIRM_TERMS");
  });
});

describe("the demonstration's files against their papers", () => {
  it("shows one file its checked papers stand behind, and one a paper speaks against", async () => {
    const { deals } = await roadView(c.db, now);
    const papersOf = async (name: string) => (await getPapers(c.db, { dealId: deals.find((deal) => deal.clientName === name)!.dealId, now }))!;
    expect((await papersOf("فهد")).facts.map((reading) => reading.state)).toEqual(["agrees", "agrees", "agrees"]);
    const salem = await papersOf("سالم");
    expect(salem.facts.filter((reading) => reading.state === "conflict").map((reading) => [reading.fact, reading.file, reading.stated.map((statement) => statement.value), reading.papersAgree])).toEqual([["birthYear", 1989, [1986], true]]);
    // The conflict is one, on one client: every other screen of the demonstration reads as it did.
    for (const name of ["نورة", "ريم"]) expect((await papersOf(name)).facts.some((reading) => reading.state === "conflict"), name).toBe(false);
  });

  it("holds every lender of that client back until the conflict is settled, and shows them once it is", async () => {
    const { deals } = await roadView(c.db, now);
    const dealId = deals.find((deal) => deal.clientName === "سالم")!.dealId;
    const results = async () => new Set((await getFunding(c.db, { dealId, now }))!.routes.map((route) => route.eligibility));
    const before = await results();
    expect([...before].some((result) => result === "eligible" || result === "conditional")).toBe(false);
    expect(before.has("needs_verification")).toBe(true);

    const papers = (await getPapers(c.db, { dealId, now }))!;
    const card = papers.list.papers.find((paper) => paper.code === "id")!;
    await relyOnPaper(c.db, { clientId: papers.client.id, paperId: card.id!, fact: "birthYear", actor: SYSTEM, now });
    // One press, and the example lender that takes him answers: the demonstration shows what settling is for.
    const after = await results();
    expect([...after].some((result) => result === "eligible" || result === "conditional")).toBe(true);
  });
});

describe("the demonstration's approvals", () => {
  it("shows one approval that stands and one that fell when the client's file changed", async () => {
    await seedDemoLenders(c.db, now);
    await seedDemoApprovals(c.db, now);
    const of = async (fileNo: string) => {
      const client = (await listClients(c.db, { q: fileNo })).rows.find((row) => row.fileNo === fileNo)!;
      const view = (await getAnalysis(c.db, { clientId: client.id, now }))!;
      return approvalsOf(c.db, { clientId: client.id, now: view.fingerprint });
    };
    const kept = await of(DEMO_APPROVED);
    expect(kept.map((approval) => [approval.changed, approval.reason])).toEqual([[[], DEMO_REASON]]);
    const fallen = await of(DEMO_FALLEN);
    expect(fallen.map((approval) => approval.changed)).toEqual([["file"]]);
    // Seeding again adds nothing.
    await seedDemoApprovals(c.db, now);
    expect(await of(DEMO_APPROVED)).toHaveLength(1);
  });
});
