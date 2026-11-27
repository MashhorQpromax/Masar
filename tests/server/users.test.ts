import bcrypt from "bcryptjs";
import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { issueSession, readSession } from "@/server/auth/sessions";
import { signInWithPassword, type Origin, type PasswordResult } from "@/server/auth/signin";
import { createUser, listUsers, resetPassword, resetSignIn, unlockUser, updateUser } from "@/server/auth/users";
import type { Connection } from "@/server/db/client";
import { auditLog, passkeys, sessions, users } from "@/server/db/schema";
import { testDb } from "../helpers/db";

let c: Connection;
const now = new Date("2026-11-22T09:00:00Z");
const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
const origin: Origin = { ip: "203.0.113.9", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15" };
const PASSWORD = "a-good-password";
const HASH = bcrypt.hashSync(PASSWORD, 4);
const id: Record<string, number> = {};

beforeAll(async () => {
  c = await testDb();
  for (const [name, role] of [
    ["عبدالله", "admin"],
    ["منى", "analyst"],
    ["خالد", "officer"],
  ] as const) {
    const [row] = await c.db.insert(users).values({ name, email: `${role}@test.local`, role, passwordHash: HASH }).returning({ id: users.id });
    id[name] = row!.id;
  }
  adminToken = (await issueSession(c.db, { userId: id["عبدالله"]!, remember: true, method: "password", ip: "10.0.0.7", userAgent: origin.userAgent, now })).token;
  // The tests below run over an hour of made-up time. The confirmation is stretched to cover it; its ten minutes have a test of their own.
  await c.db.update(sessions).set({ confirmedUntil: later(24 * 60) });
});
afterAll(async () => {
  await c.close();
});

const admin = () => ({ userId: id["عبدالله"]!, ip: "10.0.0.7" });
/** The admin, acting from a session that typed its password a moment ago. */
let adminToken = "";
/**
 * A call that names no time of its own happens late in the made-up day, after everything the tests set
 * up and inside the stretched confirmation. It never falls back on the clock of the machine running it.
 */
const manager = () => ({ actor: admin(), sessionToken: adminToken, now: later(23 * 60) });
const code = async (run: () => Promise<unknown>) => run().then(() => "ok", (error) => error.code ?? String(error));
const row = async (name: string) => (await c.db.select().from(users).where(eq(users.id, id[name]!)))[0]!;
const lastAudit = async () => (await c.db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(1))[0]!;
const enter = (email: string, password = PASSWORD, at = now): Promise<PasswordResult> => signInWithPassword(c.db, { email, password, remember: false, origin, now: at });
const token = (result: PasswordResult): string => {
  if (result.status !== "signed_in") throw new Error(`not signed in: ${result.status}`);
  return result.session.token;
};

describe("the people of the office", () => {
  it("are listed with how each one enters and where they stand", async () => {
    await c.db.insert(passkeys).values({ userId: id["منى"]!, credentialId: "cred-mona", publicKey: "key", name: "iPhone" });
    await c.db.update(users).set({ totpEnabled: true }).where(eq(users.id, id["منى"]!));
    const open = token(await enter("officer@test.local"));
    const lines = await listUsers(c.db, later(1));
    expect(lines.map((line) => line.name)).toEqual(["خالد", "عبدالله", "منى"]);
    const by = Object.fromEntries(lines.map((line) => [line.name, line]));
    expect(by["منى"]).toMatchObject({ role: "analyst", active: true, authenticator: true, passkeys: 1, sessions: 0, lockedUntil: null });
    expect(by["خالد"]).toMatchObject({ role: "officer", sessions: 1, passkeys: 0, authenticator: false });
    expect(by["خالد"]!.lastLoginAt).toEqual(now);
    expect(await readSession(c.db, open, later(1))).not.toBeNull();
    // Nothing a list could leak: no hash and no secret travels with a line.
    expect(JSON.stringify(lines)).not.toMatch(/\$2[aby]\$|passwordHash|totpSecret/);
  });

  it("show a lock only while it lasts, and put a stopped account last", async () => {
    await c.db.update(users).set({ lockedUntil: later(10) }).where(eq(users.id, id["خالد"]!));
    expect((await listUsers(c.db, later(5))).find((line) => line.name === "خالد")!.lockedUntil).toEqual(later(10));
    expect((await listUsers(c.db, later(11))).find((line) => line.name === "خالد")!.lockedUntil).toBeNull();
    await c.db.update(users).set({ lockedUntil: null, active: false }).where(eq(users.id, id["خالد"]!));
    expect((await listUsers(c.db, later(5))).map((line) => line.name)).toEqual(["عبدالله", "منى", "خالد"]);
    await c.db.update(users).set({ active: true }).where(eq(users.id, id["خالد"]!));
  });
});

describe("changing an account", () => {
  it("gives a person another role, and the log says from what to what", async () => {
    const open = token(await enter("officer@test.local", PASSWORD, later(2)));
    expect(await updateUser(c.db, { userId: id["خالد"]!, change: { role: "analyst" }, ...manager(), now: later(3) })).toEqual({ changed: ["role"] });
    expect((await row("خالد")).role).toBe("analyst");
    // The session stays and carries the new role from its next request.
    expect((await readSession(c.db, open, later(4)))!.user.role).toBe("analyst");
    expect(await lastAudit()).toMatchObject({ action: "user.update", entity: "user", entityId: id["خالد"], userId: id["عبدالله"], details: { changed: ["role"], role: { from: "officer", to: "analyst" } } });
  });

  it("stops an account and signs it out everywhere at once", async () => {
    const open = token(await enter("officer@test.local", PASSWORD, later(5)));
    expect(await readSession(c.db, open, later(6))).not.toBeNull();
    await updateUser(c.db, { userId: id["خالد"]!, change: { active: false }, ...manager(), now: later(6) });
    expect(await readSession(c.db, open, later(7))).toBeNull();
    expect((await enter("officer@test.local", PASSWORD, later(7))).status).toBe("refused");
    expect((await listUsers(c.db, later(7))).find((line) => line.name === "خالد")).toMatchObject({ active: false, sessions: 0 });
    const [stopped] = await c.db.select().from(auditLog).where(eq(auditLog.action, "user.update")).orderBy(desc(auditLog.id)).limit(1);
    expect(stopped!.details).toMatchObject({ changed: ["active"], active: false });
    // Started again, the old session does not come back: the person signs in anew.
    await updateUser(c.db, { userId: id["خالد"]!, change: { active: true }, ...manager(), now: later(8) });
    expect(await readSession(c.db, open, later(9))).toBeNull();
    expect((await enter("officer@test.local", PASSWORD, later(9))).status).toBe("signed_in");
  });

  it("keeps the sign-in mobile in one form and never writes it to the log", async () => {
    expect(await updateUser(c.db, { userId: id["منى"]!, change: { phone: "055 123 4567" }, ...manager() })).toEqual({ changed: ["phone"] });
    expect((await row("منى")).phone).toBe("966551234567");
    expect(JSON.stringify((await lastAudit()).details)).not.toContain("551234567");
    // The same number written another way is not a change, and writes nothing.
    const before = (await lastAudit()).id;
    expect(await updateUser(c.db, { userId: id["منى"]!, change: { phone: "+966 55 123 4567", role: "analyst" }, ...manager() })).toEqual({ changed: [] });
    expect((await lastAudit()).id).toBe(before);
    expect(await code(() => updateUser(c.db, { userId: id["منى"]!, change: { phone: "123" }, ...manager() }))).toBe("BAD_PHONE");
    expect(await updateUser(c.db, { userId: id["منى"]!, change: { phone: "" }, ...manager() })).toEqual({ changed: ["phone"] });
    expect((await row("منى")).phone).toBeNull();
  });

  it("never lets a person change their own role or stop their own account", async () => {
    expect(await code(() => updateUser(c.db, { userId: id["عبدالله"]!, change: { role: "viewer" }, ...manager() }))).toBe("OWN_ACCOUNT");
    expect(await code(() => updateUser(c.db, { userId: id["عبدالله"]!, change: { active: false }, ...manager() }))).toBe("OWN_ACCOUNT");
    expect(await row("عبدالله")).toMatchObject({ role: "admin", active: true });
    // Their own sign-in mobile is theirs to set.
    expect(await updateUser(c.db, { userId: id["عبدالله"]!, change: { phone: "0500000001", role: "admin", active: true }, ...manager() })).toEqual({ changed: ["phone"] });
  });

  it("refuses what is not a role, and an account that is not there", async () => {
    expect(await code(() => updateUser(c.db, { userId: id["منى"]!, change: { role: "owner" }, ...manager() }))).toBe("INVALID_INPUT");
    expect(await code(() => updateUser(c.db, { userId: id["منى"]!, change: { active: "yes" }, ...manager() }))).toBe("INVALID_INPUT");
    expect(await code(() => updateUser(c.db, { userId: 9999, change: { role: "viewer" }, ...manager() }))).toBe("NOT_FOUND");
  });
});

describe("a way back in for someone who lost theirs", () => {
  it("sets a new password, lifts the lock and signs the person out", async () => {
    // Her authenticator is on, so a session is opened for her directly instead of through the door.
    const open = (await c.db.transaction((tx) => issueSession(tx, { userId: id["منى"]!, remember: false, method: "password+totp", ip: origin.ip, userAgent: origin.userAgent, now: later(20) }))).token;
    expect(await readSession(c.db, open, later(20))).not.toBeNull();
    await c.db.update(users).set({ lockedUntil: later(40), failedLogins: 3 }).where(eq(users.id, id["منى"]!));
    expect(await code(() => resetPassword(c.db, { userId: id["منى"]!, password: "short", ...manager() }))).toBe("PASSWORD_SHORT");
    await resetPassword(c.db, { userId: id["منى"]!, password: "a-brand-new-password", ...manager(), now: later(21) });
    expect(await readSession(c.db, open, later(22))).toBeNull();
    expect(await row("منى")).toMatchObject({ lockedUntil: null, failedLogins: 0 });
    expect((await enter("analyst@test.local", PASSWORD, later(22))).status).toBe("refused");
    const again = await enter("analyst@test.local", "a-brand-new-password", later(23));
    // The authenticator is still on, so the new password opens the second step and not the door.
    expect(again.status).toBe("second_factor");
    const log = await c.db.select().from(auditLog).where(eq(auditLog.action, "user.password_reset"));
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ entityId: id["منى"], userId: id["عبدالله"] });
    expect(JSON.stringify(log[0]!.details ?? {})).not.toContain("brand-new");
    expect(await code(() => resetPassword(c.db, { userId: id["عبدالله"]!, password: "a-brand-new-password", ...manager() }))).toBe("OWN_ACCOUNT");
    expect(await code(() => resetPassword(c.db, { userId: 9999, password: "a-brand-new-password", ...manager() }))).toBe("NOT_FOUND");
  });

  it("takes away the authenticator and the passkeys, and leaves the password", async () => {
    expect(await row("منى")).toMatchObject({ totpEnabled: true });
    expect(await resetSignIn(c.db, { userId: id["منى"]!, ...manager(), now: later(30) })).toEqual({ passkeys: 1, authenticator: true });
    expect(await row("منى")).toMatchObject({ totpEnabled: false, totpSecret: null, otpFails: 0 });
    expect(await c.db.select().from(passkeys).where(eq(passkeys.userId, id["منى"]!))).toHaveLength(0);
    expect((await enter("analyst@test.local", "a-brand-new-password", later(31))).status).toBe("signed_in");
    expect(await lastAudit()).toMatchObject({ action: "login" });
    const [reset] = await c.db.select().from(auditLog).where(eq(auditLog.action, "user.signin_reset"));
    expect(reset).toMatchObject({ entityId: id["منى"], details: { passkeys: 1, authenticator: true } });
    expect(await code(() => resetSignIn(c.db, { userId: id["عبدالله"]!, ...manager() }))).toBe("OWN_ACCOUNT");
  });

  it("lifts a lock without waiting for it to pass", async () => {
    for (let attempt = 0; attempt < 5; attempt++) await enter("officer@test.local", "wrong-password", later(50 + attempt));
    expect((await enter("officer@test.local", PASSWORD, later(56))).status).toBe("refused");
    expect((await listUsers(c.db, later(56))).find((line) => line.name === "خالد")!.lockedUntil).not.toBeNull();
    await unlockUser(c.db, { userId: id["خالد"]!, ...manager(), now: later(57) });
    expect((await enter("officer@test.local", PASSWORD, later(58))).status).toBe("signed_in");
    expect((await c.db.select().from(auditLog).where(eq(auditLog.action, "user.unlock")))[0]).toMatchObject({ entityId: id["خالد"], userId: id["عبدالله"] });
  });

  it("opens a new account with its mobile in the one form", async () => {
    const made = await createUser(c.db, { name: "سارة", email: "sara@test.local", role: "viewer", password: "a-good-password", phone: "0559876543", ...manager(), now });
    const [sara] = await c.db.select().from(users).where(eq(users.id, made.id));
    expect(sara).toMatchObject({ name: "سارة", role: "viewer", phone: "966559876543", active: true });
    expect(sara!.passwordHash).not.toContain("a-good-password");
    expect(await lastAudit()).toMatchObject({ action: "user.create", entityId: made.id, details: { role: "viewer" } });
  });
});

