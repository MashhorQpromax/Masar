import { boolean, index, integer, text } from "drizzle-orm/pg-core";
import { at, createdAt, id, masar } from "./_shared";
import { clients, documents } from "./clients";
import { users } from "./identity";

export const messageDirection = masar.enum("message_direction", ["in", "out"]);

export const waMessages = masar.table(
  "wa_messages",
  {
    id: id(),
    clientId: integer().references(() => clients.id, { onDelete: "set null" }),
    direction: messageDirection().notNull(),
    /** Message id from the WhatsApp Cloud API. Unique, so a repeated webhook is ignored. */
    waId: text().unique(),
    phone: text().notNull(),
    name: text(),
    type: text().notNull().default("text"),
    body: text(),
    docId: integer().references(() => documents.id, { onDelete: "set null" }),
    status: text(),
    error: text(),
    userId: integer().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [index("wa_messages_client_idx").on(t.clientId, t.createdAt), index("wa_messages_phone_idx").on(t.phone)],
);

/** Links that let a client follow their file and upload documents without an account. */
export const shareLinks = masar.table(
  "share_links",
  {
    id: id(),
    /** SHA-256 of the link token. The token itself is only ever in the link. */
    tokenHash: text().notNull().unique(),
    clientId: integer()
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    userId: integer().references(() => users.id, { onDelete: "set null" }),
    expiresAt: at().notNull(),
    revoked: boolean().notNull().default(false),
    views: integer().notNull().default(0),
    lastViewAt: at(),
    createdAt: createdAt(),
  },
  (t) => [index("share_links_client_idx").on(t.clientId)],
);
