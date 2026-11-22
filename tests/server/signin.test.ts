import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Connection } from "@/server/db/client";
import { auditLog, authSteps, loginCodes, sessions, users } from "@/server/db/schema";
import { DECOY_HASH, hashCost, hashPassword, verifyPassword } from "@/server/auth/password";
import { seal, tokenHash } from "@/server/auth/secret";
import { endSession, endSessionsOf, readSession, readStep } from "@/server/auth/sessions";
import {
  addressBlocked,
  completeSecondFactor,
  sendLoginCode,
  signInWithCode,
  signInWithPassword,
  type CodeSender,
  type Origin,
  type PasswordResult,
  type SignInResult,
} from "@/server/auth/signin";
import { base32Encode, totpAt } from "@/server/auth/totp";
import { changeOwnPassword, createUser } from "@/server/auth/users";
import { SYSTEM } from "@/server/shared/actor";
import { testDb } from "../helpers/db";

const PASSWORD = "a-good-password";
const TOTP_SECRET = base32Encode(Buffer.from("12345678901234567890"));
// A low cost keeps the tests quick. The check itself is the same at any cost.
const HASH = bcrypt.hashSync(PASSWORD, 4);
const LEGACY_HASH = "$2a$12$B6.SebFF0HKjJZaV7EZFCOOdWmTXVlJJ7PRALs83hJmhsqou2GJ36";

const start = new Date("2026-11-22T09:00:00Z");
const after = (minutes: number, from: Date = start) => new Date(from.getTime() + minutes * 60_000);
const origin: Origin = { ip: "203.0.113.7", userAgent: "tests" };

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
    .values({ name: "موظف تجريبي", email: `person${++seq}@test.local`, passwordHash: HASH, role: "analyst", ...fields })
    .returning();
  return row!;
}
const withAuthenticator = () => person({ totpSecret: seal(TOTP_SECRET), totpEnabled: true });
const reload = async (id: number) => (await c.db.select().from(users).where(eq(users.id, id)))[0]!;
const attempts = (action: string, userId?: number) =>
  c.db.select().from(auditLog).where(userId == null ? eq(auditLog.action, action) : and(eq(auditLog.action, action), eq(auditLog.userId, userId)));

const password = (email: string, pass: string, now = start, from = origin, remember = false) =>
  signInWithPassword(c.db, { email, password: pass, remember, origin: from, now });

function session(result: PasswordResult | SignInResult) {
  if (result.status !== "signed_in") throw new Error(`expected a session, got ${JSON.stringify(result)}`);
  return result.session;
}
const refusal = (result: PasswordResult | SignInResult) => (result.status === "refused" ? result.refusal : result.status);