describe("the password is asked before an account changes", () => {
  const target = () => id["خالد"]!;
  let sultan = 0;
  const session = (userId: number, method: "password" | "passkey" | "whatsapp", at: Date) =>
    issueSession(c.db, { userId, remember: true, method, ip: "10.0.0.8", userAgent: origin.userAgent, now: at }).then((issued) => issued.token);
  /** Every change a manager can make to someone's account. */
  const changes = (by: { actor: { userId: number | null; ip?: string }; sessionToken?: string | null }, at: Date): [string, () => Promise<unknown>][] => [
    ["a new account", () => createUser(c.db, { name: "جديد", email: "new-one@test.local", role: "viewer", password: "a-good-password", ...by, now: at })],
    ["a role", () => updateUser(c.db, { userId: target(), change: { role: "viewer" }, ...by, now: at })],
    ["a stop", () => updateUser(c.db, { userId: target(), change: { active: false }, ...by, now: at })],
    ["a new password", () => resetPassword(c.db, { userId: target(), password: "another-good-password", ...by, now: at })],
    ["a reset of the ways in", () => resetSignIn(c.db, { userId: target(), ...by, now: at })],
    ["a lifted lock", () => unlockUser(c.db, { userId: target(), ...by, now: at })],
  ];
  const state = async () => ({
    people: (await c.db.select().from(users)).map(({ updatedAt: _, ...person }) => person),
    events: (await c.db.select().from(auditLog)).length,
  });

  beforeAll(async () => {
    const [row] = await c.db.insert(users).values({ name: "سلطان", email: "sultan@test.local", role: "admin", passwordHash: HASH }).returning({ id: users.id });
    sultan = row!.id;
  });

  it("refuses every change from a session that has not typed it, and changes nothing", async () => {
    const at = later(100);
    const before = await state();
    const actor = { userId: sultan, ip: "10.0.0.8" };
    const tries = {
      "no session at all": { actor },
      "a token that is no session": { actor, sessionToken: "not-a-token" },
      "a session opened by a fingerprint": { actor, sessionToken: await session(sultan, "passkey", at) },
      "a session opened by a WhatsApp code": { actor, sessionToken: await session(sultan, "whatsapp", at) },
      // Typed, but longer ago than the ten minutes it counts for.
      "a password typed eleven minutes ago": { actor, sessionToken: await session(sultan, "password", later(89)) },
      // Another manager's confirmed session does not speak for this one.
      "someone else's session": { actor, sessionToken: adminToken },
    };
    for (const [how, by] of Object.entries(tries)) {
      for (const [what, change] of changes(by, at)) expect(await code(change), `${what} from ${how}`).toBe("CONFIRM_FIRST");
    }
    expect(await state()).toEqual(before);
  });

  it("lets every change through for ten minutes after the password", async () => {
    const typed = await session(sultan, "password", later(110));
    const by = { actor: { userId: sultan, ip: "10.0.0.8" }, sessionToken: typed };
    for (const [what, change] of changes(by, later(119))) expect(await code(change), what).toBe("ok");
    expect(await row("خالد")).toMatchObject({ role: "viewer", active: false });
    // One minute later the ten have passed.
    expect(await code(() => updateUser(c.db, { userId: target(), change: { active: true }, ...by, now: later(121) }))).toBe("CONFIRM_FIRST");
    expect((await row("خالد")).active).toBe(false);
  });

  it("checks what was typed before asking, and says nothing about other accounts until it is typed", async () => {
    const by = { actor: { userId: sultan, ip: "10.0.0.8" } };
    // A password that could never be saved is refused as such: there is no point in confirming for it.
    expect(await code(() => resetPassword(c.db, { userId: target(), password: "short", ...by }))).toBe("PASSWORD_SHORT");
    expect(await code(() => createUser(c.db, { name: "جديد", email: "x@test.local", role: "viewer", password: "short", ...by }))).toBe("PASSWORD_SHORT");
    expect(await code(() => updateUser(c.db, { userId: target(), change: { phone: "123" }, ...by }))).toBe("BAD_PHONE");
    // Whether an address has an account, or an account exists at all, is not for a session that has not confirmed.
    expect(await code(() => createUser(c.db, { name: "جديد", email: "admin@test.local", role: "viewer", password: "a-good-password", ...by }))).toBe("CONFIRM_FIRST");
    expect(await code(() => unlockUser(c.db, { userId: 9999, ...by }))).toBe("CONFIRM_FIRST");
    expect(await code(() => resetSignIn(c.db, { userId: 9999, ...by }))).toBe("CONFIRM_FIRST");
  });

  it("lets the system itself act, which has no session: the script that makes the first account", async () => {
    const made = await createUser(c.db, { name: "أول", email: "first@test.local", role: "admin", password: "a-good-password", actor: { userId: null } });
    expect(await lastAudit()).toMatchObject({ action: "user.create", entityId: made.id, userId: null });
  });
});
