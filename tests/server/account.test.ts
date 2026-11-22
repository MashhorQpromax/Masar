import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  beginAuthenticator,
  changeOwnPassword,
  confirmAuthenticator,
  confirmIdentity,
  endOtherSessions,
  removeAuthenticator,
  securityState,
} from "@/server/auth/account";
import { addPasskey, listPasskeys, partyFrom, passkeyRegistration, passkeySignIn, removePasskey, signInWithPasskey, type RelyingParty } from "@/server/auth/passkeys";
import { qrDrawing } from "@/server/auth/qr";
import { readSession, requireConfirmed, type SessionUser } from "@/server/auth/sessions";
import { completeSecondFactor, signInWithCode, signInWithPassword, type Origin, type PasswordResult, type SignInResult } from "@/server/auth/signin";
import { totpAt } from "@/server/auth/totp";
import type { Connection } from "@/server/db/client";
import { auditLog, authSteps, passkeys, users } from "@/server/db/schema";
import { Device } from "../helpers/authenticator";
import { testDb } from "../helpers/db";

const PASSWORD = "a-good-password";
// A low cost keeps the tests quick. The check itself is the same at any cost.
const HASH = bcrypt.hashSync(PASSWORD, 4);

const start = new Date("2026-11-22T09:00:00Z");
const after = (minutes: number, from: Date = start) => new Date(from.getTime() + minutes * 60_000);
const origin: Origin = { ip: "203.0.113.9", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Version/19.0 Mobile/15E148 Safari/604.1" };

const SITE = "https://masar.example";
const rp: RelyingParty = { id: "masar.example", origins: [SITE, "https://www.masar.example"] };

let c: Connection;
let seq = 0;

beforeAll(async () => {
  process.env.MASAR_SECRET = "a-secret-for-these-tests";
  c = await testDb();
});
afterAll(async () => {
  await c.close();
});
beforeEach(async () => {
  // Each test starts with a clean record of attempts, so one test's failures do not block the next one's address.
  await c.db.delete(auditLog);
});

async function person(fields: Partial<typeof users.$inferInsert> = {}) {
  const [row] = await c.db
    .insert(users)
    .values({ name: "موظف تجريبي", email: `account${++seq}@test.local`, passwordHash: HASH, role: "officer", ...fields })
    .returning();
  return row!;
}
const reload = async (id: number) => (await c.db.select().from(users).where(eq(users.id, id)))[0]!;
const noted = (action: string, userId: number) => c.db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.userId, userId)));

function session(result: PasswordResult | SignInResult) {
  if (result.status !== "signed_in") throw new Error(`expected a session, got ${JSON.stringify(result)}`);
  return result.session;
}
const refusal = (result: PasswordResult | SignInResult) => (result.status === "refused" ? result.refusal : result.status);

/** Signs in with the password at the given moment: the session is confirmed for ten minutes from then. */
const enter = async (user: { email: string }, now = start) => session(await signInWithPassword(c.db, { email: user.email, password: PASSWORD, remember: false, origin, now })).token;
const as = (user: typeof users.$inferSelect): SessionUser => ({ id: user.id, name: user.name, email: user.email, role: user.role });

/** Links an authenticator app to the account and returns its secret. */
async function link(user: typeof users.$inferSelect, token: string, now = start) {
  const { secret } = await beginAuthenticator(c.db, { userId: user.id, sessionToken: token, now });
  await confirmAuthenticator(c.db, { userId: user.id, sessionToken: token, code: totpAt(secret, now), actor: { userId: user.id }, now });
  return secret;
}

/** Makes a passkey on the device for a person who has just typed their password. */
async function enroll(user: typeof users.$inferSelect, device: Device, token: string, now = start) {
  const { options, step } = await passkeyRegistration(c.db, { user: as(user), sessionToken: token, rp, now });
  const response = device.create(options);
  await addPasskey(c.db, { userId: user.id, stepToken: step.token, response, rp, userAgent: origin.userAgent, actor: { userId: user.id }, now });
  return response.id;
}

