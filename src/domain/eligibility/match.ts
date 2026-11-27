import { adminFee, aprOf, earlySettlement, installmentFor, pensionEstimate, principalFrom } from "../finance/amortization";
import { SAMA } from "../finance/sama";
import { round0, round1 } from "../shared/num";
import { specialChecks } from "./special";
import type { Capacity, Check, CheckStatus, Limit, Match, Product, Profile } from "./types";

/** Share of the total salary taken as the basic salary when the basic one is not known. */
export const BASIC_SALARY_GUESS = 0.65;
/** The cap applied to a pension for a mortgage when the room was measured with no cap at all. */
const PENSION_CAP_FALLBACK = 0.55;
/** A pension that carries less than this share of the installment is flagged. */
const PENSION_DROP_WARN = 0.5;

/** The loan-to-value the regulator allows this client, percent. */
export function regulatoryLtv(p: Profile): number {
  if (p.nationality === "saudi" && p.firstHome !== false) return SAMA.ltvFirstHomeCitizen;
  return SAMA.ltvSecondHome;
}

/** Present value of `amount` paid for `months`, at a monthly rate. */
const worth = (amount: number, months: number, monthlyRate: number): number =>
  months <= 0 ? 0 : monthlyRate === 0 ? amount * months : (amount * (1 - Math.pow(1 + monthlyRate, -months))) / monthlyRate;

/**
 * How well a product fits, 0 to 100. Every refusal and every condition costs, covering less of what
 * was asked for costs, a dearer rate costs, and the bank the salary is already paid into gains.
 */
