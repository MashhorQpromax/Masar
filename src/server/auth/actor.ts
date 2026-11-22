import "server-only";
import { dataMode } from "../db/client";
import { SYSTEM, type Actor } from "../shared/actor";

/**
 * Who is using the app. Every page and every action calls this first.
 *
 * Sign-in is not ported to the rebuild yet. Until it is, the app only runs on demo data, and this
 * function refuses to serve a real database. It fails closed: real data is never shown to a visitor
 * who has not signed in.
 */
export async function requireActor(): Promise<Actor> {
  if (dataMode() === "demo") return SYSTEM;
  throw new Error("Sign-in is not available in this build. Real data is not served without it.");
}
