/**
 * What the formula does not say.
 *
 * A study measures what a lender's terms give a client. Two things stay outside it: what a lender
 * may ask for beyond its printed terms (a medical report, a classified employer, a clearance letter),
 * and the ways to a larger amount. Each way is computed again on the engine, so its effect is a
 * number and not a promise.
 *
 * The conditions here are general market practice. What the office learns about one lender is kept
 * with that lender's rules.
 */
import { SAMA } from "../finance/sama";
import { capacity } from "./capacity";
import { study } from "./study";
import type { Check, Obligation, Product, Profile, Study, StudyVerdict } from "./types";

/** `block` stops every application until it is dealt with. */
export type ConditionLevel = "block" | "warn" | "info";
/** Where a condition comes from: SAMA's rules, or what lenders do in practice. */
export type ConditionSource = "SAMA" | "MARKET";

type None = Record<string, never>;

/** Something a lender may ask for, or hold against the client, that no term of a product shows. */
export type Condition = { level: ConditionLevel; source: ConditionSource } & (
  | { code: "MEDICAL"; params: { age: number | null; ageAtEnd: number | null; largeAmount: boolean } }
  | { code: "YOUNG_FOR_MORTGAGE"; params: None }
  | { code: "ENDS_AFTER_RETIREMENT"; params: { ageAtEnd: number } }
  | { code: "STEP_DOWN"; params: { retirementAge: number; months: number; pension: number; installmentAfter: number } }
  | { code: "RESIDENT"; params: None }
  | { code: "RESIDENT_MORTGAGE"; params: None }
  | { code: "EMPLOYER_NOT_LISTED"; params: None }
  | { code: "SHORT_SERVICE"; params: { months: number } }
  | { code: "GOSI_MATCH"; params: None }
  | { code: "ALLOWANCES"; params: { basic: number; total: number } }
  | { code: "SELF_EMPLOYED"; params: None }
  | { code: "MILITARY"; params: None }
  | { code: "RETIRED"; params: None }
  | { code: "RECORD_LATE"; params: None }
  | { code: "RECORD_DEFAULT"; params: None }
  | { code: "RECORD_UNKNOWN"; params: None }
  | { code: "TRANSFER_LOCK"; params: { bank: string; sameBank: boolean } }
  | { code: "CARDS"; params: None }
  | { code: "TOP_UP"; params: None }
  | { code: "SECOND_HOME"; params: None }
  | { code: "HOUSING_SUPPORT"; params: None }
  | { code: "VALUATION"; params: None }
  | { code: "CAR_COSTS"; params: None }
  | { code: "CARD_LIMIT"; params: None }
  | { code: "LIVING_COSTS"; params: None }
  | { code: "ONE_AT_A_TIME"; params: None }
);

export type ConditionCode = Condition["code"];

/** A mortgage at or above this age usually brings a medical disclosure. */
export const MEDICAL_AGE = 50;
/** A mortgage that ends after this age usually brings one too. */
export const MEDICAL_AGE_AT_END = 65;
/** And so does an amount above this. */
export const MEDICAL_AMOUNT = 2_500_000;
/** Below this age a mortgage lender looks for stability first. */
export const YOUNG_AGE = 25;
/** Service shorter than this, in a private employer, is asked about. */
export const SERVICE_ASKED_MONTHS = 12;
/** Service shorter than this is inside the probation most lenders refuse. */
export const PROBATION_MONTHS = 3;
/** A basic salary below this share of the total means allowances carry the income. */
export const ALLOWANCE_HEAVY_SHARE = 0.6;
/** Below this salary a lender weighs the cost of living against the regulatory room. */
export const LIVING_COST_SALARY = 8000;
/** A stepped installment is worth saying when the pension carries less than this share of it. */
const STEP_DOWN_SHARE = 0.95;
/** And is a warning when the pension carries less than this share of the installment before it. */
const STEP_DOWN_WARN_SHARE = 0.5;

/** The name each salary bank goes by, as it appears inside a lender's full name. */
const BANK_SHORT_NAME: Record<string, string> = {
  rajhi: "الراجحي",
  snb: "الأهلي",
  riyad: "الرياض",
  sab: "الأول",
  anb: "العربي",
  alinma: "الإنماء",
  albilad: "البلاد",
  aljazira: "الجزيرة",
  saib: "الاستثمار",
  bsf: "الفرنسي",
};

/** The short name of a salary bank, or the code itself when the bank is not one we name. */
export const bankShortName = (code: string): string => BANK_SHORT_NAME[code] ?? code;

const LEVEL_ORDER: Record<ConditionLevel, number> = { block: 0, warn: 1, info: 2 };

type RetireCheck = Extract<Check, { code: "RETIRES_IN_TERM" }>;

