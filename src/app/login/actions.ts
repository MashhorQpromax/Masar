"use server";

import type { AuthenticationResponseJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { passkeySignIn, signInWithPasskey } from "@/server/auth/passkeys";
import { clearCookie, relyingParty, requestOrigin, SESSION_COOKIE, setCookie, STEP_COOKIE } from "@/server/auth/request";
import { completeSecondFactor, sendLoginCode, signInWithCode, signInWithPassword, signOut as endSignIn } from "@/server/auth/signin";
import { dataMode, getDb } from "@/server/db/client";
import { codeSender } from "@/server/messages/request";

/** What the sign-in form is told after a try: a refusal code, and whether the authenticator code is awaited. */
export type SignInState = { error?: string; second?: boolean } | undefined;

const text = (max: number) => z.string().max(max);
const passwordForm = z.object({ email: text(200), password: text(200), remember: z.boolean() });
const secondForm = z.object({ code: text(40) });
const codeForm = z.object({ email: text(200), code: text(40), remember: z.boolean() });

const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};
const remember = (form: FormData) => form.get("remember") === "on";

/** A build without a database has no accounts: the form opens the fictional data, whatever is typed. */
function demoEnters(): void {
  if (dataMode() === "demo") redirect("/");
}

export async function signIn(_: SignInState, form: FormData): Promise<SignInState> {
  demoEnters();
  const parsed = passwordForm.safeParse({ email: field(form, "email"), password: field(form, "password"), remember: remember(form) });
  if (!parsed.success) return { error: "BAD_CREDENTIALS" };
  const result = await signInWithPassword(await getDb(), { ...parsed.data, origin: await requestOrigin() });
  if (result.status === "refused") return { error: result.refusal };

  const jar = await cookies();
  if (result.status === "second_factor") {
    setCookie(jar, STEP_COOKIE, result.step.token, result.step.expiresAt, "strict");
    return { second: true };
  }
  setCookie(jar, SESSION_COOKIE, result.session.token, result.session.expiresAt);
  redirect("/");
}

/** The second half of a password sign-in: the authenticator code. */
export async function signInSecond(_: SignInState, form: FormData): Promise<SignInState> {
  demoEnters();
  const parsed = secondForm.safeParse({ code: field(form, "code") });
  if (!parsed.success) return { second: true, error: "BAD_CODE" };
  const jar = await cookies();
  const result = await completeSecondFactor(await getDb(), {
    stepToken: jar.get(STEP_COOKIE)?.value,
    code: parsed.data.code,
    origin: await requestOrigin(),
  });
  if (result.status === "refused") {
    if (result.refusal !== "STEP_EXPIRED") return { second: true, error: result.refusal };
    clearCookie(jar, STEP_COOKIE);
    return { error: result.refusal };
  }
  clearCookie(jar, STEP_COOKIE);
  setCookie(jar, SESSION_COOKIE, result.session.token, result.session.expiresAt);
  redirect("/");
}

/** Email and a six digit code, with no password. */
export async function signInByCode(_: SignInState, form: FormData): Promise<SignInState> {
  demoEnters();
  const parsed = codeForm.safeParse({ email: field(form, "email"), code: field(form, "code"), remember: remember(form) });
  if (!parsed.success) return { error: "BAD_CODE" };
  const result = await signInWithCode(await getDb(), { ...parsed.data, origin: await requestOrigin() });
  if (result.status === "refused") return { error: result.refusal };
  setCookie(await cookies(), SESSION_COOKIE, result.session.token, result.session.expiresAt);
  redirect("/");
}

/**
 * Sends a sign-in code to the WhatsApp of the account behind an email. It answers nothing, whatever
 * happened: the form says the same words for an email with an account and for one without.
 */
export async function askCode(email: string): Promise<void> {
  if (dataMode() === "demo") return;
  const parsed = text(200).safeParse(email);
  const send = codeSender();
  if (!parsed.success || !send) return;
  await sendLoginCode(await getDb(), { email: parsed.data, origin: await requestOrigin(), send });
}

export interface PasskeyAsk {
  error?: string;
  options?: PublicKeyCredentialRequestOptionsJSON;
}

/** Starts a passkey sign-in: the challenge the device must answer. Nobody is named yet. */
export async function passkeyStart(rememberMe: boolean): Promise<PasskeyAsk> {
  demoEnters();
  const rp = await relyingParty();
  if (!rp) return { error: "BAD_PASSKEY" };
  const { options, step } = await passkeySignIn(await getDb(), { rp, remember: rememberMe === true });
  setCookie(await cookies(), STEP_COOKIE, step.token, step.expiresAt, "strict");
  return { options };
}

// The device's answer is checked piece by piece by the passkey library. Here it is only kept to a sane size.
const answerForm = z.looseObject({
  id: text(1500),
  rawId: text(1500),
  type: z.literal("public-key"),
  response: z.looseObject({
    clientDataJSON: text(6000),
    authenticatorData: text(6000),
    signature: text(3000),
    userHandle: text(400).nullish(),
  }),
});

export async function passkeyFinish(response: unknown): Promise<SignInState> {
  demoEnters();
  const parsed = answerForm.safeParse(response);
  const rp = await relyingParty();
  if (!parsed.success || !rp) return { error: "BAD_PASSKEY" };
  const jar = await cookies();
  const stepToken = jar.get(STEP_COOKIE)?.value;
  clearCookie(jar, STEP_COOKIE);
  const result = await signInWithPasskey(await getDb(), {
    stepToken,
    response: { clientExtensionResults: {}, ...parsed.data } as AuthenticationResponseJSON,
    rp,
    origin: await requestOrigin(),
  });
  if (result.status === "refused") return { error: result.refusal };
  setCookie(jar, SESSION_COOKIE, result.session.token, result.session.expiresAt);
  redirect("/");
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  if (dataMode() !== "demo") {
    await endSignIn(await getDb(), { token: jar.get(SESSION_COOKIE)?.value, origin: await requestOrigin() });
  }
  clearCookie(jar, SESSION_COOKIE);
  redirect("/login");
}
