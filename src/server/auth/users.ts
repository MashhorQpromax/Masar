import "server-only";
import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { passwordProblem, ROLES, type Role } from "@/domain/auth";
import { normalizePhone } from "@/domain/shared/phone";
import type { Db, Tx } from "../db/client";
import { passkeys, sessions, users } from "../db/schema";
import type { Actor } from "../shared/actor";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";
import { hashPassword } from "./password";
import { endSessionsOf, requireConfirmed } from "./sessions";

const userSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().pipe(z.email().max(200)),
  role: z.enum(ROLES),
  phone: z.string().trim().max(20).nullish(),
});

/**
 * Who is changing an account: the person, and the session they act from. A script run on the server
 * acts as the system, in nobody's name, and has no session.
 */
export interface By {
  actor: Actor;
  /** The session cookie as sent. */
  sessionToken?: string | null;
}

/**
 * Whoever changes someone's account has typed their own password within the last few minutes, the
 * rule a person's own ways in follow. A session opened by a passkey or a code, or one left open on a
 * desk, cannot make an account or take one over until the password is typed again. The rule is here,
 * in the services, so no screen can skip it.
 */
async function requireManagerConfirmed(tx: Tx, by: By, now: Date): Promise<void> {
  if (by.actor.userId == null) return;
  await requireConfirmed(tx, by.sessionToken, by.actor.userId, now);
}

/** Refuses a new password that is too short, or longer than what is actually checked. */
export function checkPassword(password: string): void {
  const problem = passwordProblem(password);
  if (problem) throw new DomainError(problem);
}

/** Adds a person to the office. The password is hashed here and never stored or logged as typed. */
export async function createUser(
  db: Db,
  args: By & { name: string; email: string; role: string; password: string; phone?: string | null; now?: Date },
): Promise<{ id: number }> {
  const now = args.now ?? new Date();
  const parsed = userSchema.safeParse(args);
  if (!parsed.success) throw new DomainError("INVALID_INPUT", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const { name, email, role } = parsed.data;
  // Kept in the one form the rest of the system keeps a mobile in.
  const phone = parsed.data.phone ? normalizePhone(parsed.data.phone) : null;
  if (parsed.data.phone && !phone) throw new DomainError("BAD_PHONE");
  checkPassword(args.password);
  // What was typed is checked first, and the password is asked for before anything is read or made:
  // whether an address already has an account is not said to a session that has not confirmed.
  await requireManagerConfirmed(db, args, now);
  const passwordHash = await hashPassword(args.password);

  return db.transaction(async (tx) => {
    const [taken] = await tx.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, email));
    if (taken) throw new DomainError("EMAIL_TAKEN");
    const [user] = await tx.insert(users).values({ name, email, role, phone, passwordHash, createdAt: now, updatedAt: now }).returning({ id: users.id });
    await audit(tx, args.actor, "user.create", "user", user!.id, { role });
    return { id: user!.id };
  });
}

export interface UserLine {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  /** The mobile that receives the WhatsApp sign-in code, as stored. */
  phone: string | null;
  lastLoginAt: Date | null;
  /** Locked after repeated wrong attempts, until this moment. */
  lockedUntil: Date | null;
  authenticator: boolean;
  passkeys: number;
  /** Devices signed in right now. */
  sessions: number;
}

/** Everyone with an account, the people who can still enter first, then by name. */
export async function listUsers(db: Db, now: Date = new Date()): Promise<UserLine[]> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      active: users.active,
      phone: users.phone,
      lastLoginAt: users.lastLoginAt,
      lockedUntil: users.lockedUntil,
      authenticator: users.totpEnabled,
      // The outer table is named in full: inside a query of one table a column is written bare, and a bare "id" would be the inner table's.
      passkeys: sql<number>`(select count(*) from ${passkeys} p where p.user_id = "users"."id")`.mapWith(Number),
      sessions: sql<number>`(select count(*) from ${sessions} s where s.user_id = "users"."id" and s.expires_at > ${now.toISOString()}::timestamptz)`.mapWith(Number),
    })
    .from(users)
    .orderBy(desc(users.active), asc(users.name), asc(users.id));
  return rows.map((row) => ({ ...row, lockedUntil: row.lockedUntil && row.lockedUntil > now ? row.lockedUntil : null }));
}

async function userById(tx: Tx, userId: number) {
  const [user] = await tx.select().from(users).where(eq(users.id, userId));
  if (!user) throw new DomainError("NOT_FOUND", `user ${userId}`);
  return user;
}

const changeSchema = z.object({
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
  /** An empty text removes the number. */
  phone: z.string().trim().max(20).optional(),
});

