import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dealAlternatives, dealStudy, type Alternative, type Borrower, type CreditFlags, type DealInput, type DealStudy } from "@/domain/deal";
import { round0 } from "@/domain/shared/num";

/**
 * Locks the numbers.
 *
 * tests/golden/deal.json holds the answers of the engine that ran in production before the rebuild,
 * for 240 generated deals that cover every structure, every risk and every alternative.
 * The new engine must give the same answer for each one, to the riyal.
 */
interface Case {
  input: DealInput;
  borrower: Borrower;
  credit: CreditFlags | null;
  expected: Record<string, unknown> & { alternatives: unknown[] };
}

const file = path.join(import.meta.dirname, "../golden/deal.json");
const { cases } = JSON.parse(readFileSync(file, "utf8")) as { cases: Case[] };

/** Same JSON round trip the stored answers went through (drops undefined, turns -0 into 0). */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function comparable(s: DealStudy) {
  const { totalCap: _totalCap, personalEstimate: _personalEstimate, mortgageCeiling: _mortgageCeiling, personalCeiling: _personalCeiling, ...financing } = s.financing;
  return plain({
    structure: s.structure,
    verdict: s.verdict,
    keptMonthly: s.keptMonthly,
    paidByCompany: s.paidByCompany,
    paidByBank: s.paidByBank,
    transferTax: s.transferTax,
    saleTax: s.saleTax,
    capital: s.capital,
    financing,
    companyFromSale: s.companyFromSale,
    downPayment: s.downPayment,
    personalCash: s.personalCash,
    surplusBeforeFee: s.surplusBeforeFee,
    fee: s.fee,
    feeSettle: s.feeSettle,
    feeFinance: s.feeFinance,
    settleBase: s.settleBase,
    financeBase: s.financeBase,
    suggestedPct: s.suggestedPct,
    suggestedReasons: s.suggestedReasons,
    dueFromClient: s.dueFromClient,
    clientNet: s.clientNet,
    roi: s.roi,
    days: s.days,
    annualized: s.annualized,
    cover: s.cover,
    breakEvenDiscount: s.breakEvenDiscount,
    risks: s.risks.map((r) => [r.level, r.code]),
    ledger: s.ledger.map((l) => [l.section, l.value, l.tone ?? null]),
    summary: {
      obligations: s.summary.obligations,
      totalObligations: s.summary.totalObligations,
      discountTotal: s.summary.discountTotal,
      kept: s.summary.kept,
      keptExecutions: s.summary.keptExecutions,
      financing: s.summary.financing.map((f) => f.amount),
      totalFinancing: s.summary.totalFinancing,
      costs: s.summary.costs.map((c) => c.amount),
      afterSettle: s.summary.afterSettle,
      net: s.summary.net,
    },
    steps: s.steps.map((t) => [t.stage, t.days]),
  });
}

/** The numbers each alternative shows the user, in the order the old interface printed them. */
function shownNumbers(a: Alternative): number[] {
  const p = a.params as Record<string, number>;
  switch (a.code) {
    case "STRUCTURE_CLOSES":
      return [p.clientNet!, p.fee!];
    case "DISCOUNT_CLOSES":
      return [p.pct!, round0(p.payAfter!), round0(p.payBefore!)];
    case "FEE_MIN_CLOSES":
      return [p.pct!, p.pct!, p.clientNet!];
    case "FEE_MIN_NOT_ENOUGH":
    case "ZERO_FEE_STILL_SHORT":
      return [p.deficit!];
    case "PERSONAL_COVERS_UNDER_5PCT":
      return [5, p.personalCash!];
    case "PERSONAL_PARTIAL_COVER":
      return [p.covers!, round0(p.settleBase!)];
    case "KEEP_PERSONAL_TOP_UP":
      return [p.netTopUp!, round0(p.left!), p.personalCash!];
    case "HIGHER_VALUATION":
      return [round0(p.value!), p.upliftPct!];
    case "CO_BORROWER":
      return [p.salary!];
  }
}

describe("deal engine matches the production answers", () => {
  it("has the full set of stored cases", () => {
    expect(cases.length).toBe(240);
  });

  it.each(cases.map((c, i) => [i + 1, c] as const))("study %i", (_n, c) => {
    const { alternatives: _alternatives, ...expected } = c.expected;
    expect(comparable(dealStudy(c.input, c.borrower, c.credit))).toEqual(expected);
  });

  it.each(cases.map((c, i) => [i + 1, c] as const))("alternatives %i", (_n, c) => {
    const got = dealAlternatives(c.input, c.borrower, c.credit).map((a) =>
      plain({ tone: a.tone, code: a.code, numbers: shownNumbers(a), patch: a.patch ?? null }),
    );
    expect(got).toEqual(c.expected.alternatives);
  });
});
