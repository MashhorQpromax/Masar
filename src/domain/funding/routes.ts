/**
 * Who funds a deal's new financing.
 *
 * After the settlement the client goes to a lender for the new mortgage, the new personal finance,
 * or both. A route is one way to do that: one lender's product for each part the deal's structure
 * has. Every route is held against the client (would the lender take them?) and then run through the
 * deal engine on that lender's terms (does the deal close, and what is left for the client?).
 *
 * Everything in this module is pure: no database, no clock, no text in any language.
 */
import { dealStudy, splitItems, STRUCTURES, structureOf, type Borrower, type CreditFlags, type DealInput, type DealStudy } from "../deal";
import { capacity, matchProduct, SECTORS, type Check, type CheckStatus, type Nationality, type Product, type Profile, type Sector } from "../eligibility";
import { CREDIT_RULES, type CreditAnalysis, type CreditReport } from "../credit";
import { aprOf, installmentFor } from "../finance/amortization";
import { SAMA } from "../finance/sama";
import { round2 } from "../shared/num";

/** What a lender will read on the client's credit record once the deal has settled what it settles. */
export interface RecordAfter {
  /** A SIMAH report was read. Without one, only what the deal itself settles is known. */
  known: boolean;
  /** A default or a court order stays unpaid. */
  open: boolean;
  /** Months since the newest default was paid in full: 0 when this deal pays it. Null when the record shows none. */
  settledMonthsAgo: number | null;
  /** Payments were late recently. Paying the debt off does not remove them. */
  delays: boolean;
}

/** What the credit record says today, as far as a route needs it. */
export interface KnownRecord {
  /** A default, a court order or a service suspension stands unpaid. */
  unpaid: boolean;
  /** Months since the newest default was paid in full, while it still marks the record. Null when none does. */
  settledMonthsAgo: number | null;
  delays: boolean;
}

/** The facts of a graded credit record that decide whether a lender takes the client. */
export function knownRecord(report: CreditReport, analysis: CreditAnalysis): KnownRecord {
  const ages = (report.facilities ?? [])
    .filter((f) => f.status === "settled" && (f.defaultAmount ?? 0) > 0)
    .map((f) => f.settledMonthsAgo ?? 0)
    // An older one no longer marks the record: the grading reads it as clean.
    .filter((age) => age < CREDIT_RULES.settledMarksLateMonths);
  return {
    unpaid: analysis.standing === "default",
    settledMonthsAgo: ages.length ? Math.min(...ages) : null,
    delays: analysis.stats.recentDelays > 0,
  };
}

const isOrder = (kind: string) => kind === "execution" || kind === "default";

/** The record as it will read after the deal settles what it settles. */
export function recordAfterSettlement(input: Pick<DealInput, "items" | "structure">, known: KnownRecord | null): RecordAfter {
  const { active, kept } = splitItems(input);
  const settlesOne = active.some((i) => isOrder(i.kind));
  return {
    known: known != null,
    // Left outside the deal, or on the record with nothing in the deal that pays it.
    open: kept.some((i) => isOrder(i.kind)) || (!!known?.unpaid && !settlesOne),
    settledMonthsAgo: settlesOne ? 0 : (known?.settledMonthsAgo ?? null),
    delays: !!known?.delays,
  };
}

/** What a lender asks about the person, beyond what the deal engine needs. */
export interface Applicant {
  nationality: Nationality;
  /** The code of the bank the salary is paid into. */
  salaryBank: string | null;
  record: RecordAfter;
}

type PersonCheck = Extract<Check, { key: "salary" | "sector" | "nationality" | "age" | "service" | "transfer" }>;

type RecordCode = "RECORD_CLEAN" | "RECORD_UNKNOWN" | "RECORD_LATE" | "RECORD_OPEN" | "SETTLED_ACCEPTED" | "SETTLED_UNCONFIRMED";
type RecordCheck = { [C in RecordCode]: { key: "simah"; status: CheckStatus; code: C; params: Record<string, never> } }[RecordCode];

