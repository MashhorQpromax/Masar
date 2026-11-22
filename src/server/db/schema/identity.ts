import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, text, uniqueIndex } from "drizzle-orm/pg-core";
import { at, createdAt, id, masar } from "./_shared";

export const userRole = masar.enum("user_role", ["admin", "analyst", "officer", "viewer"]);

export const users = masar.table(
  "users",
  {
    id: id(),
    name: text().notNull(),
    email: text().notNull(),
    passwordHash: text().notNull(),
    role: userRole().notNull(),
    active: boolean().notNull().default(true),
    /** Mobile number that receives the WhatsApp sign-in code. */
    phone: text(),
    failedLogins: integer().notNull().default(0),
    lockedUntil: at(),
    lastLoginAt: at(),
    totpSecret: text(),
    totpEnabled: boolean().notNull().default(false),
    /** Last accepted authenticator step, so a code cannot be replayed. */
    totpLastStep: integer().notNull().default(0),
    otpFails: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_key").on(sql`lower(${t.email})`)],
);

export const sessions = masar.table(
  "sessions",
  {
    /** SHA-256 of the cookie token. The token itself is never stored. */
    tokenHash: text().primaryKey(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: at().notNull(),
    ip: text(),
    userAgent: text(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

export const passkeys = masar.table(
  "passkeys",
  {
    id: id(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialId: text().notNull().unique(),
    publicKey: text().notNull(),
    counter: bigint({ mode: "number" }).notNull().default(0),
    transports: jsonb().$type<string[]>(),
    name: text(),
    createdAt: createdAt(),
    lastUsedAt: at(),
  },
  (t) => [index("passkeys_user_idx").on(t.userId)],
);

/** One-time sign-in codes sent over WhatsApp. Only the hash is stored. */
export const loginCodes = masar.table(
  "login_codes",
  {
    id: id(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text().notNull(),
    expiresAt: at().notNull(),
    attempts: integer().notNull().default(0),
    used: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("login_codes_user_idx").on(t.userId)],
);