describe("signing in with a password", () => {
  it("opens a session, and stores only the hash of its token", async () => {
    const user = await person();
    const { token, expiresAt } = session(await password(user.email, PASSWORD));
    expect(expiresAt).toEqual(after(12 * 60));

    const stored = await c.db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(stored).toHaveLength(1);
    expect(stored[0]!.tokenHash).toBe(tokenHash(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored[0]).toMatchObject({ method: "password", ip: origin.ip, userAgent: "tests" });

    const open = await readSession(c.db, token, after(1));
    expect(open?.user).toEqual({ id: user.id, name: user.name, email: user.email, role: "analyst" });
    expect(open?.confirmedUntil).toBeNull();
    expect((await reload(user.id)).lastLoginAt).toEqual(start);
    expect(await attempts("login", user.id)).toMatchObject([{ details: { method: "password" }, ip: origin.ip, entity: "user", entityId: user.id }]);
  });

  it("reads the email whatever its case and the spaces around it", async () => {
    const user = await person({ email: "Mixed.Case@Test.Local" });
    expect((await password("  mixed.case@test.local ", PASSWORD)).status).toBe("signed_in");
    expect((await password("MIXED.CASE@TEST.LOCAL", PASSWORD)).status).toBe("signed_in");
    expect(user.email).toBe("Mixed.Case@Test.Local");
  });

  it("gives one answer for a wrong password, an unknown email and a stopped account", async () => {
    const user = await person();
    const stopped = await person({ active: false });
    expect(refusal(await password(user.email, "wrong"))).toBe("BAD_CREDENTIALS");
    expect(refusal(await password("nobody@test.local", PASSWORD))).toBe("BAD_CREDENTIALS");
    expect(refusal(await password(stopped.email, PASSWORD))).toBe("BAD_CREDENTIALS");
    expect(refusal(await password("", ""))).toBe("BAD_CREDENTIALS");

    expect((await reload(user.id)).failedLogins).toBe(1);
    expect(await c.db.select().from(sessions).where(eq(sessions.userId, stopped.id))).toHaveLength(0);
    const failed = await attempts("login_failed");
    expect(failed).toHaveLength(4);
    expect(failed.find((row) => row.userId == null && (row.details as { email?: string }).email === "nobody@test.local")).toBeTruthy();
    expect(JSON.stringify(failed)).not.toContain(PASSWORD);
  });

  it("locks the account for fifteen minutes after five wrong passwords", async () => {
    const user = await person();
    for (let i = 0; i < 4; i++) expect(refusal(await password(user.email, "wrong"))).toBe("BAD_CREDENTIALS");
    expect((await password(user.email, PASSWORD)).status).toBe("signed_in");
    expect((await reload(user.id)).failedLogins).toBe(0);

    for (let i = 0; i < 5; i++) expect(refusal(await password(user.email, "wrong", after(1)))).toBe("BAD_CREDENTIALS");
    expect((await reload(user.id)).lockedUntil).toEqual(after(16));
    expect(refusal(await password(user.email, PASSWORD, after(2)))).toBe("LOCKED");
    expect(refusal(await password(user.email, PASSWORD, after(15.9)))).toBe("LOCKED");
    expect((await password(user.email, PASSWORD, after(16.1))).status).toBe("signed_in");
    expect(await reload(user.id)).toMatchObject({ failedLogins: 0, lockedUntil: null });
  });

  it("counts two wrong attempts that arrive together as two", async () => {
    const user = await person();
    await Promise.all([password(user.email, "wrong"), password(user.email, "wrong"), password(user.email, "wrong")]);
    expect((await reload(user.id)).failedLogins).toBe(3);
  });

  it("closes every way in to an address after twenty failures in fifteen minutes", async () => {
    const user = await person();
    const attacker: Origin = { ip: "198.51.100.9", userAgent: "tests" };
    for (let i = 0; i < 20; i++) await password(`guess${i}@test.local`, "x", start, attacker);
    expect(await addressBlocked(c.db, attacker.ip, after(1))).toBe(true);
    expect(refusal(await password(user.email, PASSWORD, after(1), attacker))).toBe("TOO_MANY");
    expect(refusal(await signInWithCode(c.db, { email: user.email, code: "123456", remember: false, origin: attacker, now: after(1) }))).toBe("TOO_MANY");
    // The same person from their own address is not affected, and the block lifts by itself.
    expect((await password(user.email, PASSWORD, after(1))).status).toBe("signed_in");
    expect((await password(user.email, PASSWORD, after(16), attacker)).status).toBe("signed_in");
    expect(await addressBlocked(c.db, null, after(1))).toBe(false);
  });
});

describe("a password", () => {
  it("is hashed at the cost the old system used, and its old hashes still open", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hashCost(hash)).toBe(12);
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword("something else", hash)).toBe(false);
    // The live system writes "$2b$" hashes like the one above. This one is in the older "$2a$" form, for "legacy-password".
    expect(await verifyPassword("legacy-password", LEGACY_HASH)).toBe(true);
    expect(await verifyPassword(PASSWORD, "not-a-hash")).toBe(false);
    expect(await verifyPassword(PASSWORD, "")).toBe(false);
  });

  it("costs an unknown email the same work as a known one", async () => {
    expect(DECOY_HASH).toHaveLength(60);
    expect(hashCost(DECOY_HASH)).toBe(12);
    expect(await verifyPassword(PASSWORD, DECOY_HASH)).toBe(false);
  });
});

