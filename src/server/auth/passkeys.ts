import "server-only";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { and, asc, eq } from "drizzle-orm";
import { deviceName } from "@/domain/auth/device";
import type { Db, Tx } from "../db/client";
import { passkeys, users } from "../db/schema";
import type { Actor } from "../shared/actor";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";
import { issueStep, requireConfirmed, sweepExpired, takeStep, type Issued, type SessionUser } from "./sessions";
import { addressBlocked, note, openSession, type Origin, type SignInResult } from "./signin";

/**
 * Passkeys (WebAuthn): the device proves who is there with a fingerprint, a face or its own PIN, and no
 * secret ever reaches this server. Stored keys have the old system's format, so they carry over with it.
 */

/** The site passkeys belong to: its domain, and the exact addresses a browser may use them from. */
export interface RelyingParty {
  id: string;
  origins: string[];
}

/**
 * Reads the site from the list of its addresses, the first being the site's own. An address that is not
 * HTTPS, or not on that domain or beneath it, is left out: a passkey made there would not open the others.
 */
export function partyFrom(listed: string | undefined): RelyingParty | null {
  const origins: string[] = [];
  let id = "";
  for (const text of (listed ?? "").split(",")) {
    let url: URL;
    try {
      url = new URL(text.trim());
    } catch {
      continue;
    }
    const local = url.hostname === "localhost";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) continue;
    if (!id) id = url.hostname;
    if (url.hostname !== id && !url.hostname.endsWith(`.${id}`)) continue;
    if (!origins.includes(url.origin)) origins.push(url.origin);
  }
  return id ? { id, origins } : null;
}

export interface PasskeyLine {
  id: number;
  name: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}

const transportsOf = (value: string[] | null) => (value?.length ? value : undefined);

export function listPasskeys(tx: Tx, userId: number): Promise<PasskeyLine[]> {
  return tx
    .select({ id: passkeys.id, name: passkeys.name, createdAt: passkeys.createdAt, lastUsedAt: passkeys.lastUsedAt })
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .orderBy(asc(passkeys.id));
}