/** What lenders may ask for that the study's numbers do not show, the ones that stop an application first. */
export function hiddenConditions(p: Profile, s: Study): Condition[] {
  const found: Condition[] = [];
  const best = s.matches.find((m) => m.verdict !== "fail");
  const mortgage = p.financeType === "mortgage";
  const tenor = best?.tenor ?? p.requestedTenor ?? (mortgage ? 300 : 60);
  const ageAtEnd = p.age != null ? p.age + tenor / 12 : null;
  const amount = best?.offerPrincipal ?? p.requestedAmount ?? 0;
  const salary = p.totalSalary ?? p.basicSalary ?? 0;
  const privateEmployer = p.sector === "private" || p.sector === "private_approved";

  // Age and health.
  if (mortgage && p.age != null) {
    const old = p.age >= MEDICAL_AGE;
    const endsLate = ageAtEnd != null && ageAtEnd > MEDICAL_AGE_AT_END;
    const large = amount > MEDICAL_AMOUNT;
    if (old || endsLate || large)
      found.push({ code: "MEDICAL", level: "warn", source: "MARKET", params: { age: old ? p.age : null, ageAtEnd: endsLate ? Math.round(ageAtEnd) : null, largeAmount: large } });
    if (p.age < YOUNG_AGE) found.push({ code: "YOUNG_FOR_MORTGAGE", level: "info", source: "MARKET", params: {} });
  }
  if (!mortgage && ageAtEnd != null && ageAtEnd > SAMA.retirementAge && p.sector !== "retired" && p.sector !== "self")
    found.push({ code: "ENDS_AFTER_RETIREMENT", level: "warn", source: "MARKET", params: { ageAtEnd: Math.round(ageAtEnd) } });

  // Retirement inside a mortgage: the installment steps down to what the pension carries.
  const stepped = s.matches.find((m) => m.retirement && m.retirement.after < m.installment * STEP_DOWN_SHARE);
  const said = stepped?.checks.find((c): c is RetireCheck => c.code === "RETIRES_IN_TERM");
  if (stepped?.retirement && said)
    found.push({
      code: "STEP_DOWN",
      level: stepped.retirement.after < stepped.retirement.before * STEP_DOWN_WARN_SHARE ? "warn" : "info",
      source: "MARKET",
      params: said.params,
    });

  // Nationality.
  if (p.nationality === "non_saudi") {
    found.push({ code: "RESIDENT", level: "info", source: "MARKET", params: {} });
    if (mortgage) found.push({ code: "RESIDENT_MORTGAGE", level: "warn", source: "MARKET", params: {} });
  }

  // The employer and the income.
  if (p.sector === "private") found.push({ code: "EMPLOYER_NOT_LISTED", level: "warn", source: "MARKET", params: {} });
  if (privateEmployer && p.serviceMonths != null && p.serviceMonths < SERVICE_ASKED_MONTHS)
    found.push({ code: "SHORT_SERVICE", level: p.serviceMonths < PROBATION_MONTHS ? "warn" : "info", source: "MARKET", params: { months: p.serviceMonths } });
  if (privateEmployer) found.push({ code: "GOSI_MATCH", level: "info", source: "MARKET", params: {} });
  if (p.basicSalary && p.totalSalary && p.basicSalary < p.totalSalary * ALLOWANCE_HEAVY_SHARE)
    found.push({ code: "ALLOWANCES", level: "info", source: "MARKET", params: { basic: p.basicSalary, total: p.totalSalary } });
  if (p.sector === "self") found.push({ code: "SELF_EMPLOYED", level: "warn", source: "MARKET", params: {} });
  if (p.sector === "military") found.push({ code: "MILITARY", level: "info", source: "MARKET", params: {} });
  if (p.sector === "retired") found.push({ code: "RETIRED", level: "info", source: "SAMA", params: {} });

  // The credit record, in one word.
  if (p.simah === "late") found.push({ code: "RECORD_LATE", level: "warn", source: "MARKET", params: {} });
  if (p.simah === "default") found.push({ code: "RECORD_DEFAULT", level: "block", source: "MARKET", params: {} });
  if (p.simah === "unknown") found.push({ code: "RECORD_UNKNOWN", level: "info", source: "MARKET", params: {} });

  // What the client already owes, and where the salary goes.
  if (p.salaryBank && p.obligations.some((o) => o.kind !== "card" && o.monthly > 0)) {
    const bank = bankShortName(p.salaryBank);
    const sameBank = p.obligations.some((o) => o.kind !== "mortgage" && !!o.lender && o.lender.includes(bank));
    found.push({ code: "TRANSFER_LOCK", level: "warn", source: "MARKET", params: { bank: p.salaryBank, sameBank } });
  }
  if (p.obligations.some((o) => o.kind === "card")) found.push({ code: "CARDS", level: "info", source: "MARKET", params: {} });
  if (p.financeType === "personal" && p.obligations.some((o) => o.kind === "personal")) found.push({ code: "TOP_UP", level: "info", source: "MARKET", params: {} });

  // The property.
  if (mortgage) {
    if (p.firstHome === false) found.push({ code: "SECOND_HOME", level: "warn", source: "SAMA", params: {} });
    if (p.nationality === "saudi" && !p.housingSupport && p.firstHome !== false && capacity(p).income <= SAMA.lowBracket)
      found.push({ code: "HOUSING_SUPPORT", level: "info", source: "SAMA", params: {} });
    found.push({ code: "VALUATION", level: "info", source: "MARKET", params: {} });
  }
  if (p.financeType === "auto") found.push({ code: "CAR_COSTS", level: "info", source: "MARKET", params: {} });
  if (p.financeType === "card") found.push({ code: "CARD_LIMIT", level: "info", source: "MARKET", params: {} });

  if (salary > 0 && salary < LIVING_COST_SALARY && p.obligations.length > 0) found.push({ code: "LIVING_COSTS", level: "info", source: "SAMA", params: {} });

  found.push({ code: "ONE_AT_A_TIME", level: "info", source: "MARKET", params: {} });

  // A stable sort: within a level the order above is the order shown.
  return found.map((condition, i) => ({ condition, i })).sort((a, b) => LEVEL_ORDER[a.condition.level] - LEVEL_ORDER[b.condition.level] || a.i - b.i).map(({ condition }) => condition);
}