async function enterByPasskey(device: Device, now = start, from = origin) {
  const { options, step } = await passkeySignIn(c.db, { rp, remember: false, now });
  return signInWithPasskey(c.db, { stepToken: step.token, response: device.get(options), rp, origin: from, now });
}

describe("proving who is there before a sign-in method changes", () => {
  it("takes a password typed in the last ten minutes, and no longer", async () => {
    const user = await person();
    const token = await enter(user);
    await expect(requireConfirmed(c.db, token, user.id, after(9))).resolves.toBeUndefined();
    await expect(requireConfirmed(c.db, token, user.id, after(11))).rejects.toMatchObject({ code: "CONFIRM_FIRST" });
    await expect(beginAuthenticator(c.db, { userId: user.id, sessionToken: token, now: after(11) })).rejects.toMatchObject({ code: "CONFIRM_FIRST" });
    expect((await reload(user.id)).totpSecret).toBeNull();
  });

  it("opens again for ten minutes once the password is typed", async () => {
    const user = await person();
    const token = await enter(user);
    await confirmIdentity(c.db, { userId: user.id, sessionToken: token, password: PASSWORD, origin, actor: { userId: user.id }, now: after(30) });
    await expect(requireConfirmed(c.db, token, user.id, after(39))).resolves.toBeUndefined();
    await expect(requireConfirmed(c.db, token, user.id, after(41))).rejects.toMatchObject({ code: "CONFIRM_FIRST" });
    expect(await noted("user.confirm", user.id)).toHaveLength(1);
  });

  it("does not take a sign-in by code or by passkey for a typed password", async () => {
    const user = await person();
    const secret = await link(user, await enter(user));
    const byCode = session(await signInWithCode(c.db, { email: user.email, code: totpAt(secret, after(5)), remember: false, origin, now: after(5) })).token;
    await expect(removeAuthenticator(c.db, { userId: user.id, sessionToken: byCode, actor: { userId: user.id }, now: after(6) })).rejects.toMatchObject({ code: "CONFIRM_FIRST" });
    expect((await reload(user.id)).totpEnabled).toBe(true);
  });

  it("refuses another person's session, and no session at all", async () => {
    const [owner, other] = [await person(), await person()];
    const othersToken = await enter(other);
    await expect(requireConfirmed(c.db, othersToken, owner.id, after(1))).rejects.toMatchObject({ code: "CONFIRM_FIRST" });
    await expect(requireConfirmed(c.db, undefined, owner.id, after(1))).rejects.toMatchObject({ code: "CONFIRM_FIRST" });
    await expect(requireConfirmed(c.db, "not-a-token", owner.id, after(1))).rejects.toMatchObject({ code: "CONFIRM_FIRST" });
  });

  it("counts wrong passwords against the account, and locks it at the fifth", async () => {
    const user = await person();
    const token = await enter(user);
    const confirm = (password: string, minute: number) =>
      confirmIdentity(c.db, { userId: user.id, sessionToken: token, password, origin, actor: { userId: user.id }, now: after(minute) });
    for (let n = 0; n < 5; n++) await expect(confirm("wrong", 20)).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
    await expect(confirm(PASSWORD, 21)).rejects.toMatchObject({ code: "LOCKED" });
    await expect(requireConfirmed(c.db, token, user.id, after(21))).rejects.toMatchObject({ code: "CONFIRM_FIRST" });
    await expect(confirm(PASSWORD, 36)).resolves.toBeUndefined();
  });
});

