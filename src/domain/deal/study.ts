import { adminFee, installmentFor, pensionEstimate, principalFrom } from "../finance/amortization";
import { SAMA } from "../finance/sama";
import { round0, sum } from "../shared/num";
import { FEE_MAX, FEE_MIN, normalizeFee } from "./fee";
import { shortLabel } from "./labels";
import { splitItems, stagesFor, structureOf, STRUCTURES } from "./structure";
import type {
  Borrower,
  CreditFlags,
  DealInput,
  DealItem,
  DealStudy,
  DealSummary,
  Fee,
  FeeReason,
  Financing,
  LedgerLine,
  Risk,
  Verdict,
} from "./types";

/** A client net below this amount closes the deal, but with a thin margin. */
export const THIN_MARGIN = 20000;
/** Collateral cover below this blocks the deal. */
export const COVER_BLOCK = 1.1;
/** Collateral cover below this is flagged as sensitive. */
export const COVER_WARN = 1.3;
/** Months to retirement below which the mortgage is restricted by the pension. */
export const NEAR_RETIREMENT_MONTHS = 120;

type StructureFlags = { mortgage: boolean; personal: boolean };

const isSettled = (i: DealItem) => i.kind === "execution" || i.kind === "default";
const isPayoff = (i: DealItem) => i.kind === "mortgage_payoff" || i.kind === "personal_payoff";

/**
 * New financing the client can expect after the settlement.
 * Obligations that stay outside the deal eat into the deduction cap.
 */
function expectedFinancing(
  x: DealInput,
  b: Borrower,
  st: StructureFlags,
  propertyValue: number,
  keptMonthly: number,
): Financing & { salary: number } {
  const salary = b.totalSalary ?? b.basicSalary ?? 0;
  const age = b.age;
  const monthsToRetire =
    age != null && b.sector !== "retired" && b.sector !== "self" ? Math.max(0, (SAMA.retirementAge - age) * 12) : null;
  const pension =
    monthsToRetire != null && b.basicSalary
      ? pensionEstimate(b.basicSalary, ((b.serviceMonths ?? 0) + monthsToRetire) / 12)
      : null;
  const totalCap = salary <= SAMA.lowBracket ? SAMA.totalCapLow : SAMA.totalCapMid;
  const room = Math.max(0, salary * totalCap - keptMonthly);

  const personalInstallment = st.personal ? round0(Math.min(salary * SAMA.salaryDeductionEmployee, room)) : 0;
  const personalMonths = Math.min(
    x.personalMonths || 60,
    SAMA.consumerMaxTenor,
    monthsToRetire && monthsToRetire > 0 ? Math.max(12, monthsToRetire) : 60,
  );
  const personalEstimate = round0(principalFrom(personalInstallment, personalMonths, x.personalFlat, "flat"));

  const mortgagePre = st.mortgage ? Math.max(0, round0(room - personalInstallment)) : 0;
  const mortgageMonths = st.mortgage
    ? Math.min(x.mortgageMaxMonths || 300, age != null ? Math.max(0, (x.mortgageMaxAge - age) * 12) : 300)
    : 0;
  let mortgageByIncome = 0;
  let mortgagePost = 0;
  if (!st.mortgage) {
    // No new mortgage in this structure.
  } else if (monthsToRetire != null && monthsToRetire < mortgageMonths) {
    // Stepped installment: full before retirement, then within the pension's cap.
    const pensionCap = pension != null && pension <= SAMA.lowBracket ? SAMA.totalCapLow : SAMA.totalCapMid;
    mortgagePost = Math.min(mortgagePre, round0((pension ?? 0) * pensionCap));
    const r = x.mortgageApr / 100 / 12;
    const beforeRetirement = principalFrom(mortgagePre, monthsToRetire, x.mortgageApr, "reducing");
    const afterRetirement =
      principalFrom(mortgagePost, mortgageMonths - monthsToRetire, x.mortgageApr, "reducing") *
      Math.pow(1 + r, -monthsToRetire);
    mortgageByIncome = round0(beforeRetirement + afterRetirement);
  } else {
    mortgagePost = mortgagePre;
    mortgageByIncome = round0(principalFrom(mortgagePre, mortgageMonths, x.mortgageApr, "reducing"));
  }
  const mortgageByLtv = st.mortgage && propertyValue ? round0((propertyValue * x.ltvPct) / 100) : null;
  const mortgageEstimate = mortgageByLtv != null ? Math.min(mortgageByIncome, mortgageByLtv) : mortgageByIncome;
  const mortgage = st.mortgage ? (x.bankMortgage ?? mortgageEstimate) : 0;
  const personal = st.personal ? (x.bankPersonal ?? personalEstimate) : 0;
  const source =
    (st.mortgage && x.bankMortgage != null) || (st.personal && x.bankPersonal != null) ? "bank" : "estimate";

  const mortgageInstallment = st.mortgage ? installmentFor(mortgage, mortgageMonths, x.mortgageApr, "reducing") : 0;
  const personalActual = st.personal ? installmentFor(personal, personalMonths, x.personalFlat, "flat") : 0;
  const dbrAfter = salary
    ? Math.round(((Math.min(mortgageInstallment, mortgagePre) + personalActual + keptMonthly) / salary) * 1000) / 10
    : null;

  return {
    salary,
    age,
    monthsToRetire,
    pension,
    totalCap,
    personalInstallment,
    personalMonths,
    personalEstimate,
    personal,
    mortgagePre,
    mortgagePost,
    mortgageMonths,
    mortgageByIncome,
    mortgageByLtv,
    mortgage,
    source,
    dbrAfter,
  };
}

