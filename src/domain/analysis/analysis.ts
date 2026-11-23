import type { CreditReport, Finding } from "../credit";
import { runningFinance } from "../deal";
import {
  amountsOpen,
  capacity,
  conflictChecks,
  eligibilityOf,
  eligibilityRank,
  findingOf,
  fitScore,
  incomeOf,
  leansBlocked,
  listCheck,
  matchProduct,
  openTerms,
  study,
  tell,
  TERMS,
  weakestStrength,
  type Capacity,
  type Check,
  type CheckStatus,
  type Eligibility,
  type Inquiries,
  type Obligation,
  type PaperFact,
  type Point,
  type Product,
  type ProductKind,
  type Profile,
  type Term,
} from "../eligibility";
import { knownRecord, recordChecks, ROUTE_RULES, type RecordAfter, type RouteCheck } from "../funding";
import type { AnalysisVerdict, Burden, ClientAnalysis, Commitment, FileFacts, Fit, FitCheck, Gap, Income, KindFit, Mark, Reading, RecordFacts, Step } from "./types";

/** A report at least this many months old may no longer show what the client owes. */
export const STALE_REPORT_MONTHS = 3;

/**
 * Whole months from the day a report was issued to a later day, both as yyyy/mm/dd. A month is
 * complete on the same day of the next month. Never negative.
 */
export function reportAgeMonths(issued: string, today: string): number {
  const [y1 = 0, m1 = 0, d1 = 1] = issued.split("/").map(Number);
  const [y2 = 0, m2 = 0, d2 = 1] = today.split("/").map(Number);
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0));
}

/** The kinds of finance every client is studied for: a deal ends in one of them, or in both. */
const ALWAYS: readonly ProductKind[] = ["personal", "mortgage"];

/**
 * The finance a record shows as still being paid, in the order the report lists it. A product is a
 * commitment when the record gives it an installment or a balance, and a card when it gives a limit
 * to draw on. What the record does not give stays empty.
 */
export function commitmentsOf(report: CreditReport): Commitment[] {
  const list: Commitment[] = [];
  for (const { facility: f, kind } of runningFinance(report)) {
    const monthly = (f.installment ?? 0) > 0 ? f.installment! : null;
    const balance = (f.balance ?? 0) > 0 ? f.balance! : null;
    const limit = kind === "card" && (f.limit ?? 0) > 0 ? f.limit! : null;
    if (monthly == null && balance == null && limit == null) continue;
    list.push({ kind: kind ?? "other", lender: f.lender, product: f.product, monthly, balance, limit, late: f.status === "late" });
  }
  return list;
}

/** The client as the eligibility engine studies them for one kind of finance, with what the record says they pay. */
function profileFor(kind: ProductKind, file: FileFacts, obligations: Obligation[], inquiries: Inquiries): Profile {
  const asked = file.request?.kind === kind ? file.request : null;
  return {
    age: file.age,
    nationality: file.nationality,
    sector: file.sector,
    serviceMonths: file.serviceMonths,
    basicSalary: file.basicSalary || null,
    totalSalary: file.totalSalary || null,
    otherIncome: file.otherIncome,
    salaryBank: file.salaryBank,
    // The record is held against each lender apart, on that lender's own terms.
    simah: "clean",
    housingSupport: file.housingSupport,
    financeType: kind,
    requestedAmount: asked?.amount || null,
    requestedTenor: asked?.tenor || null,
    obligations,
    propertyValue: kind === "mortgage" ? file.propertyValue : null,
    coIncome: file.coIncome,
    contractType: file.contractType,
    inquiries,
    answers: file.answers,
  };
}

const REFUSES: Record<CheckStatus, number> = { pass: 0, warn: 0, fail: 1 };

/** A fit with the engine's score for it, which orders the list and is not shown. */
type Scored = Fit & { score: number };

const ofRecord = (check: RouteCheck): check is Extract<RouteCheck, { key: "simah" }> => check.key === "simah";
const ofPerson = (check: Check): check is Exclude<Check, { key: "simah" }> => check.key !== "simah";