describe("a session", () => {
  it("lasts half a day, or thirty days when remembered", async () => {
    const user = await person();
    const short = session(await password(user.email, PASSWORD));
    const long = session(await password(user.email, PASSWORD, start, origin, true));
    expect(long.expiresAt).toEqual(after(30 * 24 * 60));
    expect(await readSession(c.db, short.token, after(12 * 60 - 1))).not.toBeNull();
    expect(await readSession(c.db, short.token, after(12 * 60 + 1))).toBeNull();
    expect(await readSession(c.db, long.token, after(29 * 24 * 60))).not.toBeNull();
    expect(await readSession(c.db, long.token, after(30 * 24 * 60 + 1))).toBeNull();
  });

  it("opens for its own token only", async () => {
    const user = await person();
    const { token } = session(await password(user.email, PASSWORD));
    for (const bad of [null, undefined, "", "x", token.slice(0, -1), `${token}x`, tokenHash(token), "a".repeat(43), "'; drop table masar.sessions; --"]) {
      expect(await readSession(c.db, bad, after(1))).toBeNull();
    }
    expect(await readSession(c.db, token, after(1))).not.toBeNull();
  });

  it("ends on sign-out, and for a person whose account is stopped", async () => {
    const user = await person();
    const first = session(await password(user.email, PASSWORD));
    const second = session(await password(user.email, PASSWORD));
    expect(await endSession(c.db, first.token)).toBe(user.id);
    expect(await endSession(c.db, first.token)).toBeNull();
    expect(await readSession(c.db, first.token, after(1))).toBeNull();
    expect(await readSession(c.db, second.token, after(1))).not.toBeNull();

    await c.db.update(users).set({ active: false }).where(eq(users.id, user.id));
    expect(await readSession(c.db, second.token, after(1))).toBeNull();
  });

  it("is cleared from the table once expired, when someone next signs in", async () => {
    const user = await person();
    const old = session(await password(user.email, PASSWORD));
    session(await password(user.email, PASSWORD, after(13 * 60)));
    const left = await c.db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(left).toHaveLength(1);
    expect(left[0]!.tokenHash).not.toBe(tokenHash(old.token));
  });
});

describe("the authenticator as a second step", () => {
  const second = (stepToken: string | null, code: string, now: Date) => completeSecondFactor(c.db, { stepToken, code, origin, now });
  async function begin(email: string, now = start, remember = false) {
    const result = await password(email, PASSWORD, now, origin, remember);
    if (result.status !== "second_factor") throw new Error(`expected a second step, got ${JSON.stringify(result)}`);
    return result.step;
  }

  it("waits for the code before opening anything", async () => {
    const user = await withAuthenticator();
    const step = await begin(user.email, start, true);
    expect(step.expiresAt).toEqual(after(5));
    expect(await c.db.select().from(sessions).where(eq(sessions.userId, user.id))).toHaveLength(0);
    expect(await readSession(c.db, step.token, after(1))).toBeNull();

    const done = session(await second(step.token, totpAt(TOTP_SECRET, after(1)), after(1)));
    expect(done.expiresAt).toEqual(after(30 * 24 * 60, after(1)));
    const [stored] = await c.db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(stored!.method).toBe("password+totp");
  });

  it("takes a code once, and a step once", async () => {
    const user = await withAuthenticator();
    const now = after(1);
    const code = totpAt(TOTP_SECRET, now);
    const first = await begin(user.email);
    const again = await begin(user.email);
    expect((await second(first.token, code, now)).status).toBe("signed_in");
    // The same code on another step, and the next code on the step already used.
    expect(refusal(await second(again.token, code, now))).toBe("BAD_CODE");
    expect(refusal(await second(first.token, totpAt(TOTP_SECRET, after(2)), after(2)))).toBe("STEP_EXPIRED");
    expect((await second(again.token, totpAt(TOTP_SECRET, after(2)), after(2))).status).toBe("signed_in");
  });

  it("opens one session when the same code arrives twice at once", async () => {
    const user = await withAuthenticator();
    const step = await begin(user.email);
    const code = totpAt(TOTP_SECRET, after(1));
    const results = await Promise.all([second(step.token, code, after(1)), second(step.token, code, after(1))]);
    expect(results.filter((r) => r.status === "signed_in")).toHaveLength(1);
    expect(await c.db.select().from(sessions).where(eq(sessions.userId, user.id))).toHaveLength(1);
  });

  it("expires after five minutes and refuses a made-up step", async () => {
    const user = await withAuthenticator();
    const step = await begin(user.email);
    expect(refusal(await second(step.token, totpAt(TOTP_SECRET, after(6)), after(6)))).toBe("STEP_EXPIRED");
    expect(refusal(await second("a".repeat(43), "123456", after(1)))).toBe("STEP_EXPIRED");
    expect(refusal(await second(null, "123456", after(1)))).toBe("STEP_EXPIRED");
    expect(await readStep(c.db, step.token, "passkey_login", after(1))).toBeNull();
  });

  it("locks the account after five wrong codes, even for the right one", async () => {
    const user = await withAuthenticator();
    const step = await begin(user.email);
    for (let i = 0; i < 5; i++) expect(refusal(await second(step.token, "000000", after(1)))).toBe("BAD_CODE");
    expect(refusal(await second(step.token, totpAt(TOTP_SECRET, after(1)), after(1)))).toBe("LOCKED");
    expect(refusal(await password(user.email, PASSWORD, after(2)))).toBe("LOCKED");
    expect(await attempts("login_failed", user.id)).toHaveLength(5);
  });

  it("does not ask for a code when the authenticator was never confirmed", async () => {
    const user = await person({ totpSecret: seal(TOTP_SECRET), totpEnabled: false });
    expect((await password(user.email, PASSWORD)).status).toBe("signed_in");
    expect(refusal(await signInWithCode(c.db, { email: user.email, code: totpAt(TOTP_SECRET, start), remember: false, origin, now: start }))).toBe("BAD_CODE");
  });
});