/** What the browser needs to make a new passkey for a signed-in person. The challenge waits on the server. */
export async function passkeyRegistration(db: Db, args: { user: SessionUser; sessionToken: string | null | undefined; rp: RelyingParty; now?: Date }) {
  const now = args.now ?? new Date();
  await requireConfirmed(db, args.sessionToken, args.user.id, now);
  const known = await db.select({ credentialId: passkeys.credentialId, transports: passkeys.transports }).from(passkeys).where(eq(passkeys.userId, args.user.id));
  const options = await generateRegistrationOptions({
    rpName: "مسار",
    rpID: args.rp.id,
    userName: args.user.email,
    userDisplayName: args.user.name,
    userID: new TextEncoder().encode(`masar-user-${args.user.id}`),
    attestationType: "none",
    excludeCredentials: known.map((key) => ({ id: key.credentialId, transports: transportsOf(key.transports) })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  const step = await issueStep(db, { kind: "passkey_register", userId: args.user.id, challenge: options.challenge, now });
  return { options, step };
}

/** Stores the passkey a browser just made, once its answer to our challenge checks out. */
export async function addPasskey(
  db: Db,
  args: { userId: number; stepToken: string | null | undefined; response: RegistrationResponseJSON; rp: RelyingParty; userAgent: string | null; actor: Actor; now?: Date },
): Promise<void> {
  const now = args.now ?? new Date();
  const step = await takeStep(db, args.stepToken, "passkey_register", now);
  if (!step?.challenge || step.userId !== args.userId) throw new DomainError("STEP_EXPIRED");
  const verified = await verifyRegistrationResponse({
    response: args.response,
    expectedChallenge: step.challenge,
    expectedOrigin: args.rp.origins,
    expectedRPID: args.rp.id,
    requireUserVerification: true,
  }).catch(() => null);
  if (!verified?.verified || !verified.registrationInfo) throw new DomainError("PASSKEY_REFUSED");

  const { credential } = verified.registrationInfo;
  await db.transaction(async (tx) => {
    const [taken] = await tx.select({ id: passkeys.id }).from(passkeys).where(eq(passkeys.credentialId, credential.id));
    if (taken) throw new DomainError("PASSKEY_KNOWN");
    await tx.insert(passkeys).values({
      userId: args.userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: credential.transports ?? args.response.response.transports ?? [],
      name: deviceName(args.userAgent),
      createdAt: now,
    });
    await audit(tx, args.actor, "user.passkey_add", "user", args.userId);
  });
}

export async function removePasskey(
  db: Db,
  args: { userId: number; sessionToken: string | null | undefined; passkeyId: number; actor: Actor; now?: Date },
): Promise<void> {
  await db.transaction(async (tx) => {
    await requireConfirmed(tx, args.sessionToken, args.userId, args.now ?? new Date());
    const gone = await tx.delete(passkeys).where(and(eq(passkeys.id, args.passkeyId), eq(passkeys.userId, args.userId))).returning({ id: passkeys.id });
    if (!gone.length) throw new DomainError("NOT_FOUND");
    await audit(tx, args.actor, "user.passkey_remove", "user", args.userId);
  });
}

/** What the browser needs to sign in with a passkey. Nobody is named: the passkey itself says who it is. */
export async function passkeySignIn(db: Db, args: { rp: RelyingParty; remember: boolean; now?: Date }): Promise<{ options: Awaited<ReturnType<typeof generateAuthenticationOptions>>; step: Issued }> {
  const now = args.now ?? new Date();
  // Anyone may ask for a challenge, so the ones nobody answered are cleared as new ones are made.
  await sweepExpired(db, now);
  const options = await generateAuthenticationOptions({ rpID: args.rp.id, userVerification: "required" });
  const step = await issueStep(db, { kind: "passkey_login", challenge: options.challenge, remember: args.remember, now });
  return { options, step };
}

/** Signs in the person whose passkey answered the challenge. A challenge is taken once, right or wrong. */
export async function signInWithPasskey(
  db: Db,
  args: { stepToken: string | null | undefined; response: AuthenticationResponseJSON; rp: RelyingParty; origin: Origin; now?: Date },
): Promise<SignInResult> {
  const now = args.now ?? new Date();
  const { origin } = args;
  const refuse = async (userId: number | null): Promise<SignInResult> => {
    await note(db, origin, now, "login_failed", userId, { method: "passkey" });
    return { status: "refused", refusal: "BAD_PASSKEY" };
  };
  if (await addressBlocked(db, origin.ip, now)) return { status: "refused", refusal: "TOO_MANY" };
  const step = await takeStep(db, args.stepToken, "passkey_login", now);
  if (!step?.challenge) return { status: "refused", refusal: "STEP_EXPIRED" };
  if (typeof args.response?.id !== "string") return refuse(null);

  const [key] = await db
    .select({ key: passkeys, active: users.active })
    .from(passkeys)
    .innerJoin(users, eq(users.id, passkeys.userId))
    .where(eq(passkeys.credentialId, args.response.id));
  if (!key) return refuse(null);
  if (!key.active) return refuse(key.key.userId);

  const verified = await verifyAuthenticationResponse({
    response: args.response,
    expectedChallenge: step.challenge,
    expectedOrigin: args.rp.origins,
    expectedRPID: args.rp.id,
    requireUserVerification: true,
    credential: {
      id: key.key.credentialId,
      publicKey: new Uint8Array(Buffer.from(key.key.publicKey, "base64url")),
      counter: Number(key.key.counter),
      transports: transportsOf(key.key.transports),
    },
  }).catch(() => null);
  if (!verified?.verified) return refuse(key.key.userId);

  return db.transaction(async (tx) => {
    await tx.update(passkeys).set({ counter: verified.authenticationInfo.newCounter, lastUsedAt: now }).where(eq(passkeys.id, key.key.id));
    return openSession(tx, { userId: key.key.userId, remember: step.remember, method: "passkey", origin, now });
  });
}