export type Effort = "easy" | "medium" | "hard";

/**
 * A way to a larger amount, with what the engine gives once it is taken.
 * `gain` is the rise over what the client gets today, and can be nothing when only the verdict improves:
 * `lifts` says the verdict after is better than today's.
 */
export type WayOut = { amount: number; gain: number; verdictAfter: StudyVerdict; lifts: boolean; effort: Effort } & (
  | { code: "SETTLE"; params: { index: number; kind: Obligation["kind"]; lender: string | null; monthly: number; remaining: number | null; net: number | null } }
  | { code: "CONSOLIDATE"; params: { remaining: number } }
  | { code: "LONGER_TENOR"; params: { tenor: number } }
  | { code: "CO_BORROWER"; params: { income: number; covers: number | null } }
  | { code: "HOUSING_SUPPORT"; params: None }
  | { code: "CLEAR_RECORD"; params: None }
  | { code: "END_AT_RETIREMENT"; params: { months: number; installment: number } }
);

export type WayOutCode = WayOut["code"];

type KindOf<W> = W extends { code: unknown; params: unknown } ? Pick<W, "code" | "params"> : never;
/** What a way out is, before the engine has said what it gives. */
type WayKind = KindOf<WayOut>;

/** A way out is worth showing when it adds more than this, or lifts the verdict. */
export const WAY_OUT_MIN_GAIN = 1000;
/** How many single obligations are tried, the smallest balance first. */
export const SETTLE_TRIES = 4;
/** The co-borrower income shown when no requested amount says how much is needed. */
export const CO_BORROWER_EXAMPLE = 8000;
/** The largest co-borrower income searched for. */
const CO_BORROWER_CEILING = 60000;
/** A co-borrower's income is said to the nearest of these. */
const CO_BORROWER_STEP = 500;
/** A term cut to end at retirement is offered when that leaves at least this many months. */
const END_AT_RETIREMENT_MIN_MONTHS = 60;

const VERDICT_RANK: Record<StudyVerdict, number> = { not_eligible: 0, pending: 1, conditional: 2, eligible: 3 };

/** The most any product that takes the client would lend. */
export function bestAmount(s: Study): number {
  return s.matches.filter((m) => m.verdict !== "fail").reduce((most, m) => Math.max(most, m.maxPrincipal), 0);
}

