import "server-only";
import crypto from "node:crypto";

/**
 * What the live site knows about itself: its database, its addresses and its secret.
 *
 * Each can be told in a setting of its own. The production site also works with none of them set,
 * because the owner cannot be asked to copy a database address by hand:
 *
 * - The database is the one the hosting already names for the production site (`DATABASE_URL` or
 *   `POSTGRES_URL`, the names the old system read). Only a production deployment looks there. A
 *   preview never does, so no preview attaches itself to the live data.
 * - The addresses are the site's own, written here.
 * - The secret is worked out from the database's address, which the hosting keeps and no table holds,
 *   so a copy of the database still opens no authenticator and makes no client link. It lasts as long
 *   as that address does: after a change of the database's password or host, authenticators are
 *   enrolled again and open client links are sent again. Setting `MASAR_SECRET` ends that dependence,
 *   with the same effect once, on the day it is set.
 *
 * Pure: every function takes the environment it reads.
 */
type Env = Record<string, string | undefined>;

/** The addresses the production site answers on, its own first. Passkeys are bound to the first. */
export const PRODUCTION_ORIGINS = "https://masarfin.com,https://www.masarfin.com";

const production = (env: Env): boolean => env.VERCEL_ENV === "production";

/** The live database, or null when this is not a live site. */
export function liveDatabaseUrl(env: Env = process.env): string | null {
  if (env.MASAR_DATABASE_URL) return env.MASAR_DATABASE_URL;
  return production(env) ? env.DATABASE_URL || env.POSTGRES_URL || null : null;
}

/** The site's addresses as a comma-separated list, or null when it was told none and is not the production site. */
export function siteOrigins(env: Env = process.env): string | null {
  return env.MASAR_ORIGINS || (production(env) ? PRODUCTION_ORIGINS : null);
}

/** Whether the secret is the one set for it. False when it is worked out, or when there is none. */
export function secretIsSet(env: Env = process.env): boolean {
  return (env.MASAR_SECRET ?? "").length >= 16;
}

/** The application secret, or null when there is none to be had. */
export function applicationSecret(env: Env = process.env): string | null {
  if (secretIsSet(env)) return env.MASAR_SECRET!;
  const url = production(env) ? liveDatabaseUrl(env) : null;
  return url ? crypto.createHmac("sha256", url).update("masar:application-secret:v1").digest("base64url") : null;
}
