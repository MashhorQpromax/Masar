import { round0, sum } from "@/domain/shared/num";
import { CREDIT_RULES as R } from "./rules";
import type {
  AccessReason,
  Blocker,
  CreditAction,
  CreditAnalysis,
  CreditReport,
  CreditorType,
  CreditStats,
  Door,
  Facility,
  Finding,
  Grade,
  Judgment,
  Standing,
} from "./types";

const CARD = /بطاق|card/i;

/** What is still owed on a default. */
const owed = (d: Facility): number => d.defaultNow ?? d.defaultAmount ?? d.balance ?? 0;

/** What is still owed on a judgment. */
const due = (j: Judgment): number => j.remaining ?? j.amount ?? 0;

/**
 * An enforcement order is usually the creditor taking a default to court, so the same debt shows
 * twice on the record. Each open order is paired with the first unpaid default of about the same
 * amount that no other order has taken.
 */
export function sameDebts(orders: readonly Judgment[], unpaidDefaults: readonly Facility[]): Map<Judgment, Facility> {
  const pairs = new Map<Judgment, Facility>();
  const taken = new Set<Facility>();
  for (const order of orders) {
    const amount = due(order);
    const match = unpaidDefaults.find(
      (d) => !taken.has(d) && Math.abs((d.defaultNow ?? d.defaultAmount ?? 0) - amount) <= Math.max(R.sameDebtTolerance, amount * R.sameDebtShare),
    );
    if (match) {
      taken.add(match);
      pairs.set(order, match);
    }
  }
  return pairs;
}

const door = (access: Door["access"], reason: AccessReason, reopenInMonths: number | null = null): Door => ({ access, reason, reopenInMonths });

