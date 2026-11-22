import "server-only";
import crypto from "node:crypto";
import { and, count, desc, eq, gt, sql } from "drizzle-orm";
import type { SignInRefusal } from "@/domain/auth";
import { digitsOf, normalizePhone } from "@/domain/shared/phone";
import type { Db, Tx } from "../db/client";
import { auditLog, loginCodes, users } from "../db/schema";
import { spendPasswordCheck, verifyPassword } from "./password";
import { loginCodeHash, sameHash, unseal } from "./secret";
import { endSession, issueSession, issueStep, readStep, sweepExpired, takeStep, type Issued, type SignInMethod } from "./sessions";
import { totpMatch } from "./totp";

/** After this many wrong passwords or wrong second-factor codes in a row, the account locks. */
export const MAX_FAILURES = 5;
export const LOCK_MINUTES = 15;
/** After this many failures from one address inside the window, every way in is closed to that address. */
export const ADDRESS_MAX_FAILURES = 20;
export const WINDOW_MINUTES = 15;
/** After this many wrong codes, signing in by code alone stops until a password or passkey sign-in. */
export const CODE_MAX_FAILURES = 5;
/** A code sent to a phone lives this long, and gives up after this many wrong tries. */
export const CODE_MINUTES = 5;
export const CODE_MAX_TRIES = 5;
export const CODES_PER_USER = 3;
export const CODES_PER_ADDRESS = 5;

/** Why a sign-in was refused. Wording lives in `src/copy/auth.ts`. */
export type Refusal = SignInRefusal;

/** Where a request came from. Recorded with every attempt. */
export interface Origin {
  ip: string | null;
  userAgent: string | null;
}

export type SignInResult = { status: "signed_in"; userId: number; session: Issued } | { status: "refused"; refusal: Refusal };
export type PasswordResult = SignInResult | { status: "second_factor"; step: Issued };

type UserRow = typeof users.$inferSelect;

const refused = (refusal: Refusal) => ({ status: "refused", refusal }) as const;
const minutesBefore = (now: Date, minutes: number) => new Date(now.getTime() - minutes * 60_000);
const minutesAfter = (now: Date, minutes: number) => new Date(now.getTime() + minutes * 60_000);

export const normalizeEmail = (email: string): string => email.trim().toLowerCase().slice(0, 200);

async function findUser(tx: Tx, email: string): Promise<UserRow | undefined> {
  const wanted = normalizeEmail(email);
  if (!wanted) return undefined;
  const [user] = await tx.select().from(users).where(eq(sql`lower(${users.email})`, wanted));
  return user;
}

function note(tx: Tx, origin: Origin, now: Date, action: string, userId: number | null, details?: Record<string, unknown>) {
  return tx.insert(auditLog).values({
    userId,
    action,
    entity: userId == null ? null : "user",
    entityId: userId,
    details,
    ip: origin.ip,
    createdAt: now,
  });
}

async function countOf(tx: Tx, action: string, ip: string, since: Date): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(auditLog)
    .where(and(eq(auditLog.action, action), eq(auditLog.ip, ip), gt(auditLog.createdAt, since)));
  return Number(row?.n ?? 0);
}

/** Too many failed attempts came from this address a moment ago. Guards every way in. */
export async function addressBlocked(tx: Tx, ip: string | null, now: Date): Promise<boolean> {
  if (!ip) return false;
  return (await countOf(tx, "login_failed", ip, minutesBefore(now, WINDOW_MINUTES))) >= ADDRESS_MAX_FAILURES;
}

const locked = (user: UserRow, now: Date) => !!user.lockedUntil && user.lockedUntil > now;

/** Counts one failure against an account and locks it at the fifth. One statement, so two attempts at once both count. */
async function countFailure(db: Db, userId: number, origin: Origin, now: Date, method: string): Promise<void> {
  const until = minutesAfter(now, LOCK_MINUTES).toISOString();
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        failedLogins: sql`case when ${users.failedLogins} + 1 >= ${MAX_FAILURES} then 0 else ${users.failedLogins} + 1 end`,
        lockedUntil: sql`case when ${users.failedLogins} + 1 >= ${MAX_FAILURES} then ${until}::timestamptz else ${users.lockedUntil} end`,
      })
      .where(eq(users.id, userId));
    await note(tx, origin, now, "login_failed", userId, { method });
  });
}