/** One condition of a route. The person's conditions are the eligibility engine's; the record and the pairing are this module's. */
export type RouteCheck =
  | PersonCheck
  | RecordCheck
  | { key: "simah"; status: "fail"; code: "SETTLED_WAIT"; params: { months: number } }
  | { key: "transfer"; status: "fail"; code: "TWO_SALARY_TRANSFERS"; params: Record<string, never> };

/** One part of a route: a product, what it would lend in this deal, and its conditions. */
export interface RouteLeg {
  product: Product;
  amount: number;
  installment: number;
  months: number;
  /** The product's ceiling is what holds the amount. */
  atCeiling: boolean;
  checks: RouteCheck[];
}

/** The fields of a deal that a route decides. Applying a route writes exactly these. */
export type RouteTerms = Partial<
  Pick<
    DealInput,
    | "targetBank"
    | "mortgageApr"
    | "mortgageMaxAge"
    | "mortgageMaxMonths"
    | "ltvPct"
    | "mortgageCeiling"
    | "personalFlat"
    | "personalMonths"
    | "personalCeiling"
    | "personalLender"
    | "personalLenderKind"
  >
>;

/** A condition, with the lender that sets it. */
export interface RouteNote {
  lender: string;
  check: RouteCheck;
}

export interface FundingRoute {
  /** Names the route's products. Stable while the catalogue is. */
  key: string;
  mortgage: RouteLeg | null;
  personal: RouteLeg | null;
  /** Both parts come from one lender. */
  oneLender: boolean;
  /** `fail` when a lender would refuse, `warn` when it takes the client on a condition. */
  status: CheckStatus;
  conditions: RouteNote[];
  refusals: RouteNote[];
  terms: RouteTerms;
  /** The deal on this route's terms. */
  study: DealStudy;
  /** The deal closes on this route. */
  closes: boolean;
  /** Every product's terms were confirmed with its lender. */
  verified: boolean;
}

/** A flat rate as the reducing rate that gives the same installment. */
function flatAsReducing(rate: number, months: number): number {
  return aprOf(100000, installmentFor(100000, months, rate, "flat"), months);
}

/** A reducing rate as the flat rate that gives the same installment. */
function reducingAsFlat(rate: number, months: number): number {
  const installment = installmentFor(100000, months, rate, "reducing");
  return round2((((installment * months) / 100000 - 1) / (months / 12)) * 100);
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

const sectorOf = (sector: string): Sector => ((SECTORS as readonly string[]).includes(sector) ? (sector as Sector) : "gov");

const PERSON_KEYS = new Set(["salary", "sector", "nationality", "age", "service", "transfer"]);

/** The lender's conditions on the person, from the eligibility engine. */
function personChecks(product: Product, borrower: Borrower, who: Applicant, months: number): PersonCheck[] {
  const profile: Profile = {
    age: borrower.age,
    nationality: who.nationality,
    sector: sectorOf(borrower.sector),
    serviceMonths: borrower.serviceMonths,
    basicSalary: borrower.basicSalary,
    totalSalary: borrower.totalSalary,
    salaryBank: who.salaryBank,
    simah: "clean",
    financeType: product.financeType,
    requestedTenor: months,
    obligations: [],
  };
  return matchProduct(profile, capacity(profile), product).checks.filter((c): c is PersonCheck => PERSON_KEYS.has(c.key));
}

/** Whether the lender takes the record the client will have after the settlement. */
export function recordChecks(product: Product, record: RecordAfter): RouteCheck[] {
  const none = {} as Record<string, never>;
  if (record.open) return [{ key: "simah", status: "fail", code: "RECORD_OPEN", params: none }];
  const checks: RouteCheck[] = [];
  if (record.settledMonthsAgo != null) {
    const wait = product.settledDefaultWaitMonths;
    const left = wait == null ? 0 : Math.max(0, wait - record.settledMonthsAgo);
    if (wait == null) checks.push({ key: "simah", status: "warn", code: "SETTLED_UNCONFIRMED", params: none });
    else if (left > 0) checks.push({ key: "simah", status: "fail", code: "SETTLED_WAIT", params: { months: left } });
    else checks.push({ key: "simah", status: "pass", code: "SETTLED_ACCEPTED", params: none });
  }
  if (record.delays) checks.push({ key: "simah", status: product.acceptsLateSimah ? "warn" : "fail", code: "RECORD_LATE", params: none });
  if (!record.known) checks.push({ key: "simah", status: "warn", code: "RECORD_UNKNOWN", params: none });
  else if (!checks.length) checks.push({ key: "simah", status: "pass", code: "RECORD_CLEAN", params: none });
  return checks;
}

const worst = (checks: { status: CheckStatus }[]): CheckStatus =>
  checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "warn") ? "warn" : "pass";

