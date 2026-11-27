import { describe, expect, it } from "vitest";
import { analyzeCredit, emptyReport, type CreditReport, type Facility, type Judgment } from "@/domain/credit";
import { itemDrafts } from "@/domain/deal";

/** Worked examples of the credit rules, small enough to check by hand. */
const report = (parts: Partial<CreditReport>): CreditReport => ({ ...emptyReport(), ...parts });
const loan = (parts: Partial<Facility>): Facility => ({ lender: "بنك", creditorType: "bank", product: "قرض شخصي", status: "current", ...parts });
const order = (parts: Partial<Judgment>): Judgment => ({ kind: "enforcement", active: true, ...parts });

describe("credit grading by example", () => {
  it("gives a record with nothing on it the best grade and both doors open", () => {
    const a = analyzeCredit(emptyReport());
    expect(a).toMatchObject({ grade: "A", severity: 0, standing: "clean", banks: { access: "open" }, financeCompanies: { access: "open" } });
    expect(a.blockers).toEqual([]);
    expect(a.findings.map((f) => f.code)).toEqual(["CLEAN"]);
    expect(a.actions.map((x) => x.code)).toEqual(["NONE"]);
  });

  it("counts a default and the enforcement order raised for it as one debt", () => {
    // 128,000 defaulted at a finance company, and the company took it to court for the same amount.
    const a = analyzeCredit(
      report({
        facilities: [loan({ lender: "شركة تمويل", creditorType: "finance_company", status: "default", defaultAmount: 128000, defaultNow: 128000 })],
        judgments: [order({ amount: 128400, remaining: 128400 })],
      }),
    );
    expect(a.grade).toBe("E");
    expect(a.stats.totalToClear).toBe(128400);
    expect(a.blockers).toEqual([
      { code: "JUDGMENT", params: { kind: "enforcement", creditor: "شركة تمويل", creditorGuessed: true, amount: 128400, date: null, state: null } },
      { code: "ACTIVE_DEFAULT", params: { lender: "شركة تمويل", creditorType: "finance_company", remaining: 128000, listedAt: null, state: null, enforced: true } },
    ]);
    // The plan asks for the order to be settled, and does not ask for the default to be paid a second time.
    expect(a.actions.map((x) => x.code)).toEqual(["SETTLE_JUDGMENTS", "REFRESH_REPORT"]);
  });

  it("keeps a default and an order apart when their amounts differ by more than the tolerance", () => {
    const a = analyzeCredit(
      report({
        facilities: [loan({ status: "default", defaultAmount: 40000 })],
        judgments: [order({ amount: 41501 })],
      }),
    );
    expect(a.stats.totalToClear).toBe(81501);
    expect(a.actions.map((x) => x.code)).toEqual(["SETTLE_JUDGMENTS", "PAY_DEFAULT", "REFRESH_REPORT"]);
  });

  it("weighs a finance company default more than a bank default", () => {
    const at = (creditorType: Facility["creditorType"]) => analyzeCredit(report({ facilities: [loan({ creditorType, status: "default", defaultAmount: 20000 })] })).severity;
    expect(at("bank")).toBe(30);
    expect(at("finance_company")).toBe(45);
    expect(at("telecom")).toBe(15);
  });

  it("weighs a small unpaid bill far less, and still closes the doors until it is paid", () => {
    const a = analyzeCredit(report({ facilities: [loan({ lender: "اتصالات", creditorType: "telecom", product: "الهاتف الجوال", status: "default", defaultAmount: 420 })] }));
    expect(a.severity).toBe(6);
    expect(a.grade).toBe("E");
    expect(a.banks).toEqual({ access: "closed", reason: "BLOCKER", reopenInMonths: null });
    expect(a.findings).toContainEqual({ code: "TELECOM_DEFAULTS", level: "info", params: { count: 1 } });
  });

  it("asks for a phone bill to be paid only while one is unpaid", () => {
    const bill = (parts: Partial<Facility>) => loan({ lender: "اتصالات", creditorType: "telecom", product: "الهاتف الجوال", defaultAmount: 420, ...parts });
    const paid = analyzeCredit(report({ facilities: [bill({ status: "settled", settledMonthsAgo: 2 })] }));
    // The paid bill is told as paid, and nobody is asked to pay it again.
    expect(paid.findings.map((f) => f.code)).toContain("SETTLED_DEFAULT");
    expect(paid.findings.map((f) => f.code)).not.toContain("TELECOM_DEFAULTS");
    expect(paid.stats.telecomDefaults).toBe(1);

    const one = analyzeCredit(report({ facilities: [bill({ status: "settled", settledMonthsAgo: 2 }), bill({ lender: "شركة أخرى", status: "default" })] }));
    expect(one.findings).toContainEqual({ code: "TELECOM_DEFAULTS", level: "info", params: { count: 1 } });
    expect(one.stats.telecomDefaults).toBe(2);
  });

  it("keeps banks closed for 24 months after a finance company default is settled, and finance companies for 6", () => {
    const settledAgo = (months: number) =>
      analyzeCredit(report({ facilities: [loan({ creditorType: "finance_company", status: "settled", defaultAmount: 50000, settledMonthsAgo: months })] }));
    expect(settledAgo(2)).toMatchObject({
      banks: { access: "closed", reason: "RECENT_SETTLEMENT_FINANCE_CO", reopenInMonths: 22 },
      financeCompanies: { access: "closed", reason: "VERY_RECENT_SETTLEMENT", reopenInMonths: 4 },
      standing: "late",
    });
    expect(settledAgo(10)).toMatchObject({
      banks: { access: "closed", reopenInMonths: 14 },
      financeCompanies: { access: "conditional", reason: "WITH_SETTLEMENT_LETTER", reopenInMonths: null },
    });
    expect(settledAgo(24)).toMatchObject({ banks: { access: "conditional", reason: "SETTLED_HISTORY" }, standing: "clean" });
  });

  it("keeps banks closed for 12 months after a bank default is settled", () => {
    const a = analyzeCredit(report({ facilities: [loan({ status: "settled", defaultAmount: 30000, settledMonthsAgo: 5 })] }));
    expect(a.banks).toEqual({ access: "closed", reason: "RECENT_SETTLEMENT_BANK", reopenInMonths: 7 });
    expect(a.actions).toContainEqual({ code: "RESTUDY_BANKS", params: { months: 7 } });
  });

  it("lets a settled default fade with age", () => {
    const severity = (months: number) => analyzeCredit(report({ facilities: [loan({ status: "settled", defaultAmount: 30000, settledMonthsAgo: months })] })).severity;
    expect([0, 12, 24, 36].map(severity)).toEqual([14, 8, 6, 3]);
  });

  it("closes every door on a service suspension, whatever else the record shows", () => {
    const a = analyzeCredit(report({ serviceSuspension: true, suspensionAssumed: true }));
    expect(a).toMatchObject({ grade: "E", severity: 100, standing: "default" });
    expect(a.blockers).toEqual([{ code: "SUSPENSION", params: { assumed: true } }]);
    expect(a.actions[0]).toEqual({ code: "LIFT_SUSPENSION", params: {} });
  });

  it("reads card use from cards that are open and have a limit", () => {
    const a = analyzeCredit(
      report({
        facilities: [
          loan({ product: "بطاقة ائتمان", limit: 20000, balance: 17000 }),
          loan({ product: "بطاقة ائتمان", limit: 10000, balance: 9000, status: "closed" }),
          loan({ product: "قرض شخصي", limit: 100000, balance: 60000, installment: 2100 }),
        ],
      }),
    );
    expect(a.stats.cardUtilization).toBe(85);
    expect(a.findings).toContainEqual({ code: "CARD_UTILIZATION", level: "warn", params: { percent: 85, balance: 17000, limit: 20000 } });
    expect(a.actions.map((x) => x.code)).toEqual(["LOWER_CARDS"]);
    expect(a.stats.monthlyInstallments).toBe(2100);
  });
});