/** One product held against the client and one reading of their record. */
function fitOf(profile: Profile, room: Capacity, product: Product, record: RecordAfter, disputed: readonly PaperFact[]): Scored {
  const match = matchProduct(profile, room, product);
  const checks: FitCheck[] = [...match.checks.filter(ofPerson), ...recordChecks(product, record).filter(ofRecord)];
  // A term cut short by the lender's age limit is already in the months and the amount: nothing the client has to meet.
  const conditions = checks.filter((check) => check.status === "warn" && check.code !== "TENOR_SHORTENED");
  const refusals = checks.filter((check) => check.status === "fail");
  // The same conditions, each asked whether its answer can be relied on.
  // And whether the lender's list of special conditions is itself complete, and whether the file's own facts are in dispute.
  const findings = [...checks, listCheck(product.special), ...conflictChecks(disputed)].map((check) => findingOf(check, ROUTE_RULES[check.code], product.terms));
  const asked = profile.requestedAmount ?? 0;
  return {
    ...tell(
      findings,
      (finding) => finding,
      () => product.lenderName,
    ),
    eligibility: eligibilityOf(findings),
    blockedAsWritten: leansBlocked(findings),
    strength: weakestStrength(findings),
    estimated: amountsOpen(product.financeType, product.terms),
    score: fitScore({
      fails: refusals.length,
      warns: conditions.length,
      coverage: asked > 0 ? Math.min(1, match.maxPrincipal / asked) : 1,
      apr: match.apr,
      salaryBank: !!product.bankCode && profile.salaryBank === product.bankCode,
    }),
    product,
    status: refusals.length ? "fail" : conditions.length ? "warn" : "pass",
    conditions,
    refusals,
    most: match.maxPrincipal,
    amount: match.offerPrincipal,
    installment: match.installment,
    months: match.tenor,
    apr: match.apr,
    limitedBy: match.limitedBy,
  };
}

const rank = (fit: Fit): number => eligibilityRank(fit.eligibility, fit.blockedAsWritten);
/**
 * How much of a product nobody confirmed. It counts the product's terms, not the conditions this
 * client happened to raise: a lender that asks for less is no closer to being confirmed.
 */
const openTermsOf = (fit: Fit): number => openTerms(fit.product.financeType, fit.product.terms).length;

/**
 * An answer that can be relied on comes before one that cannot, a lender whose unconfirmed terms
 * would take the client before one whose terms would not, and the lender with the fewest terms left
 * to confirm before the others. Then the order of the eligibility engine's score: the bank the salary
 * is paid into, the fewer conditions, the cheaper rate. Among those that refuse, the one with the
 * fewest reasons is the closest. The larger amount settles a tie.
 */
function better(a: Scored, b: Scored): number {
  return (
    rank(b) - rank(a) ||
    openTermsOf(a) - openTermsOf(b) ||
    REFUSES[a.status] - REFUSES[b.status] ||
    (a.status === "fail" ? a.refusals.length - b.refusals.length : 0) ||
    b.score - a.score ||
    b.amount - a.amount ||
    a.apr - b.apr
  );
}

/** A lender that would lend nothing is not a lender that takes the client, whatever its conditions answer. */
const gives = (fit: Fit, result: Eligibility): boolean => fit.eligibility === result && fit.amount > 0;

function reading(profile: Profile, room: Capacity, products: readonly Product[], record: RecordAfter, disputed: readonly PaperFact[]): Reading {
  const fits: Fit[] = products
    .map((product) => fitOf(profile, room, product, record, disputed))
    .sort(better)
    .map(({ score: _score, ...fit }) => fit);
  return {
    record,
    fits,
    open: fits.filter((fit) => gives(fit, "eligible")).length,
    conditional: fits.filter((fit) => gives(fit, "conditional")).length,
    unsure: fits.filter((fit) => fit.eligibility === "needs_verification").length,
  };
}

/** The best result any lender gives. A lender nobody confirmed never makes the client eligible, and never makes them refused. */
const verdictOf = (readings: readonly Reading[]): Eligibility =>
  readings.some((r) => r.open > 0) ? "eligible" : readings.some((r) => r.conditional > 0) ? "conditional" : readings.some((r) => r.unsure > 0) ? "needs_verification" : "not_eligible";

/** Points the eligibility engine makes about the record. Here the record speaks for itself, in more detail. */
const RECORD_POINTS: ReadonlySet<Point["code"]> = new Set(["CLEAN_RECORD", "LATE_RECORD", "DEFAULT_RECORD"]);
/** Points that are measured on the income. Without one they say nothing. */
const INCOME_POINTS: ReadonlySet<Point["code"]> = new Set(["DEBT_SHARE", "NO_ROOM"]);