describe("changing the password", () => {
  it("counts a wrong current password like a wrong password at the door", async () => {
    const user = await person();
    const token = await enter(user);
    const change = (current: string, next: string, minute = 1) =>
      changeOwnPassword(c.db, { userId: user.id, current, next, sessionToken: token, origin, actor: { userId: user.id }, now: after(minute) });
    await expect(change("wrong", "another-password")).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
    expect((await reload(user.id)).failedLogins).toBe(1);
    for (let n = 0; n < 4; n++) await expect(change("wrong", "another-password")).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
    await expect(change(PASSWORD, "another-password", 2)).rejects.toMatchObject({ code: "LOCKED" });
    expect(await bcrypt.compare(PASSWORD, (await reload(user.id)).passwordHash)).toBe(true);
  });

  it("leaves the session it was made from confirmed, and ends the others", async () => {
    const user = await person();
    const [here, elsewhere] = [await enter(user), await enter(user)];
    await changeOwnPassword(c.db, { userId: user.id, current: PASSWORD, next: "another-password", sessionToken: here, origin, actor: { userId: user.id }, now: after(30) });
    await expect(requireConfirmed(c.db, here, user.id, after(35))).resolves.toBeUndefined();
    expect(await readSession(c.db, elsewhere, after(31))).toBeNull();
  });
});

describe("linking an authenticator app", () => {
  it("does nothing until a code from the app proves it holds the key", async () => {
    const user = await person();
    const token = await enter(user);
    const { secret, uri } = await beginAuthenticator(c.db, { userId: user.id, sessionToken: token, now: start });
    expect(uri).toContain(`secret=${secret}`);

    const pending = await reload(user.id);
    expect(pending.totpEnabled).toBe(false);
    // The key is stored sealed: the database never holds it as the app does.
    expect(pending.totpSecret).not.toContain(secret);
    expect((await signInWithPassword(c.db, { email: user.email, password: PASSWORD, remember: false, origin, now: after(1) })).status).toBe("signed_in");

    const finish = (code: string, minute: number) =>
      confirmAuthenticator(c.db, { userId: user.id, sessionToken: token, code, actor: { userId: user.id }, now: after(minute) });
    await expect(finish("000000", 2)).rejects.toMatchObject({ code: "BAD_CODE" });
    await finish(totpAt(secret, after(2)), 2);

    expect((await reload(user.id)).totpEnabled).toBe(true);
    expect(await noted("user.authenticator_on", user.id)).toHaveLength(1);
    expect((await signInWithPassword(c.db, { email: user.email, password: PASSWORD, remember: false, origin, now: after(3) })).status).toBe("second_factor");
  });

  it("does not let the code that switched it on open the door as well", async () => {
    const user = await person();
    const secret = await link(user, await enter(user));
    const half = await signInWithPassword(c.db, { email: user.email, password: PASSWORD, remember: false, origin, now: start });
    if (half.status !== "second_factor") throw new Error("expected the second step");
    expect(refusal(await completeSecondFactor(c.db, { stepToken: half.step.token, code: totpAt(secret, start), origin, now: start }))).toBe("BAD_CODE");
  });

  it("is not replaced quietly while it is on, and comes off only after the password", async () => {
    const user = await person();
    const token = await enter(user);
    await link(user, token);
    await expect(beginAuthenticator(c.db, { userId: user.id, sessionToken: token, now: after(1) })).rejects.toMatchObject({ code: "AUTHENTICATOR_ON" });
    expect((await reload(user.id)).totpEnabled).toBe(true);

    await removeAuthenticator(c.db, { userId: user.id, sessionToken: token, actor: { userId: user.id }, now: after(2) });
    expect(await reload(user.id)).toMatchObject({ totpEnabled: false, totpSecret: null });
    expect((await signInWithPassword(c.db, { email: user.email, password: PASSWORD, remember: false, origin, now: after(3) })).status).toBe("signed_in");
    expect(await noted("user.authenticator_off", user.id)).toHaveLength(1);
  });

  it("draws the key as a code a phone can scan", () => {
    const { size, path } = qrDrawing("otpauth://totp/Masar:someone%40test.local?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Masar");
    expect(size).toBeGreaterThanOrEqual(21);
    // Every QR code starts with the seven dark squares of its corner mark.
    expect(path.startsWith("M0 0h7v1h-7z")).toBe(true);
    expect(path).toMatch(/^(M\d+ \d+h\d+v1h-\d+z)+$/);
  });
});