/** Opens the session after any way in has succeeded, and clears the counters that guard the account. */
async function openSession(
  tx: Tx,
  args: { userId: number; remember: boolean; method: SignInMethod; origin: Origin; now: Date },
): Promise<SignInResult> {
  const { userId, origin, now } = args;
  await tx.update(users).set({ failedLogins: 0, lockedUntil: null, otpFails: 0, lastLoginAt: now }).where(eq(users.id, userId));
  await sweepExpired(tx, now);
  const session = await issueSession(tx, { userId, remember: args.remember, method: args.method, ip: origin.ip, userAgent: origin.userAgent, now });
  await note(tx, origin, now, "login", userId, { method: args.method });
  return { status: "signed_in", userId, session };
}

/**
 * Checks an authenticator code for a person and remembers its step, so the same code is not taken twice
 * even when two requests carry it at the same moment.
 */
export async function acceptTotp(tx: Tx, user: UserRow, code: string, now: Date, options: { pending?: boolean } = {}): Promise<boolean> {
  if (!user.totpSecret || (!user.totpEnabled && !options.pending)) return false;
  const secret = unseal(user.totpSecret);
  if (!secret) return false;
  const step = totpMatch(secret, code, user.totpLastStep, now);
  if (step == null) return false;
  const taken = await tx
    .update(users)
    .set({ totpLastStep: step })
    .where(and(eq(users.id, user.id), sql`${users.totpLastStep} < ${step}`))
    .returning({ id: users.id });
  return taken.length === 1;
}

/** Email and password. With an authenticator on the account, the answer is a step that waits for its code. */
export async function signInWithPassword(
  db: Db,
  args: { email: string; password: string; remember: boolean; origin: Origin; now?: Date },
): Promise<PasswordResult> {
  const now = args.now ?? new Date();
  const { origin } = args;
  if (await addressBlocked(db, origin.ip, now)) return refused("TOO_MANY");

  const user = await findUser(db, args.email);
  if (!user || !user.active) {
    await spendPasswordCheck(args.password);
    await note(db, origin, now, "login_failed", user?.id ?? null, user ? { method: "password", inactive: true } : { email: normalizeEmail(args.email).slice(0, 120) });
    return refused("BAD_CREDENTIALS");
  }
  if (locked(user, now)) return refused("LOCKED");
  if (!(await verifyPassword(args.password, user.passwordHash))) {
    await countFailure(db, user.id, origin, now, "password");
    return refused("BAD_CREDENTIALS");
  }
  if (user.totpEnabled) {
    return { status: "second_factor", step: await issueStep(db, { kind: "second_factor", userId: user.id, remember: args.remember, now }) };
  }
  return db.transaction((tx) => openSession(tx, { userId: user.id, remember: args.remember, method: "password", origin, now }));
}

/** The second half of a password sign-in: the code from the authenticator app. */
export async function completeSecondFactor(
  db: Db,
  args: { stepToken: string | null | undefined; code: string; origin: Origin; now?: Date },
): Promise<SignInResult> {
  const now = args.now ?? new Date();
  const { origin } = args;
  const step = await readStep(db, args.stepToken, "second_factor", now);
  if (!step?.userId) return refused("STEP_EXPIRED");
  if (await addressBlocked(db, origin.ip, now)) return refused("TOO_MANY");
  const [user] = await db.select().from(users).where(eq(users.id, step.userId));
  if (!user?.active) return refused("STEP_EXPIRED");
  if (locked(user, now)) return refused("LOCKED");

  const done = await db.transaction(async (tx) => {
    if (!(await acceptTotp(tx, user, digitsOf(args.code), now))) return null;
    // Taking the step is what makes it single use: a second request with the same cookie finds nothing.
    if (!(await takeStep(tx, args.stepToken, "second_factor", now))) return null;
    return openSession(tx, { userId: user.id, remember: step.remember, method: "password+totp", origin, now });
  });
  if (done) return done;
  await countFailure(db, user.id, origin, now, "totp");
  return refused("BAD_CODE");
}

/** Checks a code that was sent to the person's phone. A code is taken once. */
async function acceptSentCode(tx: Tx, userId: number, code: string, now: Date): Promise<boolean> {
  const [row] = await tx
    .select()
    .from(loginCodes)
    .where(and(eq(loginCodes.userId, userId), eq(loginCodes.used, false), gt(loginCodes.expiresAt, now)))
    .orderBy(desc(loginCodes.id))
    .limit(1);
  if (!row || row.attempts >= CODE_MAX_TRIES) return false;
  if (!sameHash(row.codeHash, loginCodeHash(userId, code))) {
    await tx.update(loginCodes).set({ attempts: sql`${loginCodes.attempts} + 1` }).where(eq(loginCodes.id, row.id));
    return false;
  }
  const taken = await tx
    .update(loginCodes)
    .set({ used: true })
    .where(and(eq(loginCodes.id, row.id), eq(loginCodes.used, false)))
    .returning({ id: loginCodes.id });
  return taken.length === 1;
}

