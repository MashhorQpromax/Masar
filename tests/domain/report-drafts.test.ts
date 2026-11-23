import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { emptyReport, type CreditReport, type Facility, type Judgment } from "@/domain/credit";
import { itemDrafts, owedFrom, pendingDrafts, recordDifferences, reportDrafts, type DealItem, type ItemDraft } from "@/domain/deal";

/**
 * What a credit record puts in front of a person who builds a deal: the commitments the record shows,
 * what it did not give about each, and which of them the deal does not hold yet.
 */
const report = (parts: Partial<CreditReport>): CreditReport => ({ ...emptyReport(), ...parts });
const loan = (parts: Partial<Facility>): Facility => ({ lender: "بنك", creditorType: "bank", product: "قرض شخصي", status: "current", ...parts });
const order = (parts: Partial<Judgment>): Judgment => ({ kind: "enforcement", active: true, ...parts });
const item = (parts: Partial<DealItem>): Pick<DealItem, "kind" | "label" | "original" | "confirmed"> => ({ kind: "personal_payoff", label: "مخالصة الشخصي — بنك", original: 0, ...parts });

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, "../golden/credit.json"), "utf8")) as { cases: { report: CreditReport }[] };

describe("the running loans and cards a record shows", () => {
  it("takes each product by the name SIMAH gives it, with its installment and what remains", () => {
    const owed = owedFrom(
      report({
        facilities: [
          loan({ product: "تمويل منزلي", lender: "مصرف الراجحي", installment: 4100, balance: 412000 }),
          loan({ product: "تمويل عقاري", installment: 3100, balance: 331000 }),
          loan({ product: "قرض شخصي", installment: 1900, balance: 52000 }),
          loan({ product: "بطاقة ائتمان", limit: 20000, balance: 6500 }),
          loan({ product: "تمويل سيارة", installment: 1700, balance: 61000 }),
          loan({ product: "عقد تأجير", installment: 2200, balance: 90000 }),
        ],
      }),
    );
    expect(owed).toEqual([
      { kind: "mortgage", lender: "مصرف الراجحي", monthly: 4100, remaining: 412000 },
      { kind: "mortgage", lender: "بنك", monthly: 3100, remaining: 331000 },
      { kind: "personal", lender: "بنك", monthly: 1900, remaining: 52000 },
      { kind: "card", lender: "بنك", monthly: 0, remaining: 6500 },
      { kind: "auto", lender: "بنك", monthly: 1700, remaining: 61000 },
      { kind: "auto", lender: "بنك", monthly: 2200, remaining: 90000 },
    ]);
  });

  it("counts a late loan, and leaves out what is closed, settled, defaulted or says nothing", () => {
    const owed = owedFrom(
      report({
        facilities: [
          loan({ status: "late", installment: 2300, balance: 66000, overdue: 4600 }),
          loan({ status: "closed", installment: 2000, balance: 0 }),
          loan({ status: "settled", defaultAmount: 9000, installment: 500 }),
          loan({ status: "default", defaultAmount: 40000, installment: 1500, balance: 40000 }),
          // A card nobody uses: no installment and no balance.
          loan({ product: "بطاقة ائتمان", limit: 15000, balance: 0 }),
          loan({ product: "بطاقة ائتمان", limit: 15000 }),
        ],
      }),
    );
    expect(owed).toEqual([{ kind: "personal", lender: "بنك", monthly: 2300, remaining: 66000 }]);
  });

  it("keeps what the record gave and guesses nothing: an installment without a balance stays without one", () => {
    expect(owedFrom(report({ facilities: [loan({ installment: 1500 })] }))).toEqual([{ kind: "personal", lender: "بنك", monthly: 1500, remaining: null }]);
    expect(owedFrom(report({ facilities: [loan({ balance: 30000 })] }))).toEqual([{ kind: "personal", lender: "بنك", monthly: 0, remaining: 30000 }]);
  });

  it("does not take a phone line as a commitment, whatever it is called", () => {
    const owed = owedFrom(
      report({
        facilities: [
          loan({ lender: "شركة اتصالات", creditorType: "telecom", product: "الهاتف الجوال", installment: 300, balance: 900 }),
          loan({ lender: "شركة اتصالات", creditorType: "telecom", product: "قرض شخصي", installment: 300, balance: 900 }),
        ],
      }),
    );
    expect(owed).toEqual([]);
    expect(owedFrom(null)).toEqual([]);
  });
});