interface Args {
  input: DealInput;
  borrower: Borrower;
  who: Applicant;
  products: Product[];
  credit?: CreditFlags | null;
}

function route(args: Args, mortgageProduct: Product | null, personalProduct: Product | null): FundingRoute {
  const { input, borrower, who } = args;
  const terms: RouteTerms = {};
  let personalMonths = 0;

  if (mortgageProduct) {
    const m = mortgageProduct;
    terms.targetBank = m.lenderName;
    terms.mortgageApr = clamp(m.rateType === "reducing" ? m.rate : flatAsReducing(m.rate, m.maxTenor), 0, 30);
    terms.mortgageMaxAge = clamp(Math.round(m.maxAgeAtMaturity), 40, 90);
    terms.mortgageMaxMonths = clamp(Math.round(m.maxTenor), 12, 420);
    terms.ltvPct = Math.min(input.ltvPct, m.maxLtv ?? 100);
    terms.mortgageCeiling = m.maxAmount;
  }
  if (personalProduct) {
    const p = personalProduct;
    // The term a lender gives ends before its age limit.
    const byAge = borrower.age != null ? (p.maxAgeAtMaturity - borrower.age) * 12 : Infinity;
    personalMonths = clamp(Math.floor(Math.min(p.maxTenor, SAMA.consumerMaxTenor, input.personalMonths || SAMA.consumerMaxTenor, byAge > 0 ? byAge : Infinity)), 1, 120);
    if (!mortgageProduct) terms.targetBank = p.lenderName;
    terms.personalFlat = clamp(p.rateType === "flat" ? p.rate : reducingAsFlat(p.rate, personalMonths), 0, 30);
    terms.personalMonths = personalMonths;
    terms.personalCeiling = p.maxAmount;
    terms.personalLender = p.lenderName;
    terms.personalLenderKind = p.lenderType === "bank" ? "bank" : "finance_co";
  }

  // Lenders are compared on their own terms: an offer already recorded on the deal belongs to one of them only.
  const study = dealStudy({ ...input, ...terms, bankMortgage: null, bankPersonal: null }, borrower, args.credit);
  const f = study.financing;

  const mortgage: RouteLeg | null = mortgageProduct
    ? {
        product: mortgageProduct,
        amount: f.mortgage,
        installment: Math.round(Math.min(f.mortgagePre, installmentFor(f.mortgage, f.mortgageMonths, terms.mortgageApr ?? 0, "reducing"))),
        months: f.mortgageMonths,
        atCeiling: f.mortgageCeiling != null,
        checks: [...personChecks(mortgageProduct, borrower, who, mortgageProduct.maxTenor), ...recordChecks(mortgageProduct, who.record)],
      }
    : null;
  const personal: RouteLeg | null = personalProduct
    ? {
        product: personalProduct,
        amount: f.personal,
        installment: Math.round(installmentFor(f.personal, f.personalMonths, terms.personalFlat ?? 0, "flat")),
        months: f.personalMonths,
        atCeiling: f.personalCeiling != null,
        checks: [...personChecks(personalProduct, borrower, who, personalMonths), ...recordChecks(personalProduct, who.record)],
      }
    : null;

  const oneLender = !mortgage || !personal || mortgage.product.lenderId === personal.product.lenderId;
  const notes: RouteNote[] = [];
  const seen = new Set<string>();
  for (const leg of [mortgage, personal]) {
    if (!leg) continue;
    for (const check of leg.checks) {
      // One lender asks a thing once, whichever of its two products raised it.
      // What the record itself lacks is said once: it is the same for every lender.
      const id = check.code === "RECORD_UNKNOWN" || check.code === "RECORD_OPEN" ? check.code : `${leg.product.lenderId}:${check.code}`;
      // A term cut short by the age limit is already in the leg's months and amount: nothing the client has to meet.
      if (check.status === "pass" || check.code === "TENOR_SHORTENED" || seen.has(id)) continue;
      seen.add(id);
      notes.push({ lender: leg.product.lenderName, check });
    }
  }
  // A salary goes to one lender only.
  if (mortgage && personal && !oneLender && mortgage.product.requiresSalaryTransfer && personal.product.requiresSalaryTransfer) {
    notes.push({ lender: personal.product.lenderName, check: { key: "transfer", status: "fail", code: "TWO_SALARY_TRANSFERS", params: {} } });
  }

  return {
    key: [mortgageProduct ? `m${mortgageProduct.id}` : "", personalProduct ? `p${personalProduct.id}` : ""].filter(Boolean).join("-"),
    mortgage,
    personal,
    oneLender,
    status: worst(notes.map((n) => n.check)),
    conditions: notes.filter((n) => n.check.status === "warn"),
    refusals: notes.filter((n) => n.check.status === "fail"),
    terms,
    study,
    closes: study.verdict === "go" || study.verdict === "tight",
    verified: [mortgageProduct, personalProduct].every((p) => !p || !!p.verified),
  };
}