describe("signing in with a code alone", () => {
  const byCode = (email: string, code: string, now = start) => signInWithCode(c.db, { email, code, remember: false, origin, now });

  it("accepts the authenticator code, typed with spaces or Arabic numerals", async () => {
    const user = await withAuthenticator();
    const code = totpAt(TOTP_SECRET, start);
    const arabic = code.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]!);
    session(await byCode(user.email, `${arabic.slice(0, 3)} ${arabic.slice(3)}`));
    const [stored] = await c.db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(stored!.method).toBe("totp");
    expect(refusal(await byCode(user.email, code))).toBe("BAD_CODE");
  });

  it("gives one answer for a wrong code, a short code and an unknown email", async () => {
    const user = await withAuthenticator();
    expect(refusal(await byCode(user.email, "000000"))).toBe("BAD_CODE");
    expect(refusal(await byCode(user.email, "12345"))).toBe("BAD_CODE");
    expect(refusal(await byCode("nobody@test.local", "123456"))).toBe("BAD_CODE");
    expect((await reload(user.id)).otpFails).toBe(1);
  });

  it("stops after five wrong codes until a password sign-in", async () => {
    const user = await withAuthenticator();
    for (let i = 0; i < 5; i++) await byCode(user.email, "000000", after(i));
    expect((await reload(user.id)).otpFails).toBe(5);
    expect(refusal(await byCode(user.email, totpAt(TOTP_SECRET, after(6)), after(6)))).toBe("BAD_CODE");
    // The password still works, and it reopens the code way in.
    const step = await password(user.email, PASSWORD, after(7));
    if (step.status !== "second_factor") throw new Error("expected a second step");
    session(await completeSecondFactor(c.db, { stepToken: step.step.token, code: totpAt(TOTP_SECRET, after(7)), origin, now: after(7) }));
    expect((await reload(user.id)).otpFails).toBe(0);
    expect((await byCode(user.email, totpAt(TOTP_SECRET, after(9)), after(9))).status).toBe("signed_in");
  });

  it("lets a person in whose password is locked", async () => {
    const user = await withAuthenticator();
    for (let i = 0; i < 5; i++) await password(user.email, "wrong");
    expect(refusal(await password(user.email, PASSWORD, after(1)))).toBe("LOCKED");
    expect((await byCode(user.email, totpAt(TOTP_SECRET, after(1)), after(1))).status).toBe("signed_in");
    expect((await reload(user.id)).lockedUntil).toBeNull();
  });
});