/** Grades a credit record and says what stands between the client and the lenders. The report is not changed. */
export function analyzeCredit(report: CreditReport): CreditAnalysis {
  const facilities = report.facilities ?? [];
  const judgments = report.judgments ?? [];
  const inquiries6m = report.inquiries6m ?? 0;

  const live = facilities.filter((f) => f.status !== "closed" && f.status !== "settled");
  const unpaid = facilities.filter((f) => f.status === "default");
  const settled = facilities.filter((f) => f.status === "settled" && (f.defaultAmount ?? 0) > 0);
  // In the order they appear on the report, which is the order the counts and amounts are summed in.
  const defaults = facilities.filter((f) => f.status === "default" || (f.status === "settled" && (f.defaultAmount ?? 0) > 0));
  const cards = live.filter((f) => CARD.test(f.product) && (f.limit ?? 0) > 0);
  const cardLimit = sum(cards, (f) => f.limit ?? 0);
  const cardBalance = sum(cards, (f) => f.balance ?? 0);
  const cardUtilization = cardLimit > 0 ? Math.round((cardBalance / cardLimit) * 100) : null;
  const recentDelays = facilities.filter((f) => (f.worstDelay ?? 0) >= R.delayDays && (f.lastDelayMonthsAgo ?? 99) <= R.recentDelayMonths).length;
  const worstDelay = Math.max(0, ...facilities.map((f) => f.worstDelay ?? 0));

  const cheques = judgments.filter((j) => j.kind === "bounced_cheque");
  const openCheques = cheques.filter((j) => j.active);
  const orders = judgments.filter((j) => j.kind !== "bounced_cheque");
  const openOrders = orders.filter((j) => j.active);
  const paired = sameDebts(openOrders, unpaid);
  const enforced = new Set(paired.values());
  const notEnforced = unpaid.filter((d) => !enforced.has(d));

  const openOrdersAmount = sum(openOrders, due);
  const installments = sum(live, (f) => f.installment ?? 0);
  const countBy = (type: CreditorType) => defaults.filter((d) => d.creditorType === type).length;

  const stats: CreditStats = {
    activeFacilities: live.length,
    totalLimits: round0(sum(live, (f) => f.limit ?? 0)),
    totalBalance: round0(sum(live, (f) => f.balance ?? 0)),
    monthlyInstallments: round0(installments),
    cardUtilization,
    defaults: defaults.length,
    activeDefaults: unpaid.length,
    defaultsAmount: round0(sum(defaults, (d) => d.defaultAmount ?? d.balance ?? 0)),
    activeDefaultsAmount: round0(sum(unpaid, owed)),
    bankDefaults: countBy("bank"),
    financeCoDefaults: countBy("finance_company"),
    telecomDefaults: countBy("telecom"),
    judgments: orders.length,
    activeJudgments: openOrders.length,
    judgmentsAmount: round0(sum(orders, (j) => j.amount ?? 0)),
    activeJudgmentsAmount: round0(openOrdersAmount),
    bouncedCheques: cheques.length,
    worstDelay,
    recentDelays,
    inquiries6m,
    inquiries12m: report.inquiries12m ?? 0,
    totalToClear: round0(openOrdersAmount + sum(notEnforced, owed)),
  };

  // Severity: every mark on the record adds points, weighted by who the debt is owed to.
  const P = R.points;
  let severity = 0;
  for (const d of unpaid) {
    severity += P.activeDefault * R.weight[d.creditorType] * ((d.defaultAmount ?? d.balance ?? 0) < R.smallDefault ? R.smallDefaultFactor : 1);
  }
  for (const d of settled) {
    const age = d.settledMonthsAgo ?? 0;
    const fade = R.settledFade.find((step) => age >= step.fromMonths)?.factor ?? 1;
    severity += P.settledDefault * R.weight[d.creditorType] * fade;
  }
  severity += recentDelays * P.recentDelay + (R.worstDelayPoints.find((step) => worstDelay >= step.fromDays)?.points ?? 0);
  severity += openOrders.length * P.activeJudgment + (orders.length - openOrders.length) * P.pastJudgment + openCheques.length * P.activeBouncedCheque;
  if (report.serviceSuspension) severity += P.suspension;
  const manyInquiries = inquiries6m >= R.manyInquiries6m;
  if (manyInquiries) severity += P.manyInquiries;
  if (cardUtilization != null && cardUtilization > R.highCardUse) severity += P.highCardUse;
  severity = Math.min(100, Math.round(severity));

  // What blocks every lender.
  const blockers: Blocker[] = [];
  if (report.serviceSuspension) blockers.push({ code: "SUSPENSION", params: { assumed: !!report.suspensionAssumed } });
  if (report.travelBan) blockers.push({ code: "TRAVEL_BAN", params: {} });
  for (const j of openOrders) {
    blockers.push({
      code: "JUDGMENT",
      params: {
        kind: j.kind === "enforcement" ? "enforcement" : "judgment",
        creditor: j.creditor ?? paired.get(j)?.lender ?? null,
        creditorGuessed: j.creditor == null && paired.has(j),
        amount: j.amount ? round0(due(j)) : null,
        date: j.date || null,
        state: j.state || null,
      },
    });
  }
  for (const j of openCheques) blockers.push({ code: "BOUNCED_CHEQUE", params: { amount: j.amount ? round0(j.amount) : null } });
  for (const d of unpaid) {
    blockers.push({
      code: "ACTIVE_DEFAULT",
      params: {
        lender: d.lender,
        creditorType: d.creditorType,
        remaining: d.defaultAmount || d.balance ? round0(owed(d)) : null,
        listedAt: d.defaultListedAt || null,
        state: d.defaultState || null,
        enforced: enforced.has(d),
      },
    });
  }
  const blocked = blockers.length > 0;

  // What is worth knowing.
  const findings: Finding[] = [];
  if (stats.totalToClear > 0) findings.push({ code: "TOTAL_TO_CLEAR", level: "block", params: { amount: stats.totalToClear } });
  if (stats.financeCoDefaults > 0) {
    findings.push({ code: "FINANCE_CO_DEFAULTS", level: "warn", params: { count: stats.financeCoDefaults, waitMonths: R.bankWaitAfterFinanceCoDefault } });
  }
  if (stats.bankDefaults > 0) findings.push({ code: "BANK_DEFAULTS", level: "warn", params: { count: stats.bankDefaults, waitMonths: R.bankWaitAfterBankDefault } });
  // Only the bills still unpaid: a paid one is told by its own finding below, and has nothing left to pay.
  const unpaidBills = unpaid.filter((d) => d.creditorType === "telecom").length;
  if (unpaidBills > 0) findings.push({ code: "TELECOM_DEFAULTS", level: "info", params: { count: unpaidBills } });
  for (const d of settled) {
    findings.push({
      code: "SETTLED_DEFAULT",
      level: "info",
      params: { lender: d.lender, creditorType: d.creditorType, monthsAgo: d.settledMonthsAgo ?? null, amount: d.defaultAmount ? round0(d.defaultAmount) : null },
    });
  }
  if (recentDelays > 0) findings.push({ code: "RECENT_DELAYS", level: "warn", params: { count: recentDelays, worstDelay, windowMonths: R.recentDelayMonths } });
  else if (worstDelay > 0) findings.push({ code: "OLD_DELAY", level: "info", params: { worstDelay, windowMonths: R.recentDelayMonths } });
  if (manyInquiries) findings.push({ code: "MANY_INQUIRIES", level: "warn", params: { count: inquiries6m } });
  if (cardUtilization != null) {
    findings.push({
      code: "CARD_UTILIZATION",
      level: cardUtilization > R.highCardUse ? "warn" : "info",
      params: { percent: cardUtilization, balance: round0(cardBalance), limit: round0(cardLimit) },
    });
  }
  if (report.score != null) {
    findings.push({ code: "SCORE", level: report.score >= R.score.good ? "good" : report.score >= R.score.fair ? "info" : "warn", params: { score: report.score } });
  }
  if (installments > 0) findings.push({ code: "INSTALLMENTS", level: "info", params: { monthly: stats.monthlyInstallments, facilities: stats.activeFacilities } });
  if (!defaults.length && !judgments.length && !recentDelays && !report.serviceSuspension) findings.push({ code: "CLEAN", level: "good", params: {} });

  // Who would take the client today.
  let banks: Door;
  let financeCompanies: Door;
  if (blocked) {
    banks = door("closed", "BLOCKER");
    financeCompanies = door("closed", "BLOCKER");
  } else {
    // How long ago the most recent default of these kinds was settled. An unknown date is read as just now.
    const lastSettled = (types: CreditorType[]) => settled.filter((d) => types.includes(d.creditorType)).reduce((least, d) => Math.min(least, d.settledMonthsAgo ?? 0), Infinity);
    const financeCoAge = lastSettled(["finance_company"]);
    const bankAge = lastSettled(["bank", "other"]);
    const waitFinanceCo = financeCoAge === Infinity ? 0 : Math.max(0, R.bankWaitAfterFinanceCoDefault - financeCoAge);
    const waitBank = bankAge === Infinity ? 0 : Math.max(0, R.bankWaitAfterBankDefault - bankAge);
    const wait = Math.max(waitFinanceCo, waitBank);
    if (wait > 0) banks = door("closed", waitFinanceCo >= waitBank ? "RECENT_SETTLEMENT_FINANCE_CO" : "RECENT_SETTLEMENT_BANK", wait);
    else if (recentDelays > 0) banks = door("conditional", "RECENT_DELAYS");
    else if (settled.length > 0) banks = door("conditional", "SETTLED_HISTORY");
    else if (manyInquiries) banks = door("conditional", "MANY_INQUIRIES");
    else banks = door("open", "ACCEPTABLE");

    const anyAge = Math.min(financeCoAge, bankAge);
    const waitAny = anyAge === Infinity ? 0 : Math.max(0, R.financeCoWaitAfterDefault - anyAge);
    if (waitAny > 0) financeCompanies = door("closed", "VERY_RECENT_SETTLEMENT", waitAny);
    else if (banks.access === "open") financeCompanies = door("open", "ACCEPTABLE");
    else financeCompanies = door("conditional", "WITH_SETTLEMENT_LETTER");
  }

  // What to do, in order.
  const actions: CreditAction[] = [];
  if (report.serviceSuspension) actions.push({ code: "LIFT_SUSPENSION", params: {} });
  if (openOrders.length) actions.push({ code: "SETTLE_JUDGMENTS", params: { count: openOrders.length, amount: stats.activeJudgmentsAmount } });
  for (const d of notEnforced) actions.push({ code: "PAY_DEFAULT", params: { lender: d.lender, amount: round0(owed(d)) } });
  if (unpaid.length) actions.push({ code: "REFRESH_REPORT", params: {} });
  if (recentDelays) actions.push({ code: "PAY_ON_TIME", params: {} });
  if (manyInquiries) actions.push({ code: "PAUSE_APPLICATIONS", params: {} });
  if (cardUtilization != null && cardUtilization > R.cardUseToLower) actions.push({ code: "LOWER_CARDS", params: {} });
  if (banks.reopenInMonths) actions.push({ code: "RESTUDY_BANKS", params: { months: banks.reopenInMonths } });
  if (!actions.length) actions.push({ code: "NONE", params: {} });

  const grade: Grade = blocked ? "E" : (R.grades.find((step) => severity >= step.from)?.grade ?? "A");
  const standing: Standing =
    unpaid.length || openOrders.length || report.serviceSuspension
      ? "default"
      : recentDelays || settled.some((d) => (d.settledMonthsAgo ?? 0) < R.settledMarksLateMonths)
        ? "late"
        : "clean";

  return { grade, severity, standing, banks, financeCompanies, stats, blockers, findings, actions };
}

/** A report with nothing on it, for a client whose record has not been read yet. */
export function emptyReport(): CreditReport {
  return { facilities: [], judgments: [], serviceSuspension: false, inquiries6m: null, inquiries12m: null, score: null };
}
