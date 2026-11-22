import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { getDb } from "../db/client";
import { partyFrom, type RelyingParty } from "./passkeys";
import { readSession, type OpenSession } from "./sessions";
import type { Origin } from "./signin";

/**
 * In production the cookies carry the `__Host-` prefix: the browser then accepts them only over HTTPS,
 * for this exact host and for the whole site, and no sub-domain can plant one.
 */
const secure = process.env.NODE_ENV === "production";
export const SESSION_COOKIE = secure ? "__Host-masar_session" : "masar_session";
export const STEP_COOKIE = secure ? "__Host-masar_step" : "masar_step";

type Jar = Awaited<ReturnType<typeof cookies>>;

/** Script on the page can never read these cookies, and another site cannot send them along with a form. */
export function setCookie(jar: Jar, name: string, value: string, expires: Date, sameSite: "lax" | "strict" = "lax"): void {
  jar.set(name, value, { httpOnly: true, secure, sameSite, path: "/", expires });
}

/** Removal carries the same attributes as the cookie: a browser ignores a `__Host-` removal that lacks them. */
export function clearCookie(jar: Jar, name: string): void {
  jar.set(name, "", { httpOnly: true, secure, sameSite: "lax", path: "/", expires: new Date(0) });
}

/**
 * Where the request came from. The hosting platform writes the forwarded address itself, so a visitor
 * cannot choose it. On a server that is reached directly this header is whatever the visitor sends, and
 * the limit per address then guards nothing: the lock on each account still does.
 */
export async function requestOrigin(): Promise<Origin> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]!.trim().slice(0, 64);
  return { ip: ip || null, userAgent: h.get("user-agent") };
}

/**
 * The site passkeys are bound to, from `MASAR_ORIGINS`. A production build that was not told its own
 * address has no passkeys: taking the address from the request would let a forged host name choose it.
 * In development the address is the one the browser is on.
 */
export async function relyingParty(): Promise<RelyingParty | null> {
  const told = partyFrom(process.env.MASAR_ORIGINS);
  if (told || secure) return told;
  const host = (await headers()).get("host") ?? "localhost";
  return partyFrom(`http://${host}`);
}

/** The session of this request, read once however many parts of the page ask for it. */
export const currentSession = cache(async (): Promise<OpenSession | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return readSession(await getDb(), token, new Date());
});
