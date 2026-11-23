"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { requireActor } from "@/server/auth/actor";
import { SESSION_COOKIE } from "@/server/auth/request";
import { createUser, resetPassword, resetSignIn, unlockUser, updateUser, type By } from "@/server/auth/users";
import { getDb, type Db } from "@/server/db/client";
import { DomainError } from "@/server/shared/errors";

/** What every change to an account answers: that it was made, or the code of why it was not. */
export interface UsersAnswer {
  done?: boolean;
  error?: string;
}

/**
 * Runs one change to someone's account. Only a person who manages accounts may. The services ask
 * that they typed their own password within the last few minutes, and `CONFIRM_FIRST` tells the page
 * to ask for it. A build without a database has made-up accounts, which stay as they are.
 */
async function asManager(run: (db: Db, by: By) => Promise<unknown>): Promise<UsersAnswer> {
  const actor = await requireActor("user.manage");
  if (actor.demo || actor.userId == null) return { error: "DEMO" };
  try {
    await run(await getDb(), { actor, sessionToken: (await cookies()).get(SESSION_COOKIE)?.value ?? null });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.code };
    throw error;
  }
  revalidatePath("/users");
  return { done: true };
}

const id = z.number().int().positive();
const typed = z.string().max(200);
const bad: UsersAnswer = { error: "INVALID_INPUT" };

const newcomer = z.object({ name: typed, email: typed, role: typed, phone: typed, password: typed });

/** Adds a person to the office. The service checks each field and hashes the password. */
export async function addUser(input: { name: string; email: string; role: string; phone: string; password: string }): Promise<UsersAnswer> {
  const parsed = newcomer.safeParse(input);
  if (!parsed.success) return bad;
  const { phone, ...rest } = parsed.data;
  return asManager((db, by) => createUser(db, { ...rest, phone: phone.trim() || null, ...by }));
}

/** Changes a person's role and the mobile their sign-in code goes to. */
export async function saveUser(userId: number, change: { role: string; phone: string }): Promise<UsersAnswer> {
  const parsed = z.object({ userId: id, change: z.object({ role: typed, phone: typed }) }).safeParse({ userId, change });
  if (!parsed.success) return bad;
  return asManager((db, by) => updateUser(db, { userId: parsed.data.userId, change: parsed.data.change, ...by }));
}

/** Stops an account, which signs it out everywhere, or lets it in again. */
export async function setUserActive(userId: number, active: boolean): Promise<UsersAnswer> {
  const parsed = z.object({ userId: id, active: z.boolean() }).safeParse({ userId, active });
  if (!parsed.success) return bad;
  return asManager((db, by) => updateUser(db, { userId: parsed.data.userId, change: { active: parsed.data.active }, ...by }));
}

/** Gives a person who lost their password a new one. */
export async function giveNewPassword(userId: number, password: string): Promise<UsersAnswer> {
  const parsed = z.object({ userId: id, password: typed }).safeParse({ userId, password });
  if (!parsed.success) return bad;
  return asManager((db, by) => resetPassword(db, { ...parsed.data, ...by }));
}

/** Leaves a person who lost their phone with the password as their only way in. */
export async function resetUserSignIn(userId: number): Promise<UsersAnswer> {
  const parsed = id.safeParse(userId);
  if (!parsed.success) return bad;
  return asManager((db, by) => resetSignIn(db, { userId: parsed.data, ...by }));
}

/** Lifts the lock wrong attempts put on an account. */
export async function unlockUserNow(userId: number): Promise<UsersAnswer> {
  const parsed = id.safeParse(userId);
  if (!parsed.success) return bad;
  return asManager((db, by) => unlockUser(db, { userId: parsed.data, ...by }));
}