/** The ways to a larger amount, the largest gain first. */
export function waysOut(p: Profile, products: Product[], base: Study): WayOut[] {
  const baseAmount = bestAmount(base);
  const out: WayOut[] = [];
  const requested = p.requestedAmount ?? 0;
  const lifts = (s: Study) => VERDICT_RANK[s.verdict] > VERDICT_RANK[base.verdict];
  const attempt = (changed: Profile, effort: Effort, kind: WayKind) => {
    const s = study(changed, products);
    const amount = bestAmount(s);
    const gain = amount - baseAmount;
    if (gain > WAY_OUT_MIN_GAIN || lifts(s)) out.push({ ...kind, amount, gain, verdictAfter: s.verdict, lifts: lifts(s), effort } as WayOut);
  };

  // 1) Pay off or have a lender buy out one obligation that is not a mortgage, the smallest balance first.
  p.obligations
    .map((obligation, index) => ({ obligation, index }))
    .filter(({ obligation }) => obligation.kind !== "mortgage" && obligation.monthly > 0)
    .sort((a, b) => (a.obligation.remaining ?? 1e12) - (b.obligation.remaining ?? 1e12))
    .slice(0, SETTLE_TRIES)
    .forEach(({ obligation, index }) => {
      const s = study({ ...p, obligations: p.obligations.filter((_, j) => j !== index) }, products);
      const amount = bestAmount(s);
      const gain = amount - baseAmount;
      if (gain > WAY_OUT_MIN_GAIN || lifts(s))
        out.push({
          code: "SETTLE",
          params: {
            index,
            kind: obligation.kind,
            lender: obligation.lender || null,
            monthly: obligation.monthly,
            remaining: obligation.remaining || null,
            net: obligation.remaining ? amount - obligation.remaining : null,
          },
          amount,
          gain,
          verdictAfter: s.verdict,
          lifts: lifts(s),
          effort: obligation.kind === "card" ? "easy" : "medium",
        });
    });

  // 2) One lender buys every consumer debt and gives one longer installment.
  const consumer = p.obligations.filter((o) => o.kind !== "mortgage" && o.monthly > 0);
  if (consumer.length > 1)
    attempt({ ...p, obligations: p.obligations.filter((o) => o.kind === "mortgage") }, "medium", {
      code: "CONSOLIDATE",
      params: { remaining: consumer.reduce((sum, o) => sum + (o.remaining ?? 0), 0) },
    });

  // 3) The longest term the lender allows.
  if (p.requestedTenor) attempt({ ...p, requestedTenor: null }, "easy", { code: "LONGER_TENOR", params: { tenor: p.requestedTenor } });

  // 4) A co-borrower, for a mortgage: the smallest income that covers what is asked, when something is asked.
  if (p.financeType === "mortgage" && !p.coIncome) {
    const target = requested > baseAmount ? requested : 0;
    let needed: number | null = null;
    if (target) {
      const reaches = (coIncome: number) => bestAmount(study({ ...p, coIncome }, products)) >= target;
      let low = 0;
      let high = CO_BORROWER_CEILING;
      if (reaches(high)) {
        for (let k = 0; k < 18; k++) {
          const middle = (low + high) / 2;
          if (reaches(middle)) high = middle;
          else low = middle;
        }
        needed = Math.ceil(high / CO_BORROWER_STEP) * CO_BORROWER_STEP;
      }
    }
    const income = needed ?? CO_BORROWER_EXAMPLE;
    attempt({ ...p, coIncome: income }, "medium", { code: "CO_BORROWER", params: { income, covers: needed != null ? requested : null } });
  }

  // 5) Housing support.
  if (p.financeType === "mortgage" && p.nationality === "saudi" && !p.housingSupport)
    attempt({ ...p, housingSupport: true }, "medium", { code: "HOUSING_SUPPORT", params: {} });

  // 6) A clean record.
  if (p.simah === "late" || p.simah === "default") attempt({ ...p, simah: "clean" }, "hard", { code: "CLEAR_RECORD", params: {} });

  // 7) A term that ends at retirement: a higher installment that never steps down.
  const stepped = base.matches.find((m) => m.retirement && m.retirement.after < m.installment * STEP_DOWN_SHARE)?.retirement;
  if (stepped && stepped.atMonth >= END_AT_RETIREMENT_MIN_MONTHS) {
    const s = study({ ...p, requestedTenor: stepped.atMonth }, products);
    const first = s.matches.find((m) => m.verdict !== "fail");
    if (first) {
      const amount = bestAmount(s);
      out.push({ code: "END_AT_RETIREMENT", params: { months: stepped.atMonth, installment: first.installment }, amount, gain: amount - baseAmount, verdictAfter: s.verdict, lifts: lifts(s), effort: "easy" });
    }
  }

  return out.map((way, i) => ({ way, i })).sort((a, b) => b.way.gain - a.way.gain || a.i - b.i).map(({ way }) => way);
}

/** A study with what the formula does not say. */
export interface Advised extends Study {
  conditions: Condition[];
  ways: WayOut[];
  /** The most any product that takes the client would lend today. */
  bestAmount: number;
}

/** Studies a client, then adds what lenders may ask for and the ways to a larger amount. */
export function advise(p: Profile, products: Product[]): Advised {
  const s = study(p, products);
  return { ...s, conditions: hiddenConditions(p, s), ways: waysOut(p, products, s), bestAmount: bestAmount(s) };
}