describe("the site passkeys belong to", () => {
  it("is read from the list of its addresses, the first being its own", () => {
    expect(partyFrom("https://masarfin.com, https://www.masarfin.com")).toEqual({ id: "masarfin.com", origins: ["https://masarfin.com", "https://www.masarfin.com"] });
    expect(partyFrom("http://localhost:3200")).toEqual({ id: "localhost", origins: ["http://localhost:3200"] });
  });

  it("leaves out an address that is not secure or not on the site", () => {
    expect(partyFrom("https://masarfin.com,http://masarfin.com,https://evil.example,https://notmasarfin.com,nonsense")).toEqual({ id: "masarfin.com", origins: ["https://masarfin.com"] });
    expect(partyFrom("http://masarfin.com")).toBeNull();
    expect(partyFrom("")).toBeNull();
    expect(partyFrom(undefined)).toBeNull();
  });
});

describe("passkeys", () => {
  it("are made after the password, and then open the account without it", async () => {
    const user = await person();
    const device = new Device(SITE);
    const credentialId = await enroll(user, device, await enter(user));

    const [stored] = await c.db.select().from(passkeys).where(eq(passkeys.userId, user.id));
    expect(stored).toMatchObject({ credentialId, name: "iPhone · Safari", counter: 0, transports: ["internal"], lastUsedAt: null });
    expect(await noted("user.passkey_add", user.id)).toHaveLength(1);

    const { token } = session(await enterByPasskey(device, after(5)));
    const open = await readSession(c.db, token, after(6));
    expect(open).toMatchObject({ user: { id: user.id }, method: "passkey", confirmedUntil: null });
    expect((await listPasskeys(c.db, user.id))[0]).toMatchObject({ name: "iPhone · Safari", lastUsedAt: after(5) });
    expect((await c.db.select().from(passkeys).where(eq(passkeys.userId, user.id)))[0]!.counter).toBe(1);
    expect(await noted("login", user.id)).toMatchObject([{ details: { method: "password" } }, { details: { method: "passkey" } }]);
  });

  it("work from every address of the site, and from no other", async () => {
    const user = await person();
    const device = new Device("https://www.masar.example");
    await enroll(user, device, await enter(user));
    expect((await enterByPasskey(device, after(1))).status).toBe("signed_in");

    const elsewhere = new Device("https://masar.example.evil.test");
    const { options, step } = await passkeyRegistration(c.db, { user: as(user), sessionToken: await enter(user, after(2)), rp, now: after(2) });
    await expect(
      addPasskey(c.db, { userId: user.id, stepToken: step.token, response: elsewhere.create(options), rp, userAgent: null, actor: { userId: user.id }, now: after(2) }),
    ).rejects.toMatchObject({ code: "PASSKEY_REFUSED" });
    expect(await listPasskeys(c.db, user.id)).toHaveLength(1);
  });

  it("need the session to be confirmed before one is added or removed", async () => {
    const user = await person();
    const device = new Device(SITE);
    const token = await enter(user);
    const credentialId = await enroll(user, device, token);
    const [key] = await listPasskeys(c.db, user.id);

    await expect(passkeyRegistration(c.db, { user: as(user), sessionToken: token, rp, now: after(11) })).rejects.toMatchObject({ code: "CONFIRM_FIRST" });
    await expect(removePasskey(c.db, { userId: user.id, sessionToken: token, passkeyId: key!.id, actor: { userId: user.id }, now: after(11) })).rejects.toMatchObject({ code: "CONFIRM_FIRST" });
    // Someone who came in with the passkey itself has typed no password either.
    const byKey = session(await enterByPasskey(device, after(12))).token;
    await expect(passkeyRegistration(c.db, { user: as(user), sessionToken: byKey, rp, now: after(12) })).rejects.toMatchObject({ code: "CONFIRM_FIRST" });
    expect(await listPasskeys(c.db, user.id)).toMatchObject([{ id: key!.id }]);
    expect(credentialId).toBeTruthy();
  });

  it("are removed by their owner only", async () => {
    const [owner, other] = [await person(), await person()];
    const device = new Device(SITE);
    await enroll(owner, device, await enter(owner));
    const [key] = await listPasskeys(c.db, owner.id);

    await expect(removePasskey(c.db, { userId: other.id, sessionToken: await enter(other), passkeyId: key!.id, actor: { userId: other.id }, now: start })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listPasskeys(c.db, owner.id)).toHaveLength(1);

    await removePasskey(c.db, { userId: owner.id, sessionToken: await enter(owner, after(1)), passkeyId: key!.id, actor: { userId: owner.id }, now: after(1) });
    expect(await listPasskeys(c.db, owner.id)).toHaveLength(0);
    expect(refusal(await enterByPasskey(device, after(2)))).toBe("BAD_PASSKEY");
    expect(await noted("user.passkey_remove", owner.id)).toHaveLength(1);
  });

  it("answer each challenge once", async () => {
    const user = await person();
    const device = new Device(SITE);
    await enroll(user, device, await enter(user));

    const first = await passkeySignIn(c.db, { rp, remember: true, now: after(1) });
    const answer = device.get(first.options);
    const opened = session(await signInWithPasskey(c.db, { stepToken: first.step.token, response: answer, rp, origin, now: after(1) }));
    // "Remember me" was asked with the challenge, so it cannot be switched on by whoever answers.
    expect(opened.expiresAt).toEqual(after(1 + 30 * 24 * 60));

    expect(refusal(await signInWithPasskey(c.db, { stepToken: first.step.token, response: answer, rp, origin, now: after(2) }))).toBe("STEP_EXPIRED");
    const second = await passkeySignIn(c.db, { rp, remember: false, now: after(2) });
    expect(refusal(await signInWithPasskey(c.db, { stepToken: second.step.token, response: answer, rp, origin, now: after(2) }))).toBe("BAD_PASSKEY");
    // The failed answer used the second challenge up as well.
    expect(refusal(await signInWithPasskey(c.db, { stepToken: second.step.token, response: device.get(second.options), rp, origin, now: after(2) }))).toBe("STEP_EXPIRED");
  });

  it("wait five minutes for an answer, and unanswered challenges are cleared", async () => {
    const user = await person();
    const device = new Device(SITE);
    await enroll(user, device, await enter(user));
    const { options, step } = await passkeySignIn(c.db, { rp, remember: false, now: after(1) });
    expect(refusal(await signInWithPasskey(c.db, { stepToken: step.token, response: device.get(options), rp, origin, now: after(7) }))).toBe("STEP_EXPIRED");

    await passkeySignIn(c.db, { rp, remember: false, now: after(20) });
    expect(await c.db.select().from(authSteps).where(eq(authSteps.kind, "passkey_login"))).toHaveLength(1);
  });

  it("refuse a device that did not check a fingerprint, a face or its lock", async () => {
    const user = await person();
    const careless = new Device(SITE, { verifies: false });
    const { options, step } = await passkeyRegistration(c.db, { user: as(user), sessionToken: await enter(user), rp, now: start });
    await expect(
      addPasskey(c.db, { userId: user.id, stepToken: step.token, response: careless.create(options), rp, userAgent: null, actor: { userId: user.id }, now: start }),
    ).rejects.toMatchObject({ code: "PASSKEY_REFUSED" });
    expect(await listPasskeys(c.db, user.id)).toHaveLength(0);
  });

  it("refuse a key that is already someone's, and a challenge asked by someone else", async () => {
    const [owner, other] = [await person(), await person()];
    const device = new Device(SITE);
    const credentialId = await enroll(owner, device, await enter(owner));

    const otherToken = await enter(other);
    const again = await passkeyRegistration(c.db, { user: as(other), sessionToken: otherToken, rp, now: start });
    await expect(
      addPasskey(c.db, { userId: other.id, stepToken: again.step.token, response: new Device(SITE).create(again.options, credentialId), rp, userAgent: null, actor: { userId: other.id }, now: start }),
    ).rejects.toMatchObject({ code: "PASSKEY_KNOWN" });

    const theirs = await passkeyRegistration(c.db, { user: as(other), sessionToken: otherToken, rp, now: start });
    await expect(
      addPasskey(c.db, { userId: owner.id, stepToken: theirs.step.token, response: new Device(SITE).create(theirs.options), rp, userAgent: null, actor: { userId: owner.id }, now: start }),
    ).rejects.toMatchObject({ code: "STEP_EXPIRED" });
    expect(await listPasskeys(c.db, other.id)).toHaveLength(0);
    expect(await listPasskeys(c.db, owner.id)).toHaveLength(1);
  });

  it("stop opening an account that was stopped, and count as failures at the door", async () => {
    const user = await person();
    const device = new Device(SITE);
    await enroll(user, device, await enter(user));
    await c.db.update(users).set({ active: false }).where(eq(users.id, user.id));

    expect(refusal(await enterByPasskey(device, after(1)))).toBe("BAD_PASSKEY");
    expect(await noted("login_failed", user.id)).toMatchObject([{ details: { method: "passkey" }, ip: origin.ip }]);
  });

  it("are refused from an address that has failed too often", async () => {
    const user = await person();
    const device = new Device(SITE);
    await enroll(user, device, await enter(user));
    const from: Origin = { ip: "198.51.100.77", userAgent: "tests" };
    await c.db.insert(auditLog).values(Array.from({ length: 20 }, () => ({ action: "login_failed", entity: "user", entityId: 0, ip: from.ip, createdAt: after(1) })));
    expect(refusal(await enterByPasskey(device, after(2), from))).toBe("TOO_MANY");
    expect((await enterByPasskey(device, after(2))).status).toBe("signed_in");
  });
});

