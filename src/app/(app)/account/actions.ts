"use server";

import type { PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  beginAuthenticator,
  changeOwnPassword,
  confirmAuthenticator,
  confirmIdentity,
  endOtherSessions,
  removeAuthenticator,
} from "@/server/auth/account";
import { addPasskey, passkeyRegistration, removePasskey } from "@/server/auth/passkeys";
import { qrDrawing, type QrDrawing } from "@/server/auth/qr";
import { clearCookie, currentSession, relyingParty, requestOrigin, SESSION_COOKIE, setCookie, STEP_COOKIE } from "@/server/auth/request";
import type { OpenSession } from "@/server/auth/sessions";
import type { Origin } from "@/server/auth/signin";
import { dataMode, getDb, type Db } from "@/server/db/client";
import type { Actor } from "@/server/shared/actor";
import { DomainError } from "@/server/shared/errors";

/** What every account action answers: nothing when it worked, or the code of why it did not. */
export interface AccountAnswer {
  error?: string;
}

interface Me {
  db: Db;
  session: OpenSession;
  /** The session cookie as sent: the services check it themselves before a sign-in method changes. */
  token: string | undefined;
  origin: Origin;
  actor: Actor;
  jar: Awaited<ReturnType<typeof cookies>>;
}

/**
 * Runs one change for the person who is signed in. A build without a database has no accounts to change.
 * An expected refusal comes back as its code, and `CONFIRM_FIRST` tells the page to ask for the password.
 */
async function forMe<T extends AccountAnswer = AccountAnswer>(run: (me: Me) => Promise<T | void>): Promise<T | AccountAnswer> {
  if (dataMode() === "demo") return { error: "DEMO" };
  const session = await currentSession();
  if (!session) redirect("/login");
  const jar = await cookies();
  const origin = await requestOrigin();
  try {
    const answer = await run({ db: await getDb(), session, token: jar.get(SESSION_COOKIE)?.value, origin, actor: { userId: session.user.id, ip: origin.ip }, jar });
    return answer ?? {};
  } catch (error) {
    if (error instanceof DomainError) return { error: error.code };
    throw error;
  }
}

const password = z.string().min(1).max(200);
const code = z.string().min(1).max(40);
const bad = (): AccountAnswer => ({ error: "INVALID_INPUT" });

/** The person types their password again, which opens the sign-in methods to change for a few minutes. */
export async function confirmPassword(typed: string): Promise<AccountAnswer> {
  const parsed = password.safeParse(typed);
  if (!parsed.success) return { error: "WRONG_PASSWORD" };
  return forMe(({ db, session, token, origin, actor }) => confirmIdentity(db, { userId: session.user.id, sessionToken: token, password: parsed.data, origin, actor }));
}

export async function changePassword(current: string, next: string): Promise<AccountAnswer> {
  const parsed = z.object({ current: password, next: password }).safeParse({ current, next });
  if (!parsed.success) return { error: "WRONG_PASSWORD" };
  const answer = await forMe(({ db, session, token, origin, actor }) =>
    changeOwnPassword(db, { userId: session.user.id, ...parsed.data, sessionToken: token, origin, actor }),
  );
  if (!answer.error) revalidatePath("/account");
  return answer;
}

export interface AuthenticatorStart extends AccountAnswer {
  /** The key to type by hand where the code cannot be scanned. */
  secret?: string;
  /** The same key as a link an authenticator app on this device opens. */
  uri?: string;
  qr?: QrDrawing;
}

export async function startAuthenticator(): Promise<AuthenticatorStart> {
  return forMe<AuthenticatorStart>(async ({ db, session, token }) => {
    const { secret, uri } = await beginAuthenticator(db, { userId: session.user.id, sessionToken: token });
    return { secret, uri, qr: qrDrawing(uri) };
  });
}

export async function finishAuthenticator(typed: string): Promise<AccountAnswer> {
  const parsed = code.safeParse(typed);
  if (!parsed.success) return { error: "BAD_CODE" };
  const answer = await forMe(({ db, session, token, actor }) => confirmAuthenticator(db, { userId: session.user.id, sessionToken: token, code: parsed.data, actor }));
  if (!answer.error) revalidatePath("/account");
  return answer;
}

export async function stopAuthenticator(): Promise<AccountAnswer> {
  const answer = await forMe(({ db, session, token, actor }) => removeAuthenticator(db, { userId: session.user.id, sessionToken: token, actor }));
  if (!answer.error) revalidatePath("/account");
  return answer;
}

export interface PasskeyStart extends AccountAnswer {
  options?: PublicKeyCredentialCreationOptionsJSON;
}

/** Hands the browser what it needs to make a passkey. The challenge it must answer waits behind a cookie. */
export async function startPasskey(): Promise<PasskeyStart> {
  const rp = await relyingParty();
  if (!rp) return { error: dataMode() === "demo" ? "DEMO" : "PASSKEY_OFF" };
  return forMe<PasskeyStart>(async ({ db, session, token, jar }) => {
    const { options, step } = await passkeyRegistration(db, { user: session.user, sessionToken: token, rp });
    setCookie(jar, STEP_COOKIE, step.token, step.expiresAt, "strict");
    return { options };
  });
}

// The browser's answer is checked piece by piece by the passkey library. Here it is only kept to a sane size.
const text = (max: number) => z.string().max(max);
const registration = z.looseObject({
  id: text(1500),
  rawId: text(1500),
  type: z.literal("public-key"),
  response: z.looseObject({
    clientDataJSON: text(6000),
    attestationObject: text(60_000),
    transports: z.array(text(40)).max(12).optional(),
  }),
});

export async function finishPasskey(response: unknown): Promise<AccountAnswer> {
  const parsed = registration.safeParse(response);
  if (!parsed.success) return { error: "PASSKEY_REFUSED" };
  const rp = await relyingParty();
  if (!rp) return { error: dataMode() === "demo" ? "DEMO" : "PASSKEY_OFF" };
  const answer = await forMe(async ({ db, session, origin, actor, jar }) => {
    const stepToken = jar.get(STEP_COOKIE)?.value;
    clearCookie(jar, STEP_COOKIE);
    await addPasskey(db, {
      userId: session.user.id,
      stepToken,
      response: { clientExtensionResults: {}, ...parsed.data } as RegistrationResponseJSON,
      rp,
      userAgent: origin.userAgent,
      actor,
    });
  });
  if (!answer.error) revalidatePath("/account");
  return answer;
}

export async function deletePasskey(id: number): Promise<AccountAnswer> {
  const parsed = z.number().int().positive().safeParse(id);
  if (!parsed.success) return bad();
  const answer = await forMe(({ db, session, token, actor }) => removePasskey(db, { userId: session.user.id, sessionToken: token, passkeyId: parsed.data, actor }));
  if (!answer.error) revalidatePath("/account");
  return answer;
}

export async function signOutElsewhere(): Promise<AccountAnswer> {
  const answer = await forMe(({ db, session, token, actor }) => endOtherSessions(db, { userId: session.user.id, sessionToken: token, actor }));
  if (!answer.error) revalidatePath("/account");
  return answer;
}
