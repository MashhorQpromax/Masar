/**
 * The study of a project that asks for finance against its land and its income: a hotel, a residential
 * or a commercial building. Nothing here reads a salary. What can be lent follows from what the land
 * is worth, what the build costs and what the finished project earns.
 *
 * The shares and rates below are estimates from market practice, as the system that ran before the
 * rebuild used them. They size a first answer and never stand in for a lender's own valuation.
 *
 * Everything in this module is pure: no database, no clock, no text in any language.
 */

export const BORROWER_TYPES = ["individual", "company"] as const;
export type BorrowerType = (typeof BORROWER_TYPES)[number];

/** How the land is held: in the property register, as an electronic deed, or on paper. */
export const DEEDS = ["registered", "electronic", "paper"] as const;
export type Deed = (typeof DEEDS)[number];

export const PROJECT_TYPES = ["hotel", "residential", "commercial", "mixed"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

/** What the money is for: building, cash against the land, or both. */
export const PURPOSES = ["build", "cashout", "build_cashout"] as const;
export type Purpose = (typeof PURPOSES)[number];

/** What is known about a project. Anything not known yet is null, and the study says what it needs. */
export interface ProjectFacts {
  borrowerType: BorrowerType | null;
  city: string | null;
  district: string | null;
  /** Square metres. */
  landArea: number | null;
  /** The land as the owner's valuer priced it. */
  landValue: number | null;
  valuer: string | null;
  valuationDate: string | null;
  deed: Deed | null;
  projectType: ProjectType | null;
  purpose: Purpose | null;
  constructionCost: number | null;
  /** Built area allowed, in square metres. */
  gfa: number | null;
  /** Hotel rooms. */
  keys: number | null;
  /** Average price of a room for a night. */
  adr: number | null;
  /** Share of rooms sold over a year, in percent. */
  occupancy: number | null;
  /** Cash the owner puts in beside the land. */
  equityCash: number | null;
  /** In the central area around one of the two holy mosques. */
  nearHaram: boolean;
  hasPermit: boolean;
  hasFeasibility: boolean;
  /** The land is already mortgaged to someone. */
  existingLien: boolean;
}

export const EMPTY_PROJECT: ProjectFacts = {
  borrowerType: null,
  city: null,
  district: null,
  landArea: null,
  landValue: null,
  valuer: null,
  valuationDate: null,
  deed: null,
  projectType: null,
  purpose: null,
  constructionCost: null,
  gfa: null,
  keys: null,
  adr: null,
  occupancy: null,
  equityCash: null,
  nearHaram: false,
  hasPermit: false,
  hasFeasibility: false,
  existingLien: false,
};

/** What a hotel sells beside its rooms (food, services), as a share of room revenue. */
export const HOTEL_OTHER_REVENUE = 0.15;
/** What is left of a hotel's revenue after running it. */
export const HOTEL_MARGIN = 0.4;
/** The yearly rate and the years a debt is taken to run after the grace period, for the cover of its service. */
export const DEBT_RATE = 0.075;
export const DEBT_YEARS = 10;
/** Lenders usually ask that income covers the debt's service this many times. */
export const MIN_DSCR = 1.25;
/** A price for a square metre above this is one a lender's valuers may cut. */
export const HIGH_PRICE_PER_M2 = 100_000;
/** Cash against raw land rarely passes this share of its value, in percent. */
export const CASH_LTV_LIMIT = 50;
/** A request above this share of the land's value is weak as it stands, in percent. */
export const WEAK_LTV = 70;
/** A bank's share of the whole cost (land and build) in a development finance. */
export const DEV_SHARE = 0.6;
/** The same when only the build's cost is known. */
export const DEV_SHARE_OF_BUILD = 0.7;
/** Cash a bank gives against land, as a share of its value. */
export const CASH_SHARE = 0.45;
/** A property fund is worth setting up from this size. */
export const FUND_MIN = 50_000_000;
/** This many critical gaps and the file cannot be judged yet. */
export const GAPS_BEFORE_VERDICT = 4;

export const PROJECT_VERDICTS = ["feasible", "feasible_restructure", "needs_info", "weak"] as const;
export type ProjectVerdict = (typeof PROJECT_VERDICTS)[number];

export type AlertLevel = "block" | "warn" | "info";
export const ALERT_CODES = ["DEED_UNREGISTERED", "NEAR_HARAM", "INDIVIDUAL_BORROWER", "HIGH_LAND_PRICE", "CASH_ABOVE_LAND_LIMIT", "ABOVE_BUILD_COST", "EXISTING_LIEN", "LOW_COVER"] as const;
export type AlertCode = (typeof ALERT_CODES)[number];

/** Something that stands in the way, or that a lender will ask about. Each has a way out, said in words. */
export type ProjectAlert =
  | { code: "DEED_UNREGISTERED"; level: "block"; /** Null when nobody said how the land is held. */ deed: Deed | null }
  | { code: "NEAR_HARAM"; level: "warn" }
  | { code: "INDIVIDUAL_BORROWER"; level: "warn"; /** False when nobody said who borrows. */ known: boolean }
  | { code: "HIGH_LAND_PRICE"; level: "warn"; pricePerM2: number }
  | { code: "CASH_ABOVE_LAND_LIMIT"; level: "warn"; ltv: number }
  | { code: "ABOVE_BUILD_COST"; level: "info"; amount: number }
  | { code: "EXISTING_LIEN"; level: "warn" }
  | { code: "LOW_COVER"; level: "warn"; dscr: number };

export const STRUCTURE_IDS = ["dev", "tdf", "cashout", "jv", "fund", "prelease"] as const;
export type StructureId = (typeof STRUCTURE_IDS)[number];
export type Fit = "high" | "medium" | "low";

/** One way the project could be financed, how well it fits, and the amount it could raise when that can be estimated. */
export interface ProjectStructure {
  id: StructureId;
  fit: Fit;
  amount: number | null;
}

export const GAP_CODES = [
  "BORROWER_TYPE",
  "DEED_COPY",
  "BUILD_COST",
  "BUILT_AREA",
  "ROOMS",
  "FEASIBILITY",
  "PERMIT",
  "VALUATION_REPORT",
  "STATEMENTS",
  "CREDIT_REPORT",
  "OWNER_CASH",
  "USE_OF_FUNDS",
  "OPERATOR_LETTER",
  "NO_EXPROPRIATION",
] as const;
export type GapCode = (typeof GAP_CODES)[number];

/** A paper or a fact the file still needs. A critical one holds the verdict back. */
export interface ProjectGap {
  code: GapCode;
  critical: boolean;
}

export interface ProjectStudy {
  requested: number;
  /** Land and build together. Null until both are known. */
  totalCost: number | null;
  /** The request over the land's value, in percent with one decimal. */
  ltv: number | null;
  /** The request over the whole cost, in percent with one decimal. */
  ltc: number | null;
  /** The owner's share of the whole cost (the land and the cash), in percent with one decimal. */
  equityPct: number | null;
  pricePerM2: number | null;
  /** What the request asks for beyond the build's cost. */
  cashoutPart: number | null;
  /** A hotel's estimated yearly income after running costs. */
  noi: number | null;
  /** That income over a year of the debt's service. */
  dscr: number | null;
  verdict: ProjectVerdict;
  alerts: ProjectAlert[];
  structures: ProjectStructure[];
  gaps: ProjectGap[];
}

const pct1 = (share: number): number => Math.round(share * 1000) / 10;

/** A hotel's yearly room revenue: rooms, the price of a night, and the share of nights sold. */
export function roomRevenue(keys: number, adr: number, occupancy: number): number {
  return keys * adr * 365 * (occupancy / 100);
}

/** A year of payments on a debt, at the rate and over the years the study assumes. */
export function yearlyDebtService(amount: number): number {
  const r = DEBT_RATE / 12;
  const n = DEBT_YEARS * 12;
  return amount * (r / (1 - Math.pow(1 + r, -n))) * 12;
}

const NOTHING_HELD: ReadonlySet<GapCode> = new Set();

/**
 * Studies a project against the amount it asks for.
 *
 * `held` names the gaps the file already answers with papers a person checked. Those are not asked
 * for again, and no longer hold the verdict back. With nothing held the study reads the facts alone.
 */
export function projectStudy(x: ProjectFacts, requested: number, held: ReadonlySet<GapCode> = NOTHING_HELD): ProjectStudy {
  const land = x.landValue ?? 0;
  const build = x.constructionCost ?? 0;
  const totalCost = land && build ? land + build : null;
  const ltv = land ? pct1(requested / land) : null;
  const ltc = totalCost ? pct1(requested / totalCost) : null;
  const equityPct = totalCost ? pct1((land + (x.equityCash ?? 0)) / totalCost) : null;
  const pricePerM2 = land && x.landArea ? Math.round(land / x.landArea) : null;
  const cashoutPart = build ? Math.max(0, requested - build) : null;
  const hotel = x.projectType === "hotel";

  let noi: number | null = null;
  let dscr: number | null = null;
  if (hotel && x.keys && x.adr && x.occupancy) {
    noi = Math.round(roomRevenue(x.keys, x.adr, x.occupancy) * (1 + HOTEL_OTHER_REVENUE) * HOTEL_MARGIN);
    // A request of nothing has no debt to cover.
    if (requested > 0) dscr = Math.round((noi / yearlyDebtService(requested)) * 100) / 100;
  }

  const wantsCash = x.purpose === "cashout" || x.purpose === "build_cashout";
  const alerts: ProjectAlert[] = [];
  if (x.deed !== "registered") alerts.push({ code: "DEED_UNREGISTERED", level: "block", deed: x.deed });
  if (x.nearHaram) alerts.push({ code: "NEAR_HARAM", level: "warn" });
  if (x.borrowerType !== "company") alerts.push({ code: "INDIVIDUAL_BORROWER", level: "warn", known: x.borrowerType != null });
  if (pricePerM2 != null && pricePerM2 > HIGH_PRICE_PER_M2) alerts.push({ code: "HIGH_LAND_PRICE", level: "warn", pricePerM2 });
  if (ltv != null && ltv > CASH_LTV_LIMIT && wantsCash) alerts.push({ code: "CASH_ABOVE_LAND_LIMIT", level: "warn", ltv });
  if (cashoutPart != null && cashoutPart > 0) alerts.push({ code: "ABOVE_BUILD_COST", level: "info", amount: cashoutPart });
  if (x.existingLien) alerts.push({ code: "EXISTING_LIEN", level: "warn" });
  if (dscr != null && dscr < MIN_DSCR) alerts.push({ code: "LOW_COVER", level: "warn", dscr });

  const gaps: ProjectGap[] = [];
  const need = (code: GapCode, critical = true) => {
    if (!held.has(code)) gaps.push({ code, critical });
  };
  if (!x.borrowerType) need("BORROWER_TYPE");
  // Asked of every file. It holds the verdict back only while the deed is not in the register.
  need("DEED_COPY", x.deed !== "registered");
  if (!x.constructionCost) need("BUILD_COST");
  if (!x.gfa) need("BUILT_AREA");
  if (hotel && !x.keys) need("ROOMS");
  if (!x.hasFeasibility) need("FEASIBILITY");
  if (!x.hasPermit) need("PERMIT");
  need("VALUATION_REPORT", !x.valuer);
  need("STATEMENTS");
  need("CREDIT_REPORT");
  need("OWNER_CASH", !x.equityCash);
  need("USE_OF_FUNDS");
  if (hotel) need("OPERATOR_LETTER", false);
  if (x.nearHaram) need("NO_EXPROPRIATION");

  const structures: ProjectStructure[] = [];
  structures.push({
    id: "dev",
    fit: x.borrowerType === "company" || build ? "high" : "medium",
    amount: totalCost ? Math.min(requested, Math.round(totalCost * DEV_SHARE)) : build ? Math.round(build * DEV_SHARE_OF_BUILD) : null,
  });
  if (hotel) structures.push({ id: "tdf", fit: "high", amount: totalCost ? Math.round(totalCost * DEV_SHARE) : null });
  structures.push({ id: "cashout", fit: x.deed === "registered" ? "medium" : "low", amount: land ? Math.round(land * CASH_SHARE) : null });
  structures.push({ id: "jv", fit: "medium", amount: null });
  structures.push({ id: "fund", fit: requested >= FUND_MIN ? "medium" : "low", amount: null });
  if (hotel) structures.push({ id: "prelease", fit: "medium", amount: null });

  const critical = gaps.filter((gap) => gap.critical).length;
  const verdict: ProjectVerdict =
    critical >= GAPS_BEFORE_VERDICT ? "needs_info" : (ltv ?? 0) > WEAK_LTV ? "weak" : (cashoutPart ?? 0) > 0 || (ltv ?? 0) > CASH_LTV_LIMIT ? "feasible_restructure" : "feasible";

  return { requested, totalCost, ltv, ltc, equityPct, pricePerM2, cashoutPart, noi, dscr, verdict, alerts, structures, gaps };
}