describe("deal items suggested from a record, by example", () => {
  it("lists an order once when it is the same debt as a default, and names the lender as its creditor", () => {
    const drafts = itemDrafts(
      report({
        facilities: [loan({ lender: "شركة تمويل", creditorType: "finance_company", status: "default", defaultAmount: 128000 })],
        judgments: [order({ amount: 128400, decisionNo: "4410077123" })],
      }),
      [],
    );
    expect(drafts).toEqual([
      { kind: "execution", source: { from: "judgment", kind: "enforcement", decisionNo: "4410077123", creditor: "شركة تمويل", date: null }, original: 128400, pay: 128400, by: "company" },
    ]);
  });

  it("treats a bounced cheque as its own debt and still lists the default beside it", () => {
    const drafts = itemDrafts(
      report({
        facilities: [loan({ lender: "اتصالات", creditorType: "telecom", product: "الهاتف الجوال", status: "default", defaultAmount: 5200 })],
        judgments: [{ kind: "bounced_cheque", active: true, amount: 5000 }],
      }),
      [],
    );
    expect(drafts.map((d) => [d.kind, d.source.from, d.original])).toEqual([
      ["execution", "judgment", 5000],
      ["default", "default", 5200],
    ]);
    expect(drafts[0]!.source).toMatchObject({ kind: "bounced_cheque", creditor: null });
  });

  it("leaves closed orders and settled defaults out", () => {
    const drafts = itemDrafts(
      report({
        facilities: [loan({ status: "settled", defaultAmount: 9000, settledMonthsAgo: 3 })],
        judgments: [order({ active: false, amount: 70000 })],
      }),
      [],
    );
    expect(drafts).toEqual([]);
  });

  it("estimates the payoff of existing loans and lets the new personal finance buy out loans and cards", () => {
    const drafts = itemDrafts(null, [
      { kind: "mortgage", lender: "بنك", monthly: 4000, remaining: 480000 },
      { kind: "personal", lender: "بنك", monthly: 2000, remaining: 60000 },
      { kind: "card", lender: "بنك", monthly: 0, remaining: 8000 },
      { kind: "other", monthly: 300, remaining: 1000 },
    ]);
    expect(drafts.map((d) => [d.kind, d.by, d.original, d.monthly])).toEqual([
      ["mortgage_payoff", "company", 480000, 4000],
      ["personal_payoff", "bank", 60000, 2000],
      ["card", "bank", 8000, null],
    ]);
    // A payoff is never estimated above what remains, and a loan without an installment is taken at its balance.
    expect(drafts[0]!.pay).toBeLessThan(480000);
    expect(drafts[1]!.pay).toBeLessThan(60000);
    expect(drafts[2]!.pay).toBe(8000);
  });
});
