import "server-only";
import { and, desc, eq, gt, lt, ne } from "drizzle-orm";
import type { Role } from "@/domain/auth";
import type { Tx } from "../db/client";
import { authSteps, sessions, users } from "../db/schema";
import { DomainError } from "../shared/errors";
import { newToken, tokenHash } from "./secret";

export type SignInMethod = "password" | "password+totp" | "passkey" | "totp" | "whatsapp";

/** A session lasts half a day, or thirty days when the person asks to be remembered on the device. */
export const SESSION_HOURS = 12;
export const REMEMBER_DAYS = 30;
/** How long a half-way sign-in waits for its second half. */
export const STEP_MINUTES = 5;
/** How long a typed password keeps the sign-in methods of the account open to change. */
export const CONFIRM_MINUTES = 10;

const HOUR = 3_600_000;

export interface Issued {
  /** Goes into the cookie and nowhere else. */
  token: string;
  expiresAt: Date;
}

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: Role;
}

export interface OpenSession {
  user: SessionUser;
  method: string;
  expiresAt: Date;
  /** The person re-entered their password and may change sign-in methods until then. */
  confirmedUntil: Date | null;
}

/** A token as a browser would send it: short, and made of the characters we issue. */
const plausible = (token: string | null | undefined): token is string => !!token && /^[A-Za-z0-9_-]{20,100}$/.test(token);

export async function issueSession(
  tx: Tx,
  args: { userId: number; remember: boolean; method: SignInMethod; ip: string | null; userAgent: string | null; now: Date },
): Promise<Issued> {
  const token = newToken();
  const expiresAt = new Date(args.now.getTime() + (args.remember ? REMEMBER_DAYS * 24 : SESSION_HOURS) * HOUR);
  // Whoever just typed the password has confirmed who they are; a code or a passkey says less about that.
  const typedPassword = args.method === "password" || args.method === "password+totp";
  await tx.insert(sessions).values({
    tokenHash: tokenHash(token),
    userId: args.userId,
    expiresAt,
    confirmedUntil: typedPassword ? new Date(args.now.getTime() + CONFIRM_MINUTES * 60_000) : null,
    method: args.method,
    ip: args.ip,
    userAgent: args.userAgent?.slice(0, 300) ?? null,
    createdAt: args.now,
  });
  return { token, expiresAt };
}

/** The session a cookie token opens, when it has not expired and its person is still active. */
export async function readSession(tx: Tx, token: string | null | undefined, now: Date): Promise<OpenSession | null> {
  if (!plausible(token)) return null;
  const [row] = await tx
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      method: sessions.method,
      expiresAt: sessions.expiresAt,
      confirmedUntil: sessions.confirmedUntil,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash(token)), gt(sessions.expiresAt, now), eq(users.active, true)));
  if (!row) return null;
  return {
    user: { id: row.id, name: row.name, email: row.email, role: row.role },
    method: row.method,
    expiresAt: row.expiresAt,
    confirmedUntil: row.confirmedUntil && row.confirmedUntil > now ? row.confirmedUntil : null,
  };
}

/** Ends one session. Returns whose it was, for the audit log. */
export async function endSession(tx: Tx, token: string | null | undefined): Promise<number | null> {
  if (!plausible(token)) return null;
  const [gone] = await tx.delete(sessions).where(eq(sessions.tokenHash, tokenHash(token))).returning({ userId: sessions.userId });
  return gone?.userId ?? null;
}

/** Ends every session of a person, except the one they are using when its token is given. */
export async function endSessionsOf(tx: Tx, userId: number, keepToken?: string | null): Promise<void> {
  const keep = plausible(keepToken) ? tokenHash(keepToken) : null;
  await tx.delete(sessions).where(keep ? and(eq(sessions.userId, userId), ne(sessions.tokenHash, keep)) : eq(sessions.userId, userId));
}

/** Marks the session as confirmed: its person re-entered their password a moment ago. */
export async function confirmSession(tx: Tx, token: string | null | undefined, now: Date): Promise<void> {
  if (!plausible(token)) return;
  await tx
    .update(sessions)
    .set({ confirmedUntil: new Date(now.getTime() + CONFIRM_MINUTES * 60_000) })
    .where(eq(sessions.tokenHash, tokenHash(token)));
}

/**
 * The rule for changing how an account is opened: the session must be its person's own, and that person
 * typed their password within the last minutes. A device found signed in cannot add its finder's fingerprint.
 */
export async function requireConfirmed(tx: Tx, token: string | null | undefined, userId: number, now: Date): Promise<void> {
  const session = await readSession(tx, token, now);
  if (!session || session.user.id !== userId || !session.confirmedUntil) throw new DomainError("CONFIRM_FIRST");
}

export interface SessionLine {
  method: string;
  createdAt: Date;
  expiresAt: Date;
  userAgent: string | null;
  /** The session asking. */
  current: boolean;
}

/** Where a person is signed in right now, newest first. */
export async function listSessions(tx: Tx, userId: number, currentToken: string | null | undefined, now: Date): Promise<SessionLine[]> {
  const current = plausible(currentToken) ? tokenHash(currentToken) : null;
  const rows = await tx
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, now)))
    .orderBy(desc(sessions.createdAt));
  return rows.map((row) => ({ method: row.method, createdAt: row.createdAt, expiresAt: row.expiresAt, userAgent: row.userAgent, current: row.tokenHash === current }));
}

export type StepKind = (typeof authSteps.$inferSelect)["kind"];

export async function issueStep(
  tx: Tx,
  args: { kind: StepKind; userId?: number | null; challenge?: string | null; remember?: boolean; now: Date },
): Promise<Issued> {
  const token = newToken();
  const expiresAt = new Date(args.now.getTime() + STEP_MINUTES * 60_000);
  await tx.insert(authSteps).values({
    tokenHash: tokenHash(token),
    kind: args.kind,
    userId: args.userId ?? null,
    challenge: args.challenge ?? null,
    remember: args.remember ?? false,
    expiresAt,
    createdAt: args.now,
  });
  return { token, expiresAt };
}

export async function readStep(tx: Tx, token: string | null | undefined, kind: StepKind, now: Date) {
  if (!plausible(token)) return null;
  const [row] = await tx
    .select()
    .from(authSteps)
    .where(and(eq(authSteps.tokenHash, tokenHash(token)), eq(authSteps.kind, kind), gt(authSteps.expiresAt, now)));
  return row ?? null;
}

/** Takes a step out of the table, so it is used once. Null when it was already used or has expired. */
export async function takeStep(tx: Tx, token: string | null | undefined, kind: StepKind, now: Date) {
  if (!plausible(token)) return null;
  const [row] = await tx
    .delete(authSteps)
    .where(and(eq(authSteps.tokenHash, tokenHash(token)), eq(authSteps.kind, kind), gt(authSteps.expiresAt, now)))
    .returning();
  return row ?? null;
}

/** Clears what has expired. Called when someone signs in, so the tables do not grow. */
export async function sweepExpired(tx: Tx, now: Date): Promise<void> {
  await tx.delete(sessions).where(lt(sessions.expiresAt, now));
  await tx.delete(authSteps).where(lt(authSteps.expiresAt, now));
}
