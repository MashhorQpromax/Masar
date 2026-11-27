import "server-only";
import { headers } from "next/headers";
import { appSecret } from "../auth/secret";
import type { CodeSender } from "../auth/signin";
import { dataMode } from "../db/client";
import { siteOrigins } from "../site";
import { cloud, cloudConfig, type Cloud } from "./cloud";
import { DEMO_LINK_SECRET } from "./links";

/** The secret client links are derived from. The demo has no accounts and no secret, so it has a fixed one of its own. */
export function linkSecret(): string {
  return dataMode() === "demo" ? DEMO_LINK_SECRET : appSecret();
}

/**
 * The address a client's link starts with. A real site takes its own address from `MASAR_ORIGINS`,
 * or the production site's own (`src/server/site.ts`), and uses nothing else: a link built from the request's host name would go wherever a forged host
 * name points. The demo and a development machine use the address they are reached on.
 */
export async function siteOrigin(): Promise<string | null> {
  const told = (siteOrigins() ?? "").split(",")[0]?.trim().replace(/\/+$/, "");
  if (told) return told;
  if (dataMode() !== "demo" && process.env.NODE_ENV === "production") return null;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return null;
  const scheme = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${scheme}://${host}`;
}

/** The path of a client's page. */
export const linkPath = (token: string): string => `/s/${token}`;

/** WhatsApp from the company's number. Null until the owner connects it, and always in the demo. */
export function whatsapp(): Cloud | null {
  if (dataMode() === "demo") return null;
  const config = cloudConfig();
  return config ? cloud(config) : null;
}

/** What delivers a sign-in code to a person's WhatsApp. Null while the company's number is not connected. */
export function codeSender(): CodeSender | null {
  const wa = whatsapp();
  return wa && ((phone, code) => wa.sendCode(phone, code));
}
