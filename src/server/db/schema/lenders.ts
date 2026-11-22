import { boolean, index, integer, jsonb, text } from "drizzle-orm/pg-core";
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
    /** When the criteria were last confirmed with the lender. Null means indicative only. */
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
