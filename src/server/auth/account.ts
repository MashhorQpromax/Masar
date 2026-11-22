import "server-only";
import { eq } from "drizzle-orm";
import { digitsOf } from "@/domain/shared/phone";
import type { Db } from "../db/client";
import { users } from "../db/schema";
import type { Actor } from "../shared/actor";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";
import { hashPassword, verifyPassword } from "./password";
import { listPasskeys, type PasskeyLine } from "./passkeys";
import { seal } from "./secret";
import { confirmSession, endSessionsOf, listSessions, requireConfirmed, type SessionLine } from "./sessions";
import { acceptTotp, CODE_MAX_FAILURES, countFailure, locked, type Origin } from "./signin";
import { newTotpSecret, totpUri } from "./totp";
import { checkPassword } from "./users";

/** What a person does to their own account: prove who they are, change the password, manage the authenticator. */

export interface SecurityState {
  authenticator: boolean;
  /** Signing in by code alone has stopped after wrong codes, until the next sign-in by another way. */
  codeStopped: boolean;
  passkeys: PasskeyLine[];
  sessions: SessionLine[];
}

export async function securityState(db: Db, args: { userId: number; sessionToken: string | null | undefined; now?: Date }): Promise<SecurityState> {
  const now = args.now ?? new Date();
  const [user] = await db.select({ totpEnabled: users.totpEnabled, otpFails: users.otpFails }).from(users).where(eq(users.id, args.userId));
  return {
    authenticator: !!user?.totpEnabled,
    codeStopped: !!user?.totpEnabled && user.otpFails >= CODE_MAX_FAILURES,
    passkeys: await listPasskeys(db, args.userId),
    sessions: await listSessions(db, args.userId, args.sessionToken, now),
  };
}

/**
 * The person types their password again before changing how the account is opened. It stops someone
 * who finds a device signed in from adding their own fingerprint to it. Wrong passwords here count
 * against the account like wrong passwords at the door.
 */
export async function confirmIdentity(
  db: Db,
  args: { userId: number; sessionToken: string | null | undefined; password: string; origin: Origin; actor: Actor; now?: Date },
): Promise<void> {
  const now = args.now ?? new Date();
  await provePassword(db, args.userId, args.password, args.origin, now, "confirm");
  await db.transaction(async (tx) => {
    await tx.update(users).set({ failedLogins: 0 }).where(eq(users.id, args.userId));
    await confirmSession(tx, args.sessionToken, now);
    await audit(tx, args.actor, "user.confirm", "user", args.userId);
  });
}

/** The typed password is the account's own, or the try counts against the account as it would at the door. */
async function provePassword(db: Db, userId: number, password: string, origin: Origin, now: Date, method: string): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new DomainError("NOT_FOUND");
  if (locked(user, now)) throw new DomainError("LOCKED");
  if (!(await verifyPassword(password, user.passwordHash))) {
    await countFailure(db, user.id, origin, now, method);
    throw new DomainError("WRONG_PASSWORD");
  }
}

/**
 * A person changes their own password. Every other session of theirs ends, so a password changed
 * because a device was lost also signs that device out. The session that stays counts as confirmed:
 * its person has just typed the old password.
 */
export async function changeOwnPassword(
  db: Db,
  args: { userId: number; current: string; next: string; sessionToken?: string | null; origin: Origin; actor: Actor; now?: Date },
): Promise<void> {
  const now = args.now ?? new Date();
  await provePassword(db, args.userId, args.current, args.origin, now, "password_change");
  checkPassword(args.next);
  const passwordHash = await hashPassword(args.next);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash, failedLogins: 0, updatedAt: now }).where(eq(users.id, args.userId));
    await endSessionsOf(tx, args.userId, args.sessionToken);
    await confirmSession(tx, args.sessionToken, now);
    await audit(tx, args.actor, "user.password", "user", args.userId);
  });
}

/**
 * Starts linking an authenticator app: a fresh secret that does nothing until the person proves, with a
 * code, that their app holds it. An authenticator that is already on is switched off first, on purpose:
 * starting over must not quietly replace the one that guards the account.
 */
export async function beginAuthenticator(
  db: Db,
  args: { userId: number; sessionToken: string | null | undefined; now?: Date },
): Promise<{ secret: string; uri: string }> {
  await requireConfirmed(db, args.sessionToken, args.userId, args.now ?? new Date());
  const [user] = await db.select().from(users).where(eq(users.id, args.userId));
  if (!user) throw new DomainError("NOT_FOUND");
  if (user.totpEnabled) throw new DomainError("AUTHENTICATOR_ON");
  const secret = newTotpSecret();
  await db.update(users).set({ totpSecret: seal(secret), totpEnabled: false, totpLastStep: 0 }).where(eq(users.id, user.id));
  return { secret, uri: totpUri(secret, user.email) };
}

/** Switches the authenticator on once a code from the app matches the pending secret. */
export async function confirmAuthenticator(
  db: Db,
  args: { userId: number; sessionToken: string | null | undefined; code: string; actor: Actor; now?: Date },
): Promise<void> {
  const now = args.now ?? new Date();
  await db.transaction(async (tx) => {
    await requireConfirmed(tx, args.sessionToken, args.userId, now);
    const [user] = await tx.select().from(users).where(eq(users.id, args.userId));
    if (!user) throw new DomainError("NOT_FOUND");
    if (user.totpEnabled) throw new DomainError("AUTHENTICATOR_ON");
    if (!(await acceptTotp(tx, user, digitsOf(args.code), now, { pending: true }))) throw new DomainError("BAD_CODE");
    await tx.update(users).set({ totpEnabled: true, updatedAt: now }).where(eq(users.id, user.id));
    await audit(tx, args.actor, "user.authenticator_on", "user", user.id);
  });
}

export async function removeAuthenticator(
  db: Db,
  args: { userId: number; sessionToken: string | null | undefined; actor: Actor; now?: Date },
): Promise<void> {
  const now = args.now ?? new Date();
  await db.transaction(async (tx) => {
    await requireConfirmed(tx, args.sessionToken, args.userId, now);
    await tx.update(users).set({ totpSecret: null, totpEnabled: false, totpLastStep: 0, updatedAt: now }).where(eq(users.id, args.userId));
    await audit(tx, args.actor, "user.authenticator_off", "user", args.userId);
  });
}

/** Signs the person out everywhere but here. Needs no password: it only ever closes doors. */
export async function endOtherSessions(db: Db, args: { userId: number; sessionToken: string | null | undefined; actor: Actor }): Promise<void> {
  await db.transaction(async (tx) => {
    await endSessionsOf(tx, args.userId, args.sessionToken);
    await audit(tx, args.actor, "user.sessions_end", "user", args.userId);
  });
}