/**
 * Email and a six digit code, with no password: the code sent to the person's WhatsApp, or the one in
 * their authenticator app. Five wrong codes stop this way in until the person signs in with a password
 * or a passkey, so six digits are never the only thing between a stranger and the account for long.
 */
export async function signInWithCode(
  db: Db,
  args: { email: string; code: string; remember: boolean; origin: Origin; now?: Date },
): Promise<SignInResult> {
  const now = args.now ?? new Date();
  const { origin } = args;
  if (await addressBlocked(db, origin.ip, now)) return refused("TOO_MANY");

  const code = digitsOf(args.code);
  const user = await findUser(db, args.email);
  if (!user || !user.active || code.length !== 6) {
    await note(db, origin, now, "login_failed", user?.id ?? null, user ? { method: "code" } : { email: normalizeEmail(args.email).slice(0, 120) });
    return refused("BAD_CODE");
  }
  if (user.otpFails >= CODE_MAX_FAILURES) {
    await note(db, origin, now, "login_failed", user.id, { method: "code", stopped: true });
    return refused("BAD_CODE");
  }

  const done = await db.transaction(async (tx) => {
    const method: SignInMethod | null = (await acceptSentCode(tx, user.id, code, now)) ? "whatsapp" : (await acceptTotp(tx, user, code, now)) ? "totp" : null;
    return method && openSession(tx, { userId: user.id, remember: args.remember, method, origin, now });
  });
  if (done) return done;
  await db.transaction(async (tx) => {
    await tx.update(users).set({ otpFails: sql`${users.otpFails} + 1` }).where(eq(users.id, user.id));
    await note(tx, origin, now, "login_failed", user.id, { method: "code" });
  });
  return refused("BAD_CODE");
}

/** Ends the session a cookie token opens, and records who left. */
export async function signOut(db: Db, args: { token: string | null | undefined; origin: Origin; now?: Date }): Promise<void> {
  const now = args.now ?? new Date();
  await db.transaction(async (tx) => {
    const userId = await endSession(tx, args.token);
    if (userId != null) await note(tx, args.origin, now, "logout", userId);
  });
}

/** Delivers a code to a phone. The WhatsApp module provides the real one. */
export type CodeSender = (phone: string, code: string) => Promise<{ ok: boolean; error?: string }>;

/**
 * Sends a sign-in code to the phone on the account. It returns nothing, on purpose: the caller gives
 * the same answer whether the email has an account or not, so the form cannot be used to find accounts.
 */
export async function sendLoginCode(db: Db, args: { email: string; origin: Origin; send: CodeSender; now?: Date }): Promise<void> {
  const now = args.now ?? new Date();
  const { origin } = args;
  const since = minutesBefore(now, WINDOW_MINUTES);
  if (await addressBlocked(db, origin.ip, now)) return;
  if (origin.ip && (await countOf(db, "login_code_sent", origin.ip, since)) >= CODES_PER_ADDRESS) return;

  const user = await findUser(db, args.email);
  const phone = normalizePhone(user?.phone);
  if (!user || !user.active || !phone) return;
  const [recent] = await db
    .select({ n: count() })
    .from(loginCodes)
    .where(and(eq(loginCodes.userId, user.id), gt(loginCodes.createdAt, since)));
  if (Number(recent?.n ?? 0) >= CODES_PER_USER) return;

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await db.transaction(async (tx) => {
    // A new code retires the ones before it.
    await tx.update(loginCodes).set({ used: true }).where(and(eq(loginCodes.userId, user.id), eq(loginCodes.used, false)));
    await tx.insert(loginCodes).values({ userId: user.id, codeHash: loginCodeHash(user.id, code), expiresAt: minutesAfter(now, CODE_MINUTES), createdAt: now });
  });
  const sent = await args.send(phone, code).catch((error: unknown) => ({ ok: false, error: String(error) }));
  await note(db, origin, now, "login_code_sent", user.id, sent.ok ? { channel: "whatsapp" } : { channel: "whatsapp", failed: String(sent.error ?? "").slice(0, 200) });
}