describe("a code sent to the phone", () => {
  const byCode = (email: string, code: string, now = start) => signInWithCode(c.db, { email, code, remember: false, origin, now });
  function outbox() {
    const sent: { phone: string; code: string }[] = [];
    const send: CodeSender = async (phone, code) => {
      sent.push({ phone, code });
      return { ok: true };
    };
    return { sent, send };
  }

  it("goes to the number on the account and signs the person in once", async () => {
    const user = await person({ phone: "055 123 4567" });
    const { sent, send } = outbox();
    await sendLoginCode(c.db, { email: user.email, origin, send, now: start });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.phone).toBe("966551234567");
    expect(sent[0]!.code).toMatch(/^\d{6}$/);

    const [stored] = await c.db.select().from(loginCodes).where(eq(loginCodes.userId, user.id));
    expect(stored!.codeHash).not.toContain(sent[0]!.code);
    expect(stored!.expiresAt).toEqual(after(5));

    session(await byCode(user.email, sent[0]!.code, after(1)));
    expect((await c.db.select().from(sessions).where(eq(sessions.userId, user.id)))[0]!.method).toBe("whatsapp");
    expect(refusal(await byCode(user.email, sent[0]!.code, after(2)))).toBe("BAD_CODE");
    expect(await attempts("login_code_sent", user.id)).toMatchObject([{ details: { channel: "whatsapp" } }]);
  });

  it("expires after five minutes", async () => {
    const user = await person({ phone: "0551234567" });
    const { sent, send } = outbox();
    await sendLoginCode(c.db, { email: user.email, origin, send, now: start });
    expect(refusal(await byCode(user.email, sent[0]!.code, after(5.1)))).toBe("BAD_CODE");
  });

  it("is retired by the code sent after it", async () => {
    const user = await person({ phone: "0551234567" });
    const { sent, send } = outbox();
    await sendLoginCode(c.db, { email: user.email, origin, send, now: start });
    await sendLoginCode(c.db, { email: user.email, origin, send, now: after(1) });
    expect(sent).toHaveLength(2);
    if (sent[0]!.code !== sent[1]!.code) expect(refusal(await byCode(user.email, sent[0]!.code, after(2)))).toBe("BAD_CODE");
    expect((await byCode(user.email, sent[1]!.code, after(2))).status).toBe("signed_in");
  });

  it("says nothing and sends nothing for an unknown email, a stopped account or an account without a phone", async () => {
    const { sent, send } = outbox();
    const noPhone = await person();
    const stopped = await person({ phone: "0551234567", active: false });
    await sendLoginCode(c.db, { email: "nobody@test.local", origin, send, now: start });
    await sendLoginCode(c.db, { email: noPhone.email, origin, send, now: start });
    await sendLoginCode(c.db, { email: stopped.email, origin, send, now: start });
    expect(sent).toHaveLength(0);
    expect(await c.db.select().from(loginCodes).where(eq(loginCodes.userId, noPhone.id))).toHaveLength(0);
  });

  it("sends at most three to a person and five from an address in fifteen minutes", async () => {
    const { sent, send } = outbox();
    const user = await person({ phone: "0551234567" });
    for (let i = 0; i < 5; i++) await sendLoginCode(c.db, { email: user.email, origin, send, now: after(i) });
    expect(sent).toHaveLength(3);
    await sendLoginCode(c.db, { email: user.email, origin, send, now: after(16) });
    expect(sent).toHaveLength(4);

    const other = await person({ phone: "0557654321" });
    await sendLoginCode(c.db, { email: other.email, origin, send, now: after(17) });
    expect(sent).toHaveLength(5);
    const third = await person({ phone: "0550000001" });
    await sendLoginCode(c.db, { email: third.email, origin, send, now: after(18) });
    await sendLoginCode(c.db, { email: third.email, origin, send, now: after(19) });
    await sendLoginCode(c.db, { email: third.email, origin, send, now: after(20) });
    // Five went out from this address since minute 16 (one, one, three): the next is held back.
    const fourth = await person({ phone: "0550000002" });
    await sendLoginCode(c.db, { email: fourth.email, origin, send, now: after(21) });
    expect(sent.filter((m) => m.phone === "966550000002")).toHaveLength(0);
    await sendLoginCode(c.db, { email: fourth.email, origin: { ip: "203.0.113.99", userAgent: null }, send, now: after(21) });
    expect(sent.filter((m) => m.phone === "966550000002")).toHaveLength(1);
  });

  it("gives up on a code after five wrong tries at it", async () => {
    const user = await person({ phone: "0551234567" });
    const { sent, send } = outbox();
    await sendLoginCode(c.db, { email: user.email, origin, send, now: start });
    const wrong = sent[0]!.code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await byCode(user.email, wrong, after(1));
    expect(refusal(await byCode(user.email, sent[0]!.code, after(2)))).toBe("BAD_CODE");
  });

  it("records a delivery that failed, and never the code", async () => {
    const user = await person({ phone: "0551234567" });
    let code = "";
    await sendLoginCode(c.db, {
      email: user.email,
      origin,
      now: start,
      send: async (_phone, sentCode) => {
        code = sentCode;
        throw new Error("network down");
      },
    });
    const [row] = await attempts("login_code_sent", user.id);
    expect(row!.details).toMatchObject({ channel: "whatsapp", failed: expect.stringContaining("network down") });
    expect(JSON.stringify(row)).not.toContain(code);
  });
});