describe("where a person is signed in", () => {
  it("lists the sessions that are open, and marks the one asking", async () => {
    const user = await person();
    const first = await enter(user);
    const second = await enter(user, after(1));
    const state = await securityState(c.db, { userId: user.id, sessionToken: second, now: after(2) });
    expect(state).toMatchObject({ authenticator: false, codeStopped: false, passkeys: [] });
    expect(state.sessions).toMatchObject([
      { method: "password", current: true, createdAt: after(1) },
      { method: "password", current: false, createdAt: start },
    ]);
    // Half a day later the first session has run out and is no longer listed.
    expect((await securityState(c.db, { userId: user.id, sessionToken: first, now: after(12 * 60 + 0.5) })).sessions).toHaveLength(1);
  });

  it("signs out everywhere else, and keeps this device in", async () => {
    const user = await person();
    const [here, elsewhere] = [await enter(user), await enter(user)];
    await endOtherSessions(c.db, { userId: user.id, sessionToken: here, actor: { userId: user.id } });
    expect(await readSession(c.db, here, after(1))).not.toBeNull();
    expect(await readSession(c.db, elsewhere, after(1))).toBeNull();
    expect(await noted("user.sessions_end", user.id)).toHaveLength(1);
  });

  it("says when signing in by code alone has stopped", async () => {
    const user = await person();
    const token = await enter(user);
    await link(user, token);
    for (let n = 0; n < 5; n++) await signInWithCode(c.db, { email: user.email, code: "000000", remember: false, origin, now: after(1) });
    expect((await securityState(c.db, { userId: user.id, sessionToken: token, now: after(2) })).codeStopped).toBe(true);
  });
});