describe("what a record says a deal has to deal with", () => {
  const record = report({
    facilities: [
      loan({ lender: "شركة تمويل", creditorType: "finance_company", status: "default", defaultAmount: 142000, defaultNow: 142000 }),
      loan({ product: "بطاقة ائتمان", status: "default", defaultAmount: 58000, defaultNow: 58000 }),
      loan({ product: "تمويل منزلي", installment: 4100, balance: 412000 }),
      loan({ status: "late", installment: 2300, balance: 66000 }),
      loan({ product: "بطاقة ائتمان", limit: 20000, balance: 6500 }),
      loan({ lender: "شركة تقسيط", creditorType: "other", product: "تمويل منتجات/اشتر الآن", installment: 450, balance: 1800 }),
      loan({ lender: "شركة اتصالات", creditorType: "telecom", product: "الهاتف الجوال" }),
    ],
    judgments: [order({ amount: 142000, remaining: 142000, decisionNo: "90412" })],
  });

  it("lists orders, unpaid defaults, running loans and cards, then any other running finance", () => {
    const drafts = reportDrafts(record);
    expect(drafts.map((d) => [d.kind, d.source.from, d.original, d.by, d.monthly ?? null])).toEqual([
      ["execution", "judgment", 142000, "company", null],
      ["default", "default", 58000, "company", null],
      ["mortgage_payoff", "obligation", 412000, "company", 4100],
      ["personal_payoff", "obligation", 66000, "bank", 2300],
      ["card", "obligation", 6500, "bank", null],
      ["other", "product", 1800, "out", 450],
    ]);
    // A complete record leaves nothing for a person to fill in.
    expect(drafts.flatMap((d) => d.missing)).toEqual([]);
    // Another running finance starts outside the deal, so its installment counts against the new one.
    expect(drafts.at(-1)).toMatchObject({ source: { from: "product", lender: "شركة تقسيط", product: "تمويل منتجات/اشتر الآن" }, pay: 1800 });
  });

  it("starts with exactly what the old system drafted from the same loans", () => {
    const drafts = reportDrafts(record).filter((d) => d.source.from !== "product");
    const old = itemDrafts(record, owedFrom(record));
    expect(drafts.map(({ missing: _missing, ...draft }) => draft)).toEqual(old);
  });

  it("says what the record did not give, and never fills it in", () => {
    const drafts = reportDrafts(
      report({
        facilities: [
          loan({ installment: 1500 }),
          loan({ product: "تمويل منزلي", balance: 300000 }),
          loan({ product: "بطاقة ائتمان", balance: 4000 }),
          loan({ lender: "شركة تقسيط", creditorType: "other", product: "منتج", installment: 200 }),
        ],
        judgments: [order({ decisionNo: "5511" })],
      }),
    );
    expect(drafts.map((d) => [d.kind, d.original, d.pay, d.monthly ?? null, d.missing])).toEqual([
      ["execution", 0, 0, null, ["amount"]],
      ["personal_payoff", 0, 0, 1500, ["amount"]],
      ["mortgage_payoff", 300000, 300000, null, ["monthly"]],
      // A card has no installment to miss.
      ["card", 4000, 4000, null, []],
      ["other", 0, 0, 200, ["amount"]],
    ]);
  });

  it("drafts nothing for a record with nothing running and nothing owed", () => {
    expect(reportDrafts(null)).toEqual([]);
    expect(reportDrafts(emptyReport())).toEqual([]);
    expect(reportDrafts(report({ facilities: [loan({ status: "closed" }), loan({ lender: "جهة", creditorType: "other", product: "منتج", balance: 500 })] }))).toEqual([]);
  });

  it("holds for every record of the golden file: no amount is negative, and a payoff is never above what remains", () => {
    let seen = 0;
    for (const c of golden.cases) {
      for (const draft of reportDrafts(c.report)) {
        seen++;
        expect(draft.original).toBeGreaterThanOrEqual(0);
        expect(draft.pay).toBeGreaterThanOrEqual(0);
        // The estimate is in whole riyals, and a balance may carry halalas.
        expect(draft.pay).toBeLessThanOrEqual(Math.ceil(draft.original));
        expect(draft.missing.includes("amount")).toBe(draft.original === 0);
        if (draft.kind === "other") expect(draft.by).toBe("out");
      }
    }
    expect(seen).toBeGreaterThan(400);
  });
});