/**
 * What the record only notes and a lender may still ask about: a default that was paid, an unpaid
 * phone bill, a delay long past. A middling score or a moderate card balance is neither help nor harm.
 */
const NOTED: ReadonlySet<Finding["code"]> = new Set(["TELECOM_DEFAULTS", "SETTLED_DEFAULT", "OLD_DELAY"]);

const FILE_FACTS = ["INCOME", "AGE", "SERVICE", "SALARY_BANK", "CONTRACT"] as const;

/**
 * Reads a client's file, their SIMAH record and the lenders' terms together.
 *
 * The lenders are held against the record twice when something on it blocks them all: as it reads
 * today, and as it will read once what blocks is paid. Paying a default does not promise a lender's
 * yes: each lender is asked what it does with a client who has just paid one, and a lender nobody
 * asked is a condition, never an acceptance.
 */
export function analyzeClient(args: { file: FileFacts; record: RecordFacts; products: readonly Product[] }): ClientAnalysis {
  const { file, record } = args;
  const { report, analysis } = record;

  const commitments = commitmentsOf(report);
  const obligations: Obligation[] = commitments.flatMap((c) => (c.monthly != null ? [{ kind: c.kind, lender: c.lender, monthly: c.monthly, remaining: c.balance }] : []));
  const uncounted = commitments.filter((c) => c.monthly == null);

  const inquiries: Inquiries = { m6: report.inquiries6m ?? null, m12: report.inquiries12m ?? null };
  const consumer = profileFor("personal", file, obligations, inquiries);
  const counted = incomeOf(consumer);
  const conflicts = file.conflicts ?? [];
  const disputed = conflicts.map((conflict) => conflict.fact);
  // The salary the income is counted from: the total one, or the basic one when the file holds no total.
  const salaryDisputed = disputed.includes(consumer.totalSalary ? "totalSalary" : "basicSalary");
  const income: Income = {
    basis: counted.salary <= 0 ? "missing" : salaryDisputed ? "disputed" : file.incomeVerified ? "verified" : "stated",
    salary: counted.salary,
    basicOnly: !consumer.totalSalary && !!consumer.basicSalary,
    other: counted.other,
    total: counted.total,
  };
  const known = income.basis !== "missing";

  const consumerRoom = capacity(consumer);
  const burden: Burden = {
    monthly: consumerRoom.existingTotal,
    mortgage: consumerRoom.existingMortgage,
    nonMortgage: consumerRoom.existingNonRealEstate,
    share: known ? consumerRoom.currentDbr : null,
    uncounted: uncounted.length,
  };

  // The lenders, kind by kind. Without an income there is no room to measure and nothing to hold them against.
  const blocked = analysis.blockers.length > 0;
  const standing = knownRecord(report, analysis);
  const today: RecordAfter = { known: true, open: blocked, settledMonthsAgo: standing.settledMonthsAgo, delays: standing.delays };
  // What is paid to clear the record leaves a default that was just paid. A suspension or a travel ban that is lifted leaves none.
  const paysDebt = analysis.blockers.some((b) => b.code === "JUDGMENT" || b.code === "ACTIVE_DEFAULT" || b.code === "BOUNCED_CHEQUE");
  const after: RecordAfter | null = blocked ? { known: true, open: false, settledMonthsAgo: paysDebt ? 0 : standing.settledMonthsAgo, delays: standing.delays } : null;

  const asked = file.request?.amount ? file.request.kind : null;
  const wanted = [...new Set<ProductKind>([...(asked ? [asked] : []), ...ALWAYS, ...(file.request ? [file.request.kind] : [])])];
  const kinds: KindFit[] = known
    ? wanted.flatMap((kind) => {
        const offered = args.products.filter((product) => product.financeType === kind);
        if (!offered.length) return [];
        const profile = profileFor(kind, file, obligations, inquiries);
        const room = kind === "personal" ? consumerRoom : capacity(profile);
        return [{ kind, room, today: reading(profile, room, offered, today, disputed), cleared: after ? reading(profile, room, offered, after, disputed) : null }];
      })
    : [];

  // Nothing is to be relied on, or taken to a lender, before the client has agreed to their data being processed.
  const pending = !file.consent || !known || !kinds.length || record.confidence === "low";
  const verdict: AnalysisVerdict = pending ? "pending" : verdictOf(kinds.map((k) => k.today));
  const afterClearing = blocked && kinds.length ? verdictOf(kinds.map((k) => k.cleared!)) : null;

  // What helps and what hurts. The file's points come from the eligibility engine, the record's from its grading.
  const points = study(consumer, []);
  const fromFile = (list: Point[]): Mark[] => list.filter((p) => !RECORD_POINTS.has(p.code) && (known || !INCOME_POINTS.has(p.code))).map((point) => ({ source: "file", point }));
  const strengths: Mark[] = [
    ...analysis.findings.filter((f) => f.level === "good").map((finding): Mark => ({ source: "record", finding })),
    // A share measured without every installment is a floor: it cannot be called low.
    ...fromFile(points.strengths).filter((mark) => !(mark.source === "file" && mark.point.code === "DEBT_SHARE" && uncounted.length > 0)),
  ];
  const risks: Mark[] = [
    ...analysis.blockers.map((blocker): Mark => ({ source: "record", blocker })),
    ...analysis.findings.filter((f) => f.level === "block").map((finding): Mark => ({ source: "record", finding })),
    ...analysis.findings.filter((f) => f.level === "warn").map((finding): Mark => ({ source: "record", finding })),
    ...analysis.findings.filter((f) => f.level === "info" && NOTED.has(f.code)).map((finding): Mark => ({ source: "record", finding })),
    ...fromFile(points.risks),
  ];

  // What the analysis could not stand on. A fact in dispute comes first: every figure below may rest on it.
  const gaps: Gap[] = conflicts.map((conflict) => ({ kind: "conflict", code: "CONFLICT", ...conflict }));
  if (!known) gaps.push({ kind: "missing", code: "INCOME" });
  else {
    if (income.basicOnly) gaps.push({ kind: "missing", code: "TOTAL_SALARY" });
    if (income.basis === "stated") gaps.push({ kind: "unconfirmed", code: "INCOME_PROOF" });
  }
  if (file.age == null) gaps.push({ kind: "missing", code: "AGE" });
  if (file.serviceMonths == null && file.sector !== "retired") gaps.push({ kind: "missing", code: "SERVICE" });
  if (!file.salaryBank) gaps.push({ kind: "missing", code: "SALARY_BANK" });
  // The kind of contract is asked for only where a lender studied makes a condition of it.
  const everyFit = kinds.flatMap((k) => [...k.today.fits, ...(k.cleared?.fits ?? [])]);
  if (everyFit.some((fit) => fit.doubts.some((doubt) => doubt.check.code === "CONTRACT_MISSING"))) gaps.push({ kind: "missing", code: "CONTRACT" });
  for (const c of uncounted) {
    if (c.kind === "card") gaps.push({ kind: "unconfirmed", code: "CARD_SHARE", lender: c.lender, limit: c.limit, balance: c.balance });
    else gaps.push({ kind: "missing", code: "INSTALLMENT", lender: c.lender, product: c.product, balance: c.balance });
  }
  const stale = record.ageMonths != null && record.ageMonths >= STALE_REPORT_MONTHS ? record.ageMonths : null;
  if (stale != null) gaps.push({ kind: "unconfirmed", code: "REPORT_AGE", months: stale });
  const doubted = record.confidence === "low" || record.confidence === "medium" || record.readingWarnings > 0;
  if (doubted) gaps.push({ kind: "unconfirmed", code: "READING", confidence: record.confidence === "low" ? "low" : "medium", warnings: record.readingWarnings });
  const assumed = report.serviceSuspension && !!report.suspensionAssumed;
  if (assumed) gaps.push({ kind: "unconfirmed", code: "SUSPENSION" });
  const studied = kinds.flatMap((k) => k.today.fits.map((fit) => fit.product));
  const unverified = studied.filter((product) => openTerms(product.financeType, product.terms).length > 0).length;
  if (unverified > 0) gaps.push({ kind: "unconfirmed", code: "TERMS", unverified, of: studied.length });
  if (!file.consent) gaps.push({ kind: "missing", code: "CONSENT" });

  // What to do next, in the order it should be done.
  const steps: Step[] = [];
  if (!file.consent) steps.push({ code: "RECORD_CONSENT" });
  const lacking = FILE_FACTS.filter((code) => gaps.some((gap) => gap.code === code));
  if (lacking.length) steps.push({ code: "COMPLETE_FILE", missing: lacking });
  if (disputed.length) steps.push({ code: "SETTLE_CONFLICTS", facts: disputed });
  if (doubted) steps.push({ code: "REVIEW_READING" });
  if (assumed) steps.push({ code: "CONFIRM_SUSPENSION" });
  for (const action of analysis.actions) if (action.code !== "NONE") steps.push({ code: "CREDIT", action });
  if (stale != null && !analysis.actions.some((action) => action.code === "REFRESH_REPORT")) steps.push({ code: "REFRESH_REPORT", months: stale });
  if (known && consumerRoom.available <= 0) {
    // The smallest debt frees its installment soonest. One whose balance the record does not give is not the one to name.
    const smallest = commitments
      .filter((c) => c.kind !== "mortgage" && c.monthly != null && c.balance != null)
      .sort((a, b) => a.balance! - b.balance!)[0];
    if (smallest) steps.push({ code: "FREE_ROOM", lender: smallest.lender, kind: smallest.kind, monthly: smallest.monthly! });
  }
  // Where to go, kind by kind: the best lender today, or the best one once the record is cleared.
  const picks = kinds.flatMap((k) => {
    const now = k.today.fits[0];
    const later = k.cleared?.fits[0];
    const pick = now && now.status !== "fail" ? { fit: now, afterClearing: false } : later && later.status !== "fail" ? { fit: later, afterClearing: true } : null;
    return pick && pick.fit.amount > 0 ? [{ kind: k.kind, ...pick }] : [];
  });
  // A lender whose terms nobody confirmed is asked first, and before the office pays anything on the strength of them.
  const confirms: Extract<Step, { code: "CONFIRM_TERMS" }>[] = [];
  // What a lender asks about the client and nobody has answered is asked of the client first: it costs nothing either.
  const asks: Extract<Step, { code: "ASK_CLIENT" }>[] = [];
  for (const { fit, afterClearing } of picks) {
    const open = fit.doubts.flatMap((doubt) => (doubt.check.code === "ASKED_OPEN" ? [doubt.check.params] : []));
    if (!open.length) continue;
    const lender = fit.product.lenderName;
    const same = asks.find((step) => step.lender === lender && step.beforePaying === afterClearing);
    if (!same) asks.push({ code: "ASK_CLIENT", lender, questions: open, beforePaying: afterClearing });
    else same.questions.push(...open.filter((q) => !same.questions.some((known) => known.kind === q.kind && known.text === q.text)));
  }
  for (const { kind, fit, afterClearing } of picks) {
    const open = fit.doubts.flatMap((doubt): Term[] => (doubt.doubt !== "FACT_MISSING" && doubt.term ? [doubt.term] : []));
    if (!open.length) continue;
    const lender = fit.product.lenderName;
    const same = confirms.find((step) => step.lender === lender && step.beforePaying === afterClearing);
    if (!same) confirms.push({ code: "CONFIRM_TERMS", lender, kinds: [kind], terms: TERMS.filter((term) => open.includes(term)), beforePaying: afterClearing });
    else Object.assign(same, { kinds: [...same.kinds, kind], terms: TERMS.filter((term) => same.terms.includes(term) || open.includes(term)) });
  }
  const applies: Step[] = picks.map(({ kind, fit, afterClearing }) => {
    // What the result waits on: a term nobody confirmed, or only the client's own file.
    const termsOpen = fit.doubts.some((doubt) => doubt.doubt !== "FACT_MISSING");
    return {
      code: "APPLY",
      kind,
      lender: fit.product.lenderName,
      product: fit.product.name,
      amount: fit.amount,
      installment: fit.installment,
      months: fit.months,
      eligibility: fit.eligibility,
      afterClearing,
      termsOpen,
      estimated: fit.estimated && !termsOpen,
    };
  });
  // Asking a lender costs nothing and clearing a record does: what must be asked first goes ahead of what the record needs.
  const early = [...asks, ...confirms].filter((step) => step.beforePaying);
  const clearing = steps.findIndex((step) => step.code === "CREDIT");
  steps.splice(clearing >= 0 ? clearing : steps.length, 0, ...early);
  if (applies.length && income.basis === "stated") steps.push({ code: "VERIFY_INCOME" });
  steps.push(...[...asks, ...confirms].filter((step) => !step.beforePaying), ...applies);

  return { verdict, afterClearing, income, commitments, burden, kinds, strengths, risks, gaps, steps };
}
