import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dealStudy, defaultDealInput, feePlan, STAGES, type Borrower, type DealInput } from "@/domain/deal";
import { clientOffer, messageGate, offerTotal, type ClientOffer } from "@/domain/messages";

const golden = JSON.parse(readFileSync(new URL("../golden/deal.json", import.meta.url), "utf8"));
const cases: { input: DealInput; borrower: never; credit: never }[] = golden.cases;

const borrower: Borrower = { age: 40, basicSalary: 14000, totalSalary: 19000, serviceMonths: 180, sector: "gov" };
const input: DealInput = {
  ...defaultDealInput(),
  items: [
    { id: "a", kind: "execution", label: "قرار تنفيذ 4471 — شركة تمويل (2024/03/11)", original: 90000, pay: 80000, by: "company", confirmed: true },
    { id: "b", kind: "default", label: "تعثر — بنك", original: 20000, pay: 20000, by: "company", confirmed: true },
    { id: "c", kind: "mortgage_payoff", label: "مخالصة العقاري — بنك الأول", original: 400000, pay: 390000, by: "company", confirmed: true },
  ],
  propertyValue: 1_000_000,
  targetBank: "بنك الراتب",
  bankMortgage: 850000,
  bankPersonal: 200000,
  fee: { settlePct: 10, settleIncludesPayoff: false, financePct: 12, financeBase: "total", fixed: 5000 },
};
const offerOf = (x: DealInput, b: Borrower = borrower): ClientOffer | null => {
  const study = dealStudy(x, b);
  return clientOffer({ input: x, study }, feePlan(x, study));
};

