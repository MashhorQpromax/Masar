import { customType, integer, numeric, pgSchema, timestamp } from "drizzle-orm/pg-core";

/**
 * Every table lives in its own Postgres schema. It keeps the rebuild apart from the old tables
 * in `public`, and Supabase does not expose it through its public API.
 */
export const masar = pgSchema("masar");

export const id = () => integer().primaryKey().generatedByDefaultAsIdentity();

/** Riyals with halalas. Exact in storage. */
export const money = () => numeric({ precision: 14, scale: 2, mode: "number" });

/** A percent or an annual rate, such as 5.5 or 12.5. */
export const percent = () => numeric({ precision: 6, scale: 3, mode: "number" });

export const at = () => timestamp({ withTimezone: true, mode: "date" });

export const createdAt = () => at().notNull().defaultNow();

export const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
});
