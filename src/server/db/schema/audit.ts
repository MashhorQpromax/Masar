import { bigint, index, integer, jsonb, text } from "drizzle-orm/pg-core";
import { createdAt, masar } from "./_shared";
import { users } from "./identity";

/** Who did what, to which record, and when. Written by every service that changes data. */
export const auditLog = masar.table(
  "audit_log",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    userId: integer().references(() => users.id, { onDelete: "set null" }),
    action: text().notNull(),
    entity: text(),
    entityId: integer(),
    details: jsonb().$type<Record<string, unknown>>(),
    ip: text(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_entity_idx").on(t.entity, t.entityId), index("audit_log_created_idx").on(t.createdAt)],
);
