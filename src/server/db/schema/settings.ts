import { integer, jsonb, text } from "drizzle-orm/pg-core";
import { createdAt, masar } from "./_shared";
import { users } from "./identity";

/**
 * The office's own settings, one row a subject (`fees` holds the fee policy). A subject with no row
 * stands at its default, written in the code beside the subject.
 */
export const officeSettings = masar.table("office_settings", {
  key: text().primaryKey(),
  value: jsonb().$type<Record<string, unknown>>().notNull(),
  /** Who set it last. The audit log keeps every change with what it was before. */
  userId: integer().references(() => users.id, { onDelete: "set null" }),
  updatedAt: createdAt(),
});
