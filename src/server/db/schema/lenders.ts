import { boolean, date, index, integer, jsonb, text, uniqueIndex } from "drizzle-orm/pg-core";
import { at, createdAt, id, masar, money, percent } from "./_shared";
import { users } from "./identity";

export const lenderType = masar.enum("lender_type", ["bank", "finance_company"]);
export const lenderRuleKind = masar.enum("lender_rule_kind", ["condition", "exception", "tip", "warning"]);

export const lenders = masar.table("lenders", {
  id: id(),
  name: text().notNull(),
  type: lenderType().notNull(),
  bankCode: text(),
  contact: text(),
  active: boolean().notNull().default(true),
});

export const products = masar.table(
  "products",
  {
    id: id(),
    lenderId: integer()
      .notNull()
      .references(() => lenders.id, { onDelete: "cascade" }),
    financeType: text().notNull(),
    name: text().notNull(),
    minSalary: money().notNull().default(4000),
    minAge: integer().notNull().default(20),
    maxAgeAtMaturity: integer().notNull().default(60),
    minServiceMonths: integer().notNull().default(3),
    sectors: jsonb().$type<string[]>().notNull(),
    nationalities: jsonb().$type<string[]>().notNull().default(["saudi"]),
    maxTenor: integer().notNull().default(60),
    maxAmount: money().notNull().default(500000),
    rate: percent().notNull(),
    rateType: text().notNull().default("flat"),
    requiresSalaryTransfer: boolean().notNull().default(true),
    acceptsLateSimah: boolean().notNull().default(false),
    /**
     * Months the lender waits after a default was paid before it takes the client. 0 means it takes
     * them at once with the clearance letter. Null means nobody has confirmed it with the lender.
     */
    settledDefaultWaitMonths: integer(),
    maxLtv: percent(),
    notes: text(),
    /**
     * When the whole product was marked confirmed, before each term kept its own source. Nothing reads
     * it as a confirmation any more: `term_sources` says what can be relied on.
     */
    verifiedAt: at(),
    active: boolean().notNull().default(true),
  },
  (t) => [index("products_lender_idx").on(t.lenderId)],
);

/** Conditions, exceptions and tips learned about a lender, including ones no brochure mentions. */
export const lenderRules = masar.table("lender_rules", {
  id: id(),
  lenderId: integer().references(() => lenders.id, { onDelete: "cascade" }),
  financeType: text(),
  kind: lenderRuleKind().notNull(),
  title: text().notNull(),
  body: text(),
  userId: integer().references(() => users.id, { onDelete: "set null" }),
  active: boolean().notNull().default(true),
  createdAt: createdAt(),
});

/**
 * What confirmed a term of a product, and when the office checked it. One row per product and term:
 * confirming again replaces it, and the audit log keeps what stood before. A term with no row here
 * is unconfirmed, whatever its value says.
 */
export const termSources = masar.table(
  "term_sources",
  {
    id: id(),
    productId: integer()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    term: text().notNull(),
    kind: text().notNull(),
    reference: text().notNull(),
    /** The day the office checked the source, as a day in Riyadh. */
    confirmedOn: date({ mode: "string" }).notNull(),
    userId: integer().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("term_sources_product_term_idx").on(t.productId, t.term)],
);

/**
 * What a lender asks beyond the terms every product has: no less than an amount, no more than so
 * many credit inquiries, a contract of a certain kind, an employer on its list, a guarantor. A row
 * is never rewritten: a condition that turned out wrong is taken off (`active` false) and written
 * again, so an answer always speaks of the words it was given for. Every change to the list puts
 * the term `special` back to unconfirmed.
 */
export const productConditions = masar.table(
  "product_conditions",
  {
    id: id(),
    productId: integer()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    /** For a condition a person answers: the lender's words, when there is more to say than its kind. */
    text: text(),
    /** The least the lender finances. */
    amount: money(),
    /** The most credit inquiries the lender accepts, within `months`. */
    count: integer(),
    months: integer(),
    /** The kinds of contract the lender takes. */
    contracts: jsonb().$type<string[]>(),
    /** For a condition a person answers: whether a client who does not meet it is refused, or has something to do. */
    unmet: text().notNull().default("block"),
    active: boolean().notNull().default(true),
    userId: integer().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("product_conditions_product_idx").on(t.productId)],
);