const monthly = (r: FundingRoute) => (r.mortgage?.installment ?? 0) + (r.personal?.installment ?? 0);

/**
 * A route a lender would take ranks above one it would refuse, a deal that closes above one that does
 * not, then by what the client keeps. Equal routes are told apart by how little they ask of the client.
 */
function better(a: FundingRoute, b: FundingRoute): number {
  const open = (r: FundingRoute) => (r.status === "fail" ? 0 : 1);
  return (
    open(b) - open(a) ||
    Number(b.closes) - Number(a.closes) ||
    (open(a) ? 0 : a.refusals.length - b.refusals.length) ||
    b.study.clientNet - a.study.clientNet ||
    Number(b.oneLender) - Number(a.oneLender) ||
    a.conditions.length - b.conditions.length ||
    monthly(a) - monthly(b)
  );
}

/**
 * Every way the catalogue can fund the deal, best first.
 *
 * A deal with a mortgage gets one route per mortgage product, paired with the personal product that
 * serves it best when the structure has personal finance too. A deal without a mortgage gets one
 * route per personal product.
 */
export function fundingRoutes(args: Args): FundingRoute[] {
  const st = STRUCTURES[structureOf(args.input)];
  const mortgages = args.products.filter((p) => p.financeType === "mortgage");
  const personals = args.products.filter((p) => p.financeType === "personal");

  let routes: FundingRoute[];
  if (st.mortgage && st.personal) {
    routes = mortgages.flatMap((m) => {
      const pairs = personals.map((p) => route(args, m, p)).sort(better);
      return pairs[0] ? [pairs[0]] : [];
    });
  } else if (st.mortgage) {
    routes = mortgages.map((m) => route(args, m, null));
  } else {
    routes = personals.map((p) => route(args, null, p));
  }
  return routes.sort(better);
}