describe("what a deal does not hold yet", () => {
  const drafts: ItemDraft[] = [
    { kind: "execution", source: { from: "judgment", kind: "enforcement", decisionNo: "90412", creditor: null, date: null }, original: 142000, pay: 142000, by: "company" },
    { kind: "personal_payoff", source: { from: "obligation", kind: "personal", lender: "مصرف الراجحي" }, original: 100000, pay: 93000, by: "bank", monthly: 3000 },
    { kind: "personal_payoff", source: { from: "obligation", kind: "personal", lender: "مصرف الراجحي" }, original: 50000, pay: 47000, by: "bank", monthly: 1500 },
    { kind: "card", source: { from: "obligation", kind: "card", lender: "بنك" }, original: 6500, pay: 6500, by: "bank" },
  ];

  it("is everything, for a deal with no items", () => {
    expect(pendingDrafts(drafts, [])).toEqual(drafts);
    expect(pendingDrafts([], [item({ original: 5000 })])).toEqual([]);
  });

  it("is nothing once every draft was added as it came", () => {
    const items = drafts.map((d) => item({ kind: d.kind, label: "أي وصف", original: d.original }));
    expect(pendingDrafts(drafts, items)).toEqual([]);
  });

  it("knows an item by about its amount, within the tolerance two readings of one debt are given", () => {
    // 1,500 riyals or two percent, whichever is more.
    expect(pendingDrafts([drafts[0]!], [item({ kind: "execution", label: "قرار", original: 144800 })])).toEqual([]);
    expect(pendingDrafts([drafts[0]!], [item({ kind: "execution", label: "قرار", original: 145000 })])).toEqual([drafts[0]]);
    expect(pendingDrafts([drafts[3]!], [item({ kind: "card", label: "بطاقة", original: 8000 })])).toEqual([]);
    expect(pendingDrafts([drafts[3]!], [item({ kind: "card", label: "بطاقة", original: 8100 })])).toEqual([drafts[3]]);
  });

  it("knows an item whose amount was corrected by the lender or the decision number it names", () => {
    expect(pendingDrafts([drafts[0]!], [item({ kind: "execution", label: "قرار تنفيذ 90412 — شركة تمويل", original: 120000 })])).toEqual([]);
    expect(pendingDrafts([drafts[1]!], [item({ label: "مخالصة الشخصي — مصرف الراجحي", original: 81000 })])).toEqual([]);
    // Another lender's loan of another amount is another loan.
    expect(pendingDrafts([drafts[1]!], [item({ label: "مخالصة الشخصي — بنك الرياض", original: 81000 })])).toEqual([drafts[1]]);
  });

  it("never takes an item of another kind for a draft", () => {
    expect(pendingDrafts([drafts[3]!], [item({ kind: "personal_payoff", label: "مخالصة — بنك", original: 6500 })])).toEqual([drafts[3]]);
  });

  it("matches amounts before names, so the loan that is missing is the one suggested", () => {
    // Two loans from one bank, and the deal holds the smaller one.
    const held = [item({ label: "مخالصة الشخصي — مصرف الراجحي", original: 50000 })];
    expect(pendingDrafts(drafts.slice(1, 3), held)).toEqual([drafts[1]]);
  });

  it("lets one item answer for one draft only", () => {
    const twins: ItemDraft[] = [drafts[3]!, { ...drafts[3]! }];
    expect(pendingDrafts(twins, [item({ kind: "card", label: "بطاقة — بنك", original: 6500 })])).toHaveLength(1);
    expect(pendingDrafts(twins, [item({ kind: "card", label: "بطاقة — بنك", original: 6500 }), item({ kind: "card", label: "بطاقة — بنك", original: 6500 })])).toEqual([]);
  });

  it("leaves a draft with no amount and no name to go by as still to be placed", () => {
    const bare: ItemDraft = { kind: "execution", source: { from: "judgment", kind: "bounced_cheque", decisionNo: null, creditor: null, date: null }, original: 0, pay: 0, by: "company" };
    expect(pendingDrafts([bare], [item({ kind: "execution", label: "شيك مرتجع — دائن غير محدد", original: 9000 })])).toEqual([bare]);
  });

  it("knows such a draft by the label it is added under, before and after its amount is written", () => {
    const bare = { kind: "execution", source: { from: "judgment", kind: "bounced_cheque", decisionNo: null, creditor: null, date: null }, original: 0, pay: 0, by: "company", label: "شيك مرتجع — دائن غير محدد" } satisfies ItemDraft & { label: string };
    expect(pendingDrafts([bare], [item({ kind: "execution", label: bare.label, original: 0 })])).toEqual([]);
    expect(pendingDrafts([bare], [item({ kind: "execution", label: bare.label, original: 9000 })])).toEqual([]);
    // Two such cheques and one item: one of them is still to be placed.
    expect(pendingDrafts([bare, { ...bare }], [item({ kind: "execution", label: bare.label, original: 9000 })])).toHaveLength(1);
    // A label is the last thing looked at: an item another draft is surer of is not taken by it.
    const order = { kind: "execution", source: { from: "judgment", kind: "enforcement", decisionNo: null, creditor: null, date: null }, original: 9000, pay: 9000, by: "company", label: "قرار تنفيذ" } satisfies ItemDraft & { label: string };
    expect(pendingDrafts([bare, order], [item({ kind: "execution", label: bare.label, original: 9000 })])).toEqual([bare]);
    expect(pendingDrafts([bare], [item({ kind: "card", label: bare.label, original: 0 })])).toEqual([bare]);
  });
});