/** Amount the settlement percent applies to. */
function settlementBase(active: DealItem[], fee: Fee): number {
  return sum(
    active.filter(
      (i) =>
        i.by === "company" &&
        (isSettled(i) || i.kind === "card" || i.kind === "other" || (fee.settleIncludesPayoff && isPayoff(i))),
    ),
    (i) => i.pay || 0,
  );
}

export function dealStudy(x: DealInput, b: Borrower, credit?: CreditFlags | null): DealStudy {
  const structure = structureOf(x);
  const st = STRUCTURES[structure];
  const { active, kept } = splitItems(x);
  const byCompany = active.filter((i) => i.by === "company");
  const byBank = active.filter((i) => i.by === "bank");

  // Capital the company puts in.
  const keptMonthly = round0(sum(kept, (i) => i.monthly || 0));
  const paidByCompany = sum(byCompany, (i) => i.pay || 0);
  const paidByBank = sum(byBank, (i) => i.pay || 0);
  const propertyValue = st.mortgage ? (x.propertyValue ?? 0) : 0;
  const transferTax = round0((propertyValue * (x.transferTaxPct || 0)) / 100);
  const saleTax = round0((propertyValue * (x.saleTaxPct || 0)) / 100);
  // Valuation, brokerage and transfer fees only exist when a property is involved.
  const fixedCosts = st.mortgage ? x.fixedCosts || 0 : 0;
  const capital = round0(paidByCompany + transferTax + fixedCosts);

  const f = expectedFinancing(x, b, st, propertyValue, keptMonthly);
  const { salary, monthsToRetire, pension, totalCap, personalInstallment, personalMonths, personal, mortgage } = f;

  // Where the financing goes.
  const lenderFee = adminFee(personal);
  const personalCash = st.personal ? round0(personal - paidByBank - lenderFee) : 0;
  const price = st.mortgage ? propertyValue || mortgage : 0;
  const downPayment = st.mortgage ? Math.max(0, round0(price - mortgage)) : 0;
  const companyFromSale = st.mortgage ? price - saleTax : 0;
  const surplusBeforeFee = round0(mortgage + personalCash - capital - saleTax);

  const fee = normalizeFee(x.fee);
  const settleBase = settlementBase(active, fee);
  const financeBase =
    fee.financeBase === "personal" ? personal : fee.financeBase === "mortgage" ? mortgage : mortgage + personal;
  const feeSettle = round0((settleBase * fee.settlePct) / 100);
  const feeFinance = round0((financeBase * fee.financePct) / 100);
  const feeFixed = fee.fixed || 0;
  const feeTotal = round0(feeSettle + feeFinance + feeFixed);

  // Negative means a surplus from the sale price that goes back to the client.
  const dueFromClient = round0(capital + feeTotal - companyFromSale);
  const clientNet = round0(personalCash - downPayment - dueFromClient);

  const steps = stagesFor(structure).filter((s) => s.stage !== "closed" && s.stage !== "lost");
  const days = sum(steps, (s) => s.days);
  const roi = capital > 0 ? Math.round((feeTotal / capital) * 1000) / 10 : null;
  const annualized = roi != null && days ? Math.round(((roi * 365) / days) * 10) / 10 : null;
  const cover = st.mortgage && capital > 0 && propertyValue ? Math.round((propertyValue / capital) * 100) / 100 : null;
  const discountable = sum(byCompany.filter(isSettled), (i) => i.pay);
  // Every riyal of discount saves the riyal plus the settlement fee on it.
  const breakEvenDiscount =
    clientNet < 0 && discountable > 0
      ? Math.min(100, Math.round((-clientNet / (discountable * (1 + fee.settlePct / 100))) * 1000) / 10)
      : null;

  // ----- Risks, in the order the user should read them -----
  const risks: Risk[] = [];
  const risk = (level: Risk["level"], code: Risk["code"], params: Risk["params"] = {}) =>
    risks.push({ level, code, params });

  const keptInstallments = kept.filter((i) => !isSettled(i));
  const keptExecutions = kept.filter((i) => i.kind === "execution");
  const keptDefaults = kept.filter((i) => i.kind === "default");
  const nearRetirement = st.mortgage && monthsToRetire != null && monthsToRetire < NEAR_RETIREMENT_MONTHS;

  if (st.mortgage && !propertyValue) risk("block", "PROPERTY_VALUE_MISSING");
  if (clientNet < 0) {
    risk("block", "DEFICIT", {
      deficit: -clientNet,
      hasMortgage: st.mortgage,
      personalCash,
      required: capital + feeTotal,
    });
  } else if (clientNet < THIN_MARGIN) {
    risk("warn", "THIN_MARGIN", { clientNet });
  }
  if (keptInstallments.length) {
    const missingMonthly = keptInstallments.some((i) => !i.monthly);
    risk(missingMonthly ? "warn" : "info", "KEPT_OBLIGATIONS", {
      labels: keptInstallments.map((i) => i.label),
      keptMonthly,
      missingMonthly,
    });
  }
  if (keptExecutions.length) {
    risk("block", "EXECUTION_OUTSIDE_DEAL", {
      count: keptExecutions.length,
      amount: sum(keptExecutions, (i) => i.pay),
    });
  }
  if (keptDefaults.length) {
    risk("warn", "DEFAULT_OUTSIDE_DEAL", {
      labels: keptDefaults.map((i) => i.label),
      amount: sum(keptDefaults, (i) => i.pay),
    });
  }
  if (st.personal && x.personalLenderKind === "finance_co") {
    risk("warn", "PERSONAL_FROM_FINANCE_CO", {
      lender: x.personalLender || null,
      offerBelowBankEstimate: x.bankPersonal != null && f.personalEstimate > personal,
      personalInstallment,
      personal,
      personalEstimate: f.personalEstimate,
      bankFlat: x.personalFlat,
    });
  }
  if (!st.mortgage) risk("warn", "NO_COLLATERAL");
  if (cover != null && cover < COVER_BLOCK) risk("block", "COVER_LOW", { cover });
  else if (cover != null && cover < COVER_WARN) risk("warn", "COVER_SENSITIVE", { cover });
  if (credit?.financeCoDefault) risk("warn", "FINANCE_CO_DEFAULT_HISTORY");
  if (credit?.bankReopenMonths) risk("warn", "BANK_WAIT", { months: credit.bankReopenMonths });
  if (credit?.suspension) risk("info", "SUSPENSION_LIFT", { hasMortgage: st.mortgage });
  if (nearRetirement) {
    risk("warn", "NEAR_RETIREMENT", { years: Math.round((monthsToRetire ?? 0) / 12), pension: pension ?? 0 });
  }
  if (st.mortgage && propertyValue && f.mortgageByIncome < (f.mortgageByLtv ?? 0)) {
    risk("info", "INCOME_BOUND", {
      mortgageByIncome: f.mortgageByIncome,
      mortgageByLtv: f.mortgageByLtv ?? 0,
      downPayment,
    });
  }
  if (active.some((i) => i.kind === "mortgage_payoff" && !i.confirmed)) risk("warn", "PAYOFF_UNCONFIRMED");
  if (active.some((i) => i.kind === "execution")) risk("info", "NEGOTIATE_EXECUTIONS");
  if (st.mortgage && x.transferTaxPct > 0) risk("info", "TRANSFER_TAX", { transferTax });
  if (st.mortgage) risk("info", "RECOVERY_GUARANTEES");
  if (f.dbrAfter != null && f.dbrAfter > totalCap * 100 + 0.5) {
    risk("warn", "DBR_OVER_CAP", { dbrAfter: f.dbrAfter, cap: Math.round(totalCap * 100) });
  }

  // ----- Suggested fee by client risk: the minimum as a base, five points per reason, capped -----
  const suggestedReasons: FeeReason[] = [];
  if (credit?.suspension) suggestedReasons.push("SUSPENSION");
  if (credit?.financeCoDefault) suggestedReasons.push("FINANCE_CO_DEFAULT");
  if (active.some((i) => i.kind === "execution")) suggestedReasons.push("EXECUTIONS");
  if (!st.mortgage) suggestedReasons.push("NO_COLLATERAL");
  if (cover != null && cover < COVER_WARN) suggestedReasons.push("LOW_COVER");
  if (nearRetirement) suggestedReasons.push("NEAR_RETIREMENT");
  if (propertyValue && paidByCompany > propertyValue * 0.8) suggestedReasons.push("PAID_NEAR_VALUE");
  const suggestedPct = Math.min(FEE_MAX, FEE_MIN + 5 * suggestedReasons.length);
  if (fee.settlePct > FEE_MAX || fee.financePct > FEE_MAX) risk("warn", "FEE_OVER_MAX", { max: FEE_MAX });

  const verdict: Verdict =
    st.mortgage && !propertyValue
      ? "needs_info"
      : clientNet < 0 || (cover != null && cover < COVER_BLOCK)
        ? "short"
        : clientNet < THIN_MARGIN
          ? "tight"
          : "go";

  // ----- Step by step calculation -----
  const ledger: LedgerLine[] = [];
  if (st.personal) {
    const section = "personal";
    const byRule = round0(salary * SAMA.salaryDeductionEmployee);
    ledger.push({ section, key: "salary", value: round0(salary) });
    ledger.push({
      section,
      key: "max_installment",
      value: personalInstallment,
      params: {
        limitedByTotalCap: personalInstallment < byRule,
        totalCap,
        rule: SAMA.salaryDeductionEmployee,
        salary,
        keptMonthly,
      },
    });
    ledger.push({
      section,
      key: "installments_total",
      value: personalInstallment * personalMonths,
      params: { installment: personalInstallment, months: personalMonths },
    });
    ledger.push({
      section,
      key: "principal",
      value: personal,
      tone: "total",
      params: {
        fromOffer: x.bankPersonal != null,
        lender: x.personalLender || null,
        lenderKind: x.personalLenderKind ?? null,
        flat: x.personalFlat,
        years: Math.round((personalMonths / 12) * 10) / 10,
      },
    });
    for (const i of byBank) {
      ledger.push({ section, key: "buyout", value: -round0(i.pay), tone: "minus", params: { itemId: i.id, label: i.label } });
    }
    ledger.push({ section, key: "admin_fee", value: -lenderFee, tone: "minus", params: { principal: personal } });
    ledger.push({ section, key: "net_to_client", value: personalCash, tone: "total" });
  }
  if (st.mortgage) {
    const section = "mortgage";
    ledger.push({
      section,
      key: "available_installment",
      value: f.mortgagePre,
      params: { salary, totalCap, personalInstallment, keptMonthly },
    });
    if (f.mortgagePost !== f.mortgagePre) {
      ledger.push({ section, key: "post_retirement_installment", value: f.mortgagePost, params: { pension: pension ?? 0 } });
    }
    ledger.push({
      section,
      key: "income_limit",
      value: f.mortgageByIncome,
      params: { months: f.mortgageMonths, apr: x.mortgageApr },
    });
    if (f.mortgageByLtv != null) {
      ledger.push({ section, key: "value_limit", value: f.mortgageByLtv, params: { propertyValue, ltvPct: x.ltvPct } });
    }
    ledger.push({ section, key: "mortgage", value: mortgage, tone: "total", params: { fromOffer: x.bankMortgage != null } });
    if (downPayment) ledger.push({ section, key: "down_payment", value: downPayment, params: { price, mortgage } });
  }
  {
    const section = "dues";
    for (const i of byCompany) {
      ledger.push({ section, key: "item", value: round0(i.pay), tone: "plus", params: { itemId: i.id, label: i.label } });
    }
    if (transferTax) {
      ledger.push({ section, key: "transfer_tax", value: transferTax, tone: "plus", params: { propertyValue, pct: x.transferTaxPct } });
    }
    if (fixedCosts) ledger.push({ section, key: "fixed_costs", value: fixedCosts, tone: "plus" });
    ledger.push({ section, key: "capital", value: capital, tone: "total" });
    ledger.push({ section, key: "fee_settle", value: feeSettle, tone: "plus", params: { base: settleBase, pct: fee.settlePct } });
    ledger.push({ section, key: "fee_finance", value: feeFinance, tone: "plus", params: { base: financeBase, pct: fee.financePct } });
    if (feeFixed) ledger.push({ section, key: "fee_fixed", value: feeFixed, tone: "plus" });
    if (companyFromSale) ledger.push({ section, key: "sale_recovery", value: -round0(companyFromSale), tone: "minus" });
    ledger.push({ section, key: "due_from_client", value: dueFromClient, tone: "total" });
  }
  {
    const section = "result";
    ledger.push({ section, key: "net_financing", value: personalCash, tone: "plus" });
    if (downPayment) ledger.push({ section, key: "down_payment", value: -downPayment, tone: "minus" });
    ledger.push({ section, key: "dues", value: -dueFromClient, tone: "minus" });
    ledger.push({ section, key: "client_net", value: clientNet, tone: "total", params: { deficit: clientNet < 0 } });
  }

  // ----- Plain summary: obligations, financing, costs, then what is left -----
  const obligations = active.map((i) => ({
    label: shortLabel(i.label),
    amount: round0(i.pay),
    original: round0(i.original || 0),
    byBank: i.by === "bank",
  }));
  const discountTotal = round0(
    sum(
      active.filter((i) => isSettled(i) || i.kind === "card" || i.kind === "other"),
      (i) => Math.max(0, (i.original || 0) - (i.pay || 0)),
    ),
  );
  const financingLines: DealSummary["financing"] = [];
  if (st.mortgage) financingLines.push({ kind: "mortgage", amount: mortgage, lender: null, lenderKind: null });
  if (st.personal) {
    financingLines.push({
      kind: "personal",
      amount: personal,
      lender: x.personalLender || null,
      lenderKind: x.personalLenderKind ?? null,
    });
  }
  const costs: DealSummary["costs"] = [];
  if (st.personal) costs.push({ kind: "admin_fee", amount: lenderFee });
  if (transferTax) costs.push({ kind: "transfer_tax", amount: transferTax });
  if (saleTax) costs.push({ kind: "sale_tax", amount: saleTax });
  if (fixedCosts) costs.push({ kind: "fixed_costs", amount: fixedCosts });
  const totalObligations = sum(obligations, (o) => o.amount);
  const totalFinancing = mortgage + personal;
  const afterSettle = round0(totalFinancing - totalObligations - sum(costs, (c) => c.amount));
  const summary: DealSummary = {
    obligations,
    totalObligations,
    discountTotal,
    kept: kept.map((i) => ({
      label: shortLabel(i.label).replace(/^مخالصة\s+/, ""),
      monthly: i.monthly ?? null,
      amount: round0(i.pay),
      kind: i.kind,
    })),
    keptExecutions: round0(sum(keptExecutions, (i) => i.pay)),
    financing: financingLines,
    totalFinancing,
    costs,
    afterSettle,
    net: round0(afterSettle - feeTotal),
  };

  const { salary: _salary, ...financing } = f;
  return {
    structure,
    verdict,
    keptMonthly,
    paidByCompany: round0(paidByCompany),
    paidByBank: round0(paidByBank),
    transferTax,
    saleTax,
    fixedCosts,
    capital,
    financing,
    price,
    downPayment,
    companyFromSale,
    personalCash,
    surplusBeforeFee,
    fee: feeTotal,
    feeSettle,
    feeFinance,
    feeFixed,
    settleBase,
    financeBase,
    suggestedPct,
    suggestedReasons,
    dueFromClient,
    clientNet,
    roi,
    days,
    annualized,
    cover,
    breakEvenDiscount,
    risks,
    ledger,
    summary,
    steps,
  };
}
