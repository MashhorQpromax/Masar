import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, text, uniqueIndex } from "drizzle-orm/pg-core";
import { at, createdAt, id, masar } from "./_shared";
import { clients } from "./clients";
import { deals } from "./deals";
import { users } from "./identity";
import { lenders, products } from "./lenders";

export const contactKind = masar.enum("contact_kind", ["email", "whatsapp", "phone", "portal", "visit"]);
export const consentWay = masar.enum("consent_way", ["written", "verbal"]);
export const requestStatus = masar.enum("request_status", ["draft", "approved", "sent", "answered", "closed"]);

/**
 * A way of reaching a lender: an address, a number, a portal or a branch, with the person there when
 * the office knows one. It is used only while it has a source and its check is recent; a way the
 * office stops using is switched off, never deleted, so a request sent through it still says where.
 */
export const lenderContacts = masar.table(
  "lender_contacts",
  {
    id: id(),
    lenderId: integer()
      .notNull()
      .references(() => lenders.id, { onDelete: "cascade" }),
    kind: contactKind().notNull(),
    value: text().notNull(),
    /** Who answers there, and what they do. */
    person: text(),
    /** Where the office got it: the lender's letter, its site, a business card. Null: nobody said. */
    source: text(),
    /** The day someone checked it still reaches the lender, as a day in Riyadh. */
    checkedOn: date({ mode: "string" }),
    checkedBy: integer().references(() => users.id, { onDelete: "set null" }),
    active: boolean().notNull().default(true),
    userId: integer().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("lender_contacts_lender_idx").on(t.lenderId)],
);

/**
 * A client's consent to the office sharing their data with one lender. Withdrawing it is kept as the
 * day it was withdrawn: the row stays, so what was sent before it can still be accounted for.
 */
export const shareConsents = masar.table(
  "share_consents",
  {
    id: id(),
    clientId: integer()
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    lenderId: integer()
      .notNull()
      .references(() => lenders.id, { onDelete: "cascade" }),
    way: consentWay().notNull(),
    note: text(),
    givenOn: date({ mode: "string" }).notNull(),
    withdrawnAt: at(),
    userId: integer().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("share_consents_client_idx").on(t.clientId, t.lenderId)],
);

/**
 * A deal's request to one lender: the message the office prepared from the file, who approved it,
 * when a person sent it and to which way of reaching the lender, and how it ended. The system sends
 * nothing itself. One request is open for a client and a lender at a time.
 */
export const lenderRequests = masar.table(
  "lender_requests",
  {
    id: id(),
    dealId: integer()
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    clientId: integer()
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    lenderId: integer()
      .notNull()
      .references(() => lenders.id, { onDelete: "cascade" }),
    mortgageProductId: integer().references(() => products.id, { onDelete: "set null" }),
    personalProductId: integer().references(() => products.id, { onDelete: "set null" }),
    /** The funding route the request was prepared on: its products, as the catalogue names them. */
    routeKey: text().notNull(),
    status: requestStatus().notNull().default("draft"),
    /** The message as it was prepared. It never changes: a file that moved needs a new request. */
    message: text().notNull(),
    /** What the message tells the lender, as it was read from the file, and its print. */
    shared: jsonb().$type<Record<string, unknown>>().notNull(),
    print: text().notNull(),
    preparedBy: integer().references(() => users.id, { onDelete: "set null" }),
    approvedBy: integer().references(() => users.id, { onDelete: "set null" }),
    approvedAt: at(),
    sentBy: integer().references(() => users.id, { onDelete: "set null" }),
    /** The day a person sent it, as a day in Riyadh. */
    sentOn: date({ mode: "string" }),
    contactId: integer().references(() => lenderContacts.id, { onDelete: "set null" }),
    /** Where it went, as it read that day: the way stays readable if it is changed later. */
    sentTo: jsonb().$type<{ kind: string; value: string; person: string | null }>(),
    answeredAt: at(),
    closedAt: at(),
    closeReason: text(),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [
    index("lender_requests_deal_idx").on(t.dealId),
    index("lender_requests_status_idx").on(t.status),
    uniqueIndex("lender_requests_open_idx")
      .on(t.clientId, t.lenderId)
      .where(sql`${t.status} in ('draft', 'approved', 'sent')`),
  ],
);
