import { capacity } from "./capacity";
import { matchProduct } from "./match";
import type { Advice, Match, MissingFact, Point, Product, Profile, Study, StudyVerdict } from "./types";

/** Existing obligations at or above this percent of income count against the client. */
export const HEAVY_DEBT_PERCENT = 33;
/** Service shorter than this many months worries every lender. */
export const SHORT_SERVICE_MONTHS = 3;
/** With this many facts missing no verdict is given. */
export const PENDING_MISSING_FACTS = 3;
/** How many lenders the suggested order of applications names. */
const APPLY_ORDER_LENGTH = 3;

/** Products that take the client compete on fit and cost. The ones that refuse come last. */
function rank(m: Match): number {
  return (m.verdict === "fail" ? 0 : 1000) + m.score + (m.verdict === "pass" ? 5 : 0);
}

/** Studies a client against every product of the kind of finance they ask for. */
export function study(p: Profile, products: Product[]): Study {
  const cap = capacity(p);
  const matches = products
    .filter((product) => product.financeType === p.financeType)
    .map((product) => matchProduct(p, cap, product))
    .sort((a, b) => rank(b) - rank(a));

  const missing: MissingFact[] = [];
  if (p.age == null) missing.push("AGE");
  if (!p.totalSalary) missing.push("TOTAL_SALARY");
  if (p.serviceMonths == null && p.sector !== "retired") missing.push("SERVICE");
  if (p.simah === "unknown") missing.push("CREDIT_REPORT");
  if (!p.salaryBank) missing.push("SALARY_BANK");
  if (!p.requestedAmount) missing.push("REQUESTED_AMOUNT");

  const strengths: Point[] = [];
  const risks: Point[] = [];
  const advice: Advice[] = [];
  if (p.sector === "gov" || p.sector === "military" || p.sector === "semi_gov") strengths.push({ code: "STRONG_EMPLOYER" });
  if (p.sector === "private_approved") strengths.push({ code: "APPROVED_EMPLOYER" });
  if (p.sector === "private") risks.push({ code: "UNAPPROVED_EMPLOYER" });
  if (p.simah === "clean") strengths.push({ code: "CLEAN_RECORD" });
  if (p.simah === "late") risks.push({ code: "LATE_RECORD" });
  if (p.simah === "default") {
    risks.push({ code: "DEFAULT_RECORD" });
    advice.push({ code: "CLEAR_DEFAULTS" });
  }
  if (cap.currentDbr > 0) (cap.currentDbr >= HEAVY_DEBT_PERCENT ? risks : strengths).push({ code: "DEBT_SHARE", percent: cap.currentDbr });
  if (cap.available <= 0) {
    risks.push({ code: "NO_ROOM" });
    const smallest = [...p.obligations].filter((o) => o.kind !== "mortgage").sort((a, b) => (a.remaining ?? Infinity) - (b.remaining ?? Infinity))[0];
    if (smallest) advice.push({ code: "PAY_SMALLEST", lender: smallest.lender || null, kind: smallest.kind });
  }
  if (p.serviceMonths != null && p.serviceMonths < SHORT_SERVICE_MONTHS && p.sector !== "retired") risks.push({ code: "SHORT_SERVICE" });
  if (p.salaryBank) advice.push({ code: "SALARY_BANK_FIRST" });

  const eligible = matches.filter((m) => m.verdict === "pass").length;
  const conditional = matches.filter((m) => m.verdict === "warn").length;
  let verdict: StudyVerdict;
  if (missing.length >= PENDING_MISSING_FACTS) verdict = "pending";
  else if (eligible) verdict = "eligible";
  else if (conditional) verdict = "conditional";
  else verdict = "not_eligible";

  const open = matches.filter((m) => m.verdict !== "fail");
  const best = open[0];
  if (best) {
    advice.unshift({ code: "BEST_OPTION", lender: best.product.lenderName, product: best.product.name, amount: best.offerPrincipal, installment: best.installment, tenor: best.tenor });
    // One application after another: several at once pile inquiries on the credit record.
    const order = open.slice(0, APPLY_ORDER_LENGTH).map((m) => m.product.lenderName);
    if (order.length > 1) advice.push({ code: "APPLY_ORDER", lenders: order });
    if (p.requestedAmount && best.maxPrincipal < p.requestedAmount) advice.push({ code: "AMOUNT_ABOVE_POSSIBLE", requested: p.requestedAmount, possible: best.maxPrincipal });
  }
  if (missing.length) advice.push({ code: "COMPLETE_DATA", missing });

  return { capacity: cap, matches, verdict, eligible, conditional, strengths, risks, advice, missing };
}