/**
 * Changes what a person may do, whether they may enter at all, or the mobile their sign-in code goes
 * to. Nobody changes their own role or stops their own account, so the office is never left without
 * someone who can manage it. A stopped account is signed out everywhere at once.
 */
export async function updateUser(
  db: Db,
  args: By & { userId: number; change: unknown; now?: Date },
): Promise<{ changed: string[] }> {
  const parsed = changeSchema.safeParse(args.change);
  if (!parsed.success) throw new DomainError("INVALID_INPUT", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const change = parsed.data;
  const now = args.now ?? new Date();
  let phone: string | null | undefined;
  if (change.phone !== undefined) {
    phone = change.phone === "" ? null : normalizePhone(change.phone);
    if (change.phone !== "" && !phone) throw new DomainError("BAD_PHONE");
  }

  return db.transaction(async (tx) => {
    await requireManagerConfirmed(tx, args, now);
    const before = await userById(tx, args.userId);
    const own = args.actor.userId === before.id;
    const roleChanges = change.role !== undefined && change.role !== before.role;
    const activeChanges = change.active !== undefined && change.active !== before.active;
    if (own && (roleChanges || activeChanges)) throw new DomainError("OWN_ACCOUNT");
    const phoneChanges = phone !== undefined && phone !== (before.phone ? (normalizePhone(before.phone) ?? before.phone) : null);

    const changed = [roleChanges && "role", activeChanges && "active", phoneChanges && "phone"].filter((field): field is string => !!field);
    if (!changed.length) return { changed };
    await tx
      .update(users)
      .set({
        ...(roleChanges ? { role: change.role } : {}),
        ...(activeChanges ? { active: change.active } : {}),
        ...(phoneChanges ? { phone } : {}),
        updatedAt: now,
      })
      .where(eq(users.id, before.id));
    if (activeChanges && change.active === false) await endSessionsOf(tx, before.id);
    // The role and the state are not private, so the log says what they became. A phone is, so it says only that it changed.
    await audit(tx, args.actor, "user.update", "user", before.id, {
      changed,
      ...(roleChanges ? { role: { from: before.role, to: change.role } } : {}),
      ...(activeChanges ? { active: change.active } : {}),
    });
    return { changed };
  });
}

/**
 * Gives a person a new password when they have lost theirs. They are signed out everywhere and any
 * lock is lifted, so the new password works at once. A person changes their own from their account,
 * where the current password is asked for.
 */
export async function resetPassword(db: Db, args: By & { userId: number; password: string; now?: Date }): Promise<void> {
  const now = args.now ?? new Date();
  if (args.actor.userId === args.userId) throw new DomainError("OWN_ACCOUNT");
  checkPassword(args.password);
  await requireManagerConfirmed(db, args, now);
  const passwordHash = await hashPassword(args.password);
  await db.transaction(async (tx) => {
    const user = await userById(tx, args.userId);
    await tx.update(users).set({ passwordHash, failedLogins: 0, lockedUntil: null, updatedAt: now }).where(eq(users.id, user.id));
    await endSessionsOf(tx, user.id);
    await audit(tx, args.actor, "user.password_reset", "user", user.id);
  });
}

/**
 * Takes away every way in except the password: the authenticator and every passkey. For a person who
 * lost the phone that held them. They are signed out everywhere and any lock is lifted.
 */
export async function resetSignIn(db: Db, args: By & { userId: number; now?: Date }): Promise<{ passkeys: number; authenticator: boolean }> {
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    if (args.actor.userId === args.userId) throw new DomainError("OWN_ACCOUNT");
    await requireManagerConfirmed(tx, args, now);
    const user = await userById(tx, args.userId);
    const gone = await tx.delete(passkeys).where(eq(passkeys.userId, user.id)).returning({ id: passkeys.id });
    await tx
      .update(users)
      .set({ totpSecret: null, totpEnabled: false, totpLastStep: 0, otpFails: 0, failedLogins: 0, lockedUntil: null, updatedAt: now })
      .where(eq(users.id, user.id));
    await endSessionsOf(tx, user.id);
    const removed = { passkeys: gone.length, authenticator: user.totpEnabled };
    await audit(tx, args.actor, "user.signin_reset", "user", user.id, removed);
    return removed;
  });
}

/** Lifts the lock that repeated wrong attempts put on an account, without waiting for it to pass. */
export async function unlockUser(db: Db, args: By & { userId: number; now?: Date }): Promise<void> {
  const now = args.now ?? new Date();
  await db.transaction(async (tx) => {
    await requireManagerConfirmed(tx, args, now);
    const user = await userById(tx, args.userId);
    await tx.update(users).set({ failedLogins: 0, lockedUntil: null, otpFails: 0, updatedAt: now }).where(eq(users.id, user.id));
    await audit(tx, args.actor, "user.unlock", "user", user.id);
  });
}