describe("the client's final offer", () => {
  it("reads as a sum the client can check: the financing, less what is paid for them, the costs and the fee, is what they keep", () => {
    const study = dealStudy(input, borrower);
    const offer = offerOf(input)!;
    expect(offer.financing).toEqual([
      { part: "mortgage", amount: 850000, certainty: "confirmed" },
      { part: "personal", amount: 200000, certainty: "confirmed" },
    ]);
    expect(offer.totalFinancing).toBe(1_050_000);
    expect(offer.obligations).toEqual({ amount: 490000, certainty: "confirmed" });
    expect(offer.costs).toEqual(study.summary.costs);
    expect(offer.keeps).toBe(study.clientNet);
    expect(offerTotal(offer)).toBe(offer.keeps);
    // The monthly side: the deduction from the salary after the new financing, as the study counts it.
    expect(offer.deduction).toBe(study.financing.dbrAfter);
    expect(offer.deduction).toBeGreaterThan(0);
  });

  it("gives the fee item by item: the percent, what it is counted on, and what it comes to", () => {
    const offer = offerOf(input)!;
    expect(offer.fee.items).toEqual([
      { kind: "settle", pct: 10, base: 100000, includesPayoff: false, amount: 10000 },
      { kind: "finance", pct: 12, base: 1_050_000, on: "total", amount: 126000 },
      { kind: "fixed", amount: 5000 },
    ]);
    expect(offer.fee.total).toBe(141000);
    // The settlement percent counts the payoff too when the fee says so, and the offer says it.
    const withPayoff = offerOf({ ...input, fee: { ...input.fee, settleIncludesPayoff: true } })!;
    expect(withPayoff.fee.items[0]).toEqual({ kind: "settle", pct: 10, base: 490000, includesPayoff: true, amount: 49000 });
    // A percent counted on the net says the net it is counted on.
    const onNet = offerOf({ ...input, fee: { ...input.fee, financeBase: "net" } })!;
    const net = dealStudy({ ...input, fee: { ...input.fee, financeBase: "net" } }, borrower).summary.afterSettle;
    expect(onNet.fee.items[1]).toMatchObject({ kind: "finance", on: "net", base: net });
  });

  it("leaves out an item that comes to nothing", () => {
    const offer = offerOf({ ...input, fee: { settlePct: 0, settleIncludesPayoff: false, financePct: 10, financeBase: "personal", fixed: 0 } })!;
    expect(offer.fee.items).toEqual([{ kind: "finance", pct: 10, base: 200000, on: "personal", amount: 20000 }]);
    const free = offerOf({ ...input, fee: { settlePct: 0, settleIncludesPayoff: false, financePct: 0, financeBase: "total", fixed: 0 } })!;
    expect(free.fee).toEqual({ items: [], total: 0, certainty: "confirmed", terms: null });
    expect(offerTotal(free)).toBe(free.keeps);
  });

  it("says when the fee falls due and how it is collected, as the approved copy kept them and no other way", () => {
    const study = dealStudy(input, borrower);
    const plan = feePlan(input, study);
    // The plan as it is counted carries no terms: they are the office's policy on the day of the approval.
    expect(clientOffer({ input, study }, plan)!.fee.terms).toBeNull();
    expect(clientOffer({ input, study }, { ...plan, terms: { due: "disbursement", collection: "deducted" } })!.fee.terms).toEqual({ due: "disbursement", collection: "deducted" });
    expect(clientOffer({ input, study }, { ...plan, terms: { due: "agreement", collection: "transfer" } })!.fee.terms).toEqual({ due: "agreement", collection: "transfer" });
    // Terms that cannot be read, or that cannot hold, are not told to a client. The offer itself still stands.
    for (const terms of [{ due: "someday", collection: "deducted" }, { due: "approval", collection: "deducted" }, { due: "disbursement" }, "soon"]) {
      const offer = clientOffer({ input, study }, { ...plan, terms: terms as never })!;
      expect(offer.fee.terms, JSON.stringify(terms)).toBeNull();
      expect(offer.fee.total).toBe(141000);
    }
  });

  it("marks what is counted and not written: a financing with no offer makes the fee on it, and the sum, an estimate", () => {
    const counted = offerOf({ ...input, bankPersonal: null })!;
    expect(counted.financing.map((part) => part.certainty)).toEqual(["confirmed", "estimated"]);
    expect(counted.fee.certainty).toBe("estimated");
    expect(counted.certainty).toBe("estimated");
    // The costs are counted from the expected valuation, so a sum with costs is never fully written.
    expect(offerOf(input)!.certainty).toBe(offerOf(input)!.costs.length ? "estimated" : "confirmed");
  });

  it("carries nothing of what the office puts in or earns on it", () => {
    const study = dealStudy(input, borrower);
    const text = JSON.stringify(offerOf(input));
    for (const word of ["capital", "roi", "annualized", "cover", "surplus", "ledger", "risk", "suggested", "companyFromSale"]) expect(text, word).not.toContain(word);
    for (const secret of [study.roi, study.annualized, study.cover]) if (secret != null && !Number.isInteger(secret)) expect(text, String(secret)).not.toContain(String(secret));
  });

  it("is not made for a deal that does not close", () => {
    const short: DealInput = { ...input, bankMortgage: 300000, bankPersonal: 50000 };
    const study = dealStudy(short, borrower);
    expect(study.verdict).toBe("short");
    expect(clientOffer({ input: short, study }, feePlan(short, study))).toBeNull();
    const open: DealInput = { ...input, propertyValue: null, bankMortgage: null };
    expect(dealStudy(open, borrower).verdict).toBe("needs_info");
    expect(offerOf(open)).toBeNull();
  });

  it("is not made from a copy of another plan: the fee and the net must be the ones the deal has now", () => {
    const study = dealStudy(input, borrower);
    const plan = feePlan(input, study);
    expect(clientOffer({ input, study }, plan)).not.toBeNull();
    // The fee moved since the copy.
    const moved: DealInput = { ...input, fee: { ...input.fee, financePct: 15 } };
    expect(clientOffer({ input: moved, study: dealStudy(moved, borrower) }, plan)).toBeNull();
    // The same total by other parts is still another fee.
    expect(clientOffer({ input, study }, { ...plan, fee: { ...plan.fee, settlePct: 11 } })).toBeNull();
    // A number behind the net moved.
    const cheaper: DealInput = { ...input, items: input.items.map((item) => (item.id === "a" ? { ...item, pay: 70000 } : item)) };
    expect(clientOffer({ input: cheaper, study: dealStudy(cheaper, borrower) }, plan)).toBeNull();
    // A copy whose parts do not add up to its total is not shown.
    expect(clientOffer({ input, study }, { ...plan, amounts: { ...plan.amounts, settle: plan.amounts.settle + 1 } })).toBeNull();
  });

  it("adds up to the riyal on every deal of the golden file that closes, and every percent gives its amount", () => {
    let made = 0;
    for (const c of cases) {
      const study = dealStudy(c.input, c.borrower, c.credit);
      const offer = clientOffer({ input: c.input, study }, feePlan(c.input, study));
      if (study.verdict !== "go" && study.verdict !== "tight") {
        expect(offer).toBeNull();
        continue;
      }
      expect(offer, JSON.stringify(c.input.fee)).not.toBeNull();
      made += 1;
      expect(offerTotal(offer!)).toBe(study.clientNet);
      expect(offer!.keeps).toBe(study.clientNet);
      expect(offer!.deduction).toBe(study.financing.dbrAfter);
      expect(offer!.fee.total).toBe(study.fee);
      expect(offer!.fee.items.reduce((total, item) => total + item.amount, 0)).toBe(study.fee);
      for (const item of offer!.fee.items) {
        expect(item.amount).toBeGreaterThan(0);
        if (item.kind !== "fixed") expect(Math.round((item.base * item.pct) / 100)).toBe(item.amount);
      }
      expect(offer!.costs.every((cost) => cost.amount > 0)).toBe(true);
    }
    expect(made).toBeGreaterThan(60);
  });
});

describe("when the final offer may be written", () => {
  it("opens only for a deal that closes and whose fee plan stands approved", () => {
    for (const verdict of ["go", "tight"] as const) {
      expect(messageGate({ stage: "agreement", verdict, approved: true }).allowed).toEqual(["study", "offer", "papers", "progress", "reply", "internal"]);
      expect(messageGate({ stage: "agreement", verdict, approved: false }).allowed).not.toContain("offer");
      expect(messageGate({ stage: "agreement", verdict }).allowed).not.toContain("offer");
    }
  });

  it("stays shut for a deal the office does not write about, approved or not", () => {
    for (const [stage] of STAGES) {
      for (const verdict of ["short", "needs_info"] as const) expect(messageGate({ stage, verdict, approved: true }).allowed).not.toContain("offer");
    }
    expect(messageGate({ stage: "lost", verdict: "go", approved: true }).allowed).toEqual(["internal"]);
  });
});
