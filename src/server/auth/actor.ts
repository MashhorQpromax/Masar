import "server-only";
import { redirect } from "next/navigation";
import { can, type Permission, type Role } from "@/domain/auth";
import { dataMode } from "../db/client";
import type { Actor } from "../shared/actor";
import { currentSession, requestOrigin } from "./request";

/** The person using the app in this request. */
export interface CurrentUser extends Actor {
  name: string;
  role: Role;
  /** No one signed in: the build runs on fictional data only. */
  demo: boolean;
}

const DEMO: CurrentUser = { userId: null, name: "عرض تجريبي", role: "admin", demo: true };

/**
 * Who is using the app. Every page and every action calls this first, and names the permission it needs
 * when it changes something or shows something private.
 *
 * It fails closed. Without a session the visitor goes to the sign-in screen; without the permission, to a
 * page that says so. Real data is never read before this returns. A build with no database has no accounts
 * and no real data: there, and only there, the visitor is let in as a demo.
 */
export async function requireActor(permission?: Permission): Promise<CurrentUser> {
  if (dataMode() === "demo") return DEMO;
  const session = await currentSession();
  if (!session) redirect("/login");
  if (permission && !can(session.user.role, permission)) redirect("/denied");
  const { ip } = await requestOrigin();
  return { userId: session.user.id, name: session.user.name, role: session.user.role, ip, demo: false };
}