describe("what the deal and the record say differently", () => {
  const order: ItemDraft = { kind: "execution", source: { from: "judgment", kind: "enforcement", decisionNo: "90412", creditor: "شركة تمويل", date: null }, original: 142000, pay: 142000, by: "company" };
  const unpaid: ItemDraft = { kind: "default", source: { from: "default", lender: "بنك الجزيرة", product: "بطاقة ائتمان" }, original: 58000, pay: 58000, by: "company" };
  const running: ItemDraft = { kind: "personal_payoff", source: { from: "obligation", kind: "personal", lender: "مصرف الراجحي" }, original: 100000, pay: 93000, by: "bank", monthly: 3000 };
  const drafts = [order, unpaid, running];

  it("names a court order or a default the deal holds at another amount, with both figures", () => {
    const items = [
      item({ kind: "personal_payoff", label: "مخالصة الشخصي — مصرف الراجحي", original: 100000 }),
      item({ kind: "default", label: "تعثر — بنك الجزيرة", original: 40000 }),
      item({ kind: "execution", label: "قرار تنفيذ 90412", original: 90000 }),
    ];
    expect(recordDifferences(drafts, items)).toEqual([
      { draft: unpaid, item: 1, record: 58000, deal: 40000 },
      { draft: order, item: 2, record: 142000, deal: 90000 },
    ]);
    // Placed all the same: the debt is in the deal, at the wrong amount, and is not suggested again.
    expect(pendingDrafts(drafts, items)).toEqual([]);
  });

  it("takes a rounding for agreement, the same tolerance two readings of one debt are given", () => {
    expect(recordDifferences([order], [item({ kind: "execution", label: "قرار تنفيذ 90412", original: 144800 })])).toEqual([]);
    expect(recordDifferences([order], [item({ kind: "execution", label: "قرار تنفيذ 90412", original: 142000 })])).toEqual([]);
    expect(recordDifferences([order], [item({ kind: "execution", label: "قرار تنفيذ 90412", original: 145000 })])).toHaveLength(1);
  });

  it("says nothing of a debt more than the record shows when a letter from the creditor confirmed it", () => {
    expect(recordDifferences([unpaid], [item({ kind: "default", label: "تعثر — بنك الجزيرة", original: 61000, confirmed: true })])).toEqual([]);
  });

  it("leaves a running loan to the lender's letter: its balance on the record is older than the deal", () => {
    expect(recordDifferences([running], [item({ label: "مخالصة الشخصي — مصرف الراجحي", original: 81000 })])).toEqual([]);
  });

  it("says nothing of an item it cannot tie to the debt by name, nor of an amount nobody gave", () => {
    // Another creditor's order of another amount is another debt: it is still to be placed, not a difference.
    expect(recordDifferences([order], [item({ kind: "execution", label: "قرار تنفيذ 77001", original: 90000 })])).toEqual([]);
    expect(recordDifferences([order], [item({ kind: "execution", label: "قرار تنفيذ 90412", original: 0 })])).toEqual([]);
    const bare: ItemDraft = { kind: "execution", source: { from: "judgment", kind: "bounced_cheque", decisionNo: null, creditor: "شركة تمويل", date: null }, original: 0, pay: 0, by: "company" };
    expect(recordDifferences([bare], [item({ kind: "execution", label: "شيك — شركة تمويل", original: 9000 })])).toEqual([]);
    expect(recordDifferences(drafts, [])).toEqual([]);
  });

  it("ties each item to one debt: of two orders of one creditor, the one held at its amount is not the one that differs", () => {
    const first: ItemDraft = { kind: "execution", source: { from: "judgment", kind: "enforcement", decisionNo: null, creditor: "شركة تمويل", date: null }, original: 30000, pay: 30000, by: "company" };
    const second: ItemDraft = { ...first, original: 60000, pay: 60000 };
    const items = [item({ kind: "execution", label: "قرار تنفيذ — شركة تمويل", original: 60000 }), item({ kind: "execution", label: "قرار تنفيذ — شركة تمويل", original: 45000 })];
    expect(recordDifferences([first, second], items)).toEqual([{ draft: first, item: 1, record: 30000, deal: 45000 }]);
  });
});
