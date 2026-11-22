import "server-only";
import { and, eq, gt, lt, ne } from "drizzle-orm";
import type { Role } from "@/domain/auth";
import type { Tx } from "../db/client";
import { authSteps, sessions, users } from "../db/schema";
import { newToken, tokenHash } from "./secret";

export type SignInMethod = "password" | "password+totp" | "passkey" | "totp" | "whatsapp";

/** A session lasts half a day, or thirty days when the person asks to be remembered on the device. */
export const SESSION_HOURS = 12;
export const REMEMBER_DAYS = 30;
/** How long a half-way sign-in waits for its second half. */
export const STEP_MINUTES = 5;

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
  await tx.insert(sessions).values({
    tokenHash: tokenHash(token),
    userId: args.userId,
    expiresAt,
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