export function fitScore(fit: { fails: number; warns: number; coverage: number; apr: number; salaryBank: boolean }): number {
  const score = (100 - fit.fails * 30 - fit.warns * 8) * (0.6 + 0.4 * fit.coverage) - fit.apr * 2.5 + (fit.salaryBank ? 8 : 0);
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Holds one product against the client: every condition, the most it would lend and what that costs. */
export function matchProduct(p: Profile, cap: Capacity, product: Product): Match {
  const checks: Check[] = [];
  const salary = p.totalSalary ?? p.basicSalary ?? 0;
  const isMortgage = product.financeType === "mortgage";

  if (!salary) checks.push({ key: "salary", status: "warn", code: "SALARY_MISSING", params: {} });
  else checks.push({ key: "salary", status: salary >= product.minSalary ? "pass" : "fail", code: "SALARY_MIN", params: { salary, min: product.minSalary } });

  checks.push({ key: "sector", status: product.sectors.includes(p.sector) ? "pass" : "fail", code: "SECTOR", params: { sector: p.sector } });
  checks.push({ key: "nationality", status: product.nationalities.includes(p.nationality) ? "pass" : "fail", code: "NATIONALITY", params: { nationality: p.nationality } });

  let tenor = Math.min(product.maxTenor, p.requestedTenor || product.maxTenor);
  if (!isMortgage && product.financeType !== "card") tenor = Math.min(tenor, SAMA.consumerMaxTenor);
  if (p.age == null) checks.push({ key: "age", status: "warn", code: "AGE_MISSING", params: {} });
  else if (p.age < product.minAge) checks.push({ key: "age", status: "fail", code: "AGE_BELOW_MIN", params: { age: p.age, min: product.minAge } });
  else {
    const monthsLeft = (product.maxAgeAtMaturity - p.age) * 12;
    if (monthsLeft <= 0) checks.push({ key: "age", status: "fail", code: "AGE_OVER_MAX", params: { max: product.maxAgeAtMaturity } });
    else if (monthsLeft < tenor) {
      tenor = monthsLeft;
      checks.push({ key: "age", status: "warn", code: "TENOR_SHORTENED", params: { tenor, max: product.maxAgeAtMaturity } });
    } else checks.push({ key: "age", status: "pass", code: "AGE_AT_END", params: { ageAtEnd: round1(p.age + tenor / 12), max: product.maxAgeAtMaturity } });
  }

  if (p.sector === "retired") checks.push({ key: "service", status: "pass", code: "SERVICE_NOT_NEEDED", params: {} });
  else if (p.serviceMonths == null) checks.push({ key: "service", status: "warn", code: "SERVICE_MISSING", params: {} });
  else checks.push({ key: "service", status: p.serviceMonths >= product.minServiceMonths ? "pass" : "fail", code: "SERVICE_MIN", params: { months: p.serviceMonths, min: product.minServiceMonths } });

  if (p.simah === "clean") checks.push({ key: "simah", status: "pass", code: "RECORD_CLEAN", params: {} });
  else if (p.simah === "unknown") checks.push({ key: "simah", status: "warn", code: "RECORD_UNKNOWN", params: {} });
  else if (p.simah === "late") checks.push({ key: "simah", status: product.acceptsLateSimah ? "warn" : "fail", code: "RECORD_LATE", params: {} });
  else checks.push({ key: "simah", status: "fail", code: "RECORD_DEFAULT", params: {} });

  if (product.requiresSalaryTransfer) {
    const same = !!p.salaryBank && !!product.bankCode && p.salaryBank === product.bankCode;
    checks.push({ key: "transfer", status: same ? "pass" : "warn", code: "SALARY_TRANSFER", params: {} });
  }

  const months = Math.max(0, Math.floor(tenor));
  let limitedBy: Limit = { code: "INCOME" };
  let maxPrincipal = principalFrom(cap.available, months, product.rate, product.rateType);

  // Retirement inside the term: the installment steps down to what the expected pension carries.
  let retirement: Match["retirement"] = null;
  const employee = p.sector !== "retired" && p.sector !== "self";
  if (employee && p.age != null && months > 0) {
    const monthsToRetire = Math.max(0, Math.round((SAMA.retirementAge - p.age) * 12));
    if (monthsToRetire < months) {
      const basic = p.basicSalary ?? salary * BASIC_SALARY_GUESS;
      const serviceYears = ((p.serviceMonths ?? 0) + monthsToRetire) / 12;
      const pension = pensionEstimate(basic, serviceYears) + (p.financeType === "mortgage" ? Math.max(0, p.coIncome ?? 0) : 0);
      const pensionCap = isMortgage ? cap.capUsed || PENSION_CAP_FALLBACK : SAMA.salaryDeductionRetired;
      const carried = Math.max(0, pension * pensionCap - (isMortgage ? cap.existingMortgage : 0));
      const before = cap.available;
      const after = Math.min(carried, before);
      const yearly = product.rateType === "reducing" ? product.rate : aprOf(100000, installmentFor(100000, months, product.rate, "flat"), months);
      const r = yearly / 100 / 12;
      const stepped = worth(before, monthsToRetire, r) + worth(after, months - monthsToRetire, r) / Math.pow(1 + r, monthsToRetire);
      if (stepped < maxPrincipal) {
        maxPrincipal = stepped;
        limitedBy = { code: "RETIREMENT" };
      }
      retirement = { atMonth: monthsToRetire, pension, before: round0(before), after: round0(after) };
      checks.push({
        key: "retire",
        status: carried < before * PENSION_DROP_WARN ? "warn" : "pass",
        code: "RETIRES_IN_TERM",
        params: { retirementAge: SAMA.retirementAge, months: monthsToRetire, pension, installmentAfter: after },
      });
    }
  }

  // Loan to value, for a mortgage.
  let ltv: Match["ltv"] = null;
  if (isMortgage) {
    const percent = Math.min(product.maxLtv ?? 100, regulatoryLtv(p));
    const value = p.propertyValue ?? null;
    const propertyMax = value ? Math.floor(value * (percent / 100)) : null;
    if (propertyMax != null && propertyMax < maxPrincipal) {
      maxPrincipal = propertyMax;
      limitedBy = { code: "LTV", percent };
    }
    ltv = { percent, down: value ? Math.max(0, value - Math.min(propertyMax ?? 0, maxPrincipal)) : null, propertyMax };
    checks.push({ key: "ltv", status: "pass", code: "DOWN_PAYMENT", params: { percent, propertyValue: value || null, down: ltv.down } });
  }

  if (product.maxAmount < maxPrincipal) {
    maxPrincipal = product.maxAmount;
    limitedBy = { code: "PRODUCT_MAX" };
  }

  if (cap.available <= 0) checks.push({ key: "dbr", status: "fail", code: "NO_ROOM", params: {} });
  else
    checks.push({
      key: "dbr",
      status: maxPrincipal < Math.min(p.requestedAmount || 0, product.maxAmount) ? "warn" : "pass",
      code: "ROOM",
      params: { available: cap.available, rule: cap.rule, share: cap.capUsed, retired: cap.retired, mortgage: cap.mortgage },
    });

  const requested = p.requestedAmount || 0;
  const offerPrincipal = Math.floor(Math.max(0, requested > 0 ? Math.min(requested, maxPrincipal) : maxPrincipal) / 1000) * 1000;

  // What this lender asks beyond the terms every product has.
  checks.push(
    ...specialChecks(product.special, {
      amount: offerPrincipal,
      most: Math.floor(Math.max(0, maxPrincipal) / 1000) * 1000,
      contract: p.contractType,
      noContract: p.sector === "retired" || p.sector === "self",
      inquiries: p.inquiries,
      answers: p.answers,
    }),
  );
  let installment = installmentFor(offerPrincipal, months, product.rate, product.rateType);
  if (retirement && offerPrincipal > 0 && installment > cap.available) installment = cap.available;
  const apr = product.rateType === "reducing" ? product.rate : aprOf(offerPrincipal, installment, months);

  let totalCost = installment * months;
  if (retirement && offerPrincipal > 0) {
    // A stepped schedule at the same effective rate: one installment before retirement, another after.
    const r = apr / 100 / 12;
    const before = retirement.atMonth;
    const after = months - before;
    const level = installmentFor(offerPrincipal, months, product.rate, product.rateType);
    if (level <= retirement.after || r === 0) {
      // The pension carries the level installment: nothing steps down.
      retirement.after = round0(level);
      totalCost = level * months;
    } else {
      // After retirement the most the pension carries, and before it whatever repays the rest.
      const afterWorth = (retirement.after * (1 - Math.pow(1 + r, -after))) / r / Math.pow(1 + r, before);
      const needed = ((offerPrincipal - afterWorth) * r) / (1 - Math.pow(1 + r, -before));
      installment = Math.min(cap.available, needed);
      totalCost = installment * before + retirement.after * after;
    }
  }

  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  const verdict: CheckStatus = fails ? "fail" : warns ? "warn" : "pass";
  const coverage = requested > 0 ? Math.min(1, maxPrincipal / requested) : 1;
  const score = fitScore({ fails, warns, coverage, apr, salaryBank: !!product.bankCode && p.salaryBank === product.bankCode });

  return {
    product,
    checks,
    verdict,
    score,
    tenor: months,
    maxPrincipal: Math.floor(Math.max(0, maxPrincipal) / 1000) * 1000,
    offerPrincipal,
    installment: round0(installment),
    totalCost: round0(totalCost),
    apr,
    totalProfit: round0(Math.max(0, totalCost - offerPrincipal)),
    fee: adminFee(offerPrincipal),
    settle12: offerPrincipal > 0 && months > 12 ? earlySettlement(offerPrincipal, apr, months, 12) : null,
    limitedBy,
    ltv,
    retirement,
  };
}
