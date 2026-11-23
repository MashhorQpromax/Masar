import { sql } from "drizzle-orm";
import { boolean, index, integer, text, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { at, createdAt, id, masar, money, percent } from "./_shared";
import { clients } from "./clients";
import { users } from "./identity";

export const dealStage = masar.enum("deal_stage", [
  "study",
  "agreement",
  "settlement",
  "clearance",
  "simah_update",
  "payoff",
  "transfer",
  "bank_submit",
  "approval",
  "disbursement",
  "recovered",
  "closed",
  "lost",
]);
export const dealStructure = masar.enum("deal_structure", ["settle_refi_personal", "settle_personal", "settle_refi"]);
export const dealVerdict = masar.enum("deal_verdict", ["go", "tight", "short", "needs_info"]);
export const dealItemKind = masar.enum("deal_item_kind", [
  "execution",
  "default",
  "mortgage_payoff",
  "personal_payoff",
  "card",
  "other",
]);
export const dealPaidBy = masar.enum("deal_paid_by", ["company", "bank", "out"]);
export const financeBase = masar.enum("finance_base", ["total", "personal", "mortgage", "net"]);
export const lenderKind = masar.enum("lender_kind", ["bank", "finance_co"]);

/**
 * A settle-and-refinance deal. The columns are the inputs of the deal engine
 * (`DealInput` in src/domain/deal), stored one per column so they can be queried and constrained.
 */
export const deals = masar.table(
  "deals",
  {
    id: id(),
    clientId: integer()
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    stage: dealStage().notNull().default("study"),
    structure: dealStructure().notNull().default("settle_refi_personal"),
    propertyValue: money(),
    transferTaxPct: percent().notNull().default(5),
    saleTaxPct: percent().notNull().default(0),
    fixedCosts: money().notNull().default(10000),
    feeSettlePct: percent().notNull().default(10),
    feeSettleIncludesPayoff: boolean().notNull().default(false),
    feeFinancePct: percent().notNull().default(10),
    feeFinanceBase: financeBase().notNull().default("total"),
    feeFixed: money().notNull().default(0),
    targetBank: text(),
    mortgageApr: percent().notNull().default(5.5),
    personalFlat: percent().notNull().default(3),
    personalMonths: integer().notNull().default(60),
    mortgageMaxAge: integer().notNull().default(70),
    mortgageMaxMonths: integer().notNull().default(300),
    ltvPct: percent().notNull().default(90),
    /** The bank's actual offer. Null while the figure is still an estimate. */
    bankMortgage: money(),
    bankPersonal: money(),
    /** The most the chosen lender's product lends. Set when a lender is chosen from the catalogue. */
    mortgageCeiling: money(),
    personalCeiling: money(),
    personalLender: text(),
    personalLenderKind: lenderKind(),
    notes: text().notNull().default(""),

    /** Last result of the engine, kept for lists and the home map. Recomputed on every save. */
    capital: money(),
    fee: money(),
    clientNet: money(),
    verdict: dealVerdict(),
    computedAt: at(),

    ownerId: integer().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [
    index("deals_stage_idx").on(t.stage),
    // A client has at most one deal in progress. Closed and lost deals stay as history.
    uniqueIndex("deals_one_open_per_client").on(t.clientId).where(sql`${t.stage} not in ('closed', 'lost')`),
  ],
);

/** The obligations a deal settles, buys out or leaves outside. */
export const dealItems = masar.table(
  "deal_items",
  {
    id: id(),
    dealId: integer()
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    /** Stable key inside the deal, such as "i3". */
    key: text().notNull(),
    position: integer().notNull(),
    kind: dealItemKind().notNull(),
    label: text().notNull(),
    original: money().notNull().default(0),
    pay: money().notNull().default(0),
    paidBy: dealPaidBy().notNull(),
    /** Confirmed by a liability or clearance letter. */
    confirmed: boolean(),
    monthly: money(),
  },
  (t) => [unique("deal_items_deal_key").on(t.dealId, t.key), index("deal_items_deal_idx").on(t.dealId, t.position)],
);

/** Every stage a deal entered, and when. The timeline and the durations come from here. */
export const dealStageEvents = masar.table(
  "deal_stage_events",
  {
    id: id(),
    dealId: integer()
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    stage: dealStage().notNull(),
    note: text(),
    userId: integer().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("deal_stage_events_deal_idx").on(t.dealId, t.createdAt)],
);