describe("accounts", () => {
  const admin = { ...SYSTEM };

  it("are created with a hashed password and sign in with it", async () => {
    const { id } = await createUser(c.db, { name: "  مدير تجريبي ", email: " New.Admin@Test.Local ", role: "admin", password: "a-new-password", actor: admin, now: start });
    const user = await reload(id);
    expect(user).toMatchObject({ name: "مدير تجريبي", email: "new.admin@test.local", role: "admin", active: true, phone: null });
    expect(user.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(user.passwordHash).not.toContain("a-new-password");
    expect((await password("new.admin@test.local", "a-new-password")).status).toBe("signed_in");
    expect(await attempts("user.create")).toMatchObject([{ entity: "user", entityId: id, details: { role: "admin" } }]);
  });

  it("are refused with a taken email, a weak password or a role that does not exist", async () => {
    const user = await person();
    const base = { name: "شخص", email: "fresh@test.local", role: "viewer", password: "a-new-password", actor: admin };
    await expect(createUser(c.db, { ...base, email: user.email.toUpperCase() })).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
    await expect(createUser(c.db, { ...base, password: "short" })).rejects.toMatchObject({ code: "PASSWORD_SHORT" });
    await expect(createUser(c.db, { ...base, password: "a".repeat(80) })).rejects.toMatchObject({ code: "PASSWORD_LONG" });
    await expect(createUser(c.db, { ...base, role: "owner" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(createUser(c.db, { ...base, email: "not-an-email" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(createUser(c.db, { ...base, name: "  " })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(createUser(c.db, { ...base, phone: "123" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await c.db.select().from(users).where(eq(users.email, "fresh@test.local"))).toHaveLength(0);
  });

  it("change their own password, which ends their other sessions", async () => {
    const user = await person();
    const here = session(await password(user.email, PASSWORD));
    const elsewhere = session(await password(user.email, PASSWORD));
    const actor = { userId: user.id };
    await expect(changeOwnPassword(c.db, { userId: user.id, current: "wrong", next: "another-password", actor })).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
    await expect(changeOwnPassword(c.db, { userId: user.id, current: PASSWORD, next: "short", actor })).rejects.toMatchObject({ code: "PASSWORD_SHORT" });
    await changeOwnPassword(c.db, { userId: user.id, current: PASSWORD, next: "another-password", keepToken: here.token, actor, now: after(1) });

    expect(await readSession(c.db, here.token, after(2))).not.toBeNull();
    expect(await readSession(c.db, elsewhere.token, after(2))).toBeNull();
    expect(refusal(await password(user.email, PASSWORD, after(2)))).toBe("BAD_CREDENTIALS");
    expect((await password(user.email, "another-password", after(2))).status).toBe("signed_in");

    await endSessionsOf(c.db, user.id);
    expect(await readSession(c.db, here.token, after(3))).toBeNull();
  });

  it("leave no half-way sign-in behind once it is finished", async () => {
    const user = await withAuthenticator();
    const step = await password(user.email, PASSWORD);
    if (step.status !== "second_factor") throw new Error("expected a second step");
    await completeSecondFactor(c.db, { stepToken: step.step.token, code: totpAt(TOTP_SECRET, start), origin, now: start });
    expect(await c.db.select().from(authSteps).where(eq(authSteps.userId, user.id))).toHaveLength(0);
  });
});
