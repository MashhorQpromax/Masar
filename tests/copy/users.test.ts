import { describe, expect, it } from "vitest";
import { timeText } from "@/copy/format";
import { accountsText, lastSeenText, ROLE_SAY, signedInText, standingOf, standingText, USERS_ERROR_CODES, usersError, waysText } from "@/copy/users";
import { can, PERMISSION_NAMES, ROLES } from "@/domain/auth";

const broken = /undefined|NaN|null|\[object|—|–/;
const strip = (text: string) => text.replace(/[⁦⁩]/g, "");

/** Every refusal the services of the accounts screen can answer with, and the two its actions add. */
const REFUSALS = ["EMAIL_TAKEN", "PASSWORD_SHORT", "PASSWORD_LONG", "BAD_PHONE", "INVALID_INPUT", "OWN_ACCOUNT", "NOT_FOUND", "FORBIDDEN", "CONFIRM_FIRST", "DEMO"];

describe("what each role is said to be for", () => {
  it("has a line for every role, said plainly and ended", () => {
    for (const role of ROLES) {
      expect(ROLE_SAY[role], role).toMatch(/[؀-ۿ]/);
      expect(ROLE_SAY[role], role).not.toMatch(broken);
      expect(ROLE_SAY[role].endsWith("."), role).toBe(true);
    }
  });

  it("holds each line to what the role may really do", () => {
    // "كل شيء، ومعه الحسابات وسجل التدقيق."
    for (const permission of PERMISSION_NAMES) expect(can("admin", permission), permission).toBe(true);
    for (const role of ["analyst", "officer", "viewer"] as const) {
      expect(can(role, "user.manage"), role).toBe(false);
      expect(can(role, "audit.view"), role).toBe(false);
    }
    // "يعمل على الملفات، ويتحقق من المستندات ويصحح شروط الجهات."
    for (const permission of ["client.create", "client.edit", "deal.edit", "doc.upload", "doc.verify", "lender.manage"] as const) expect(can("analyst", permission), permission).toBe(true);
    // "يفتح الملفات ويعدّل الصفقات ويرفع المستندات ويراسل العملاء."
    for (const permission of ["client.create", "client.edit", "deal.edit", "doc.upload", "client.view_pii"] as const) expect(can("officer", permission), permission).toBe(true);
    // What sets the analyst apart from the officer is exactly what the two lines say.
    expect(can("officer", "doc.verify")).toBe(false);
    expect(can("officer", "lender.manage")).toBe(false);
    // "يطّلع فقط، ولا يرى جوالاً ولا هوية ولا ملفاً مرفوعاً."
    for (const permission of PERMISSION_NAMES) expect(can("viewer", permission), permission).toBe(false);
  });
});

describe("the head of the accounts screen", () => {
  it("counts the accounts with Arabic agreement and says how many are stopped", () => {
    expect(accountsText(0, 0)).toBe("لا حسابات بعد.");
    expect(accountsText(1, 0)).toBe("حساب واحد يعمل.");
    expect(accountsText(1, 1)).toBe("حساب واحد، وهو موقوف.");
    expect(accountsText(2, 0)).toBe("حسابان، كلاهما يعمل.");
    expect(accountsText(2, 1)).toBe("حسابان، واحد منهما موقوف.");
    expect(accountsText(2, 2)).toBe("حسابان، كلاهما موقوف.");
    expect(accountsText(3, 0)).toBe("3 حسابات، كلها تعمل.");
    expect(accountsText(5, 1)).toBe("5 حسابات، واحد منها موقوف.");
    expect(accountsText(5, 2)).toBe("5 حسابات، اثنان منها موقوفان.");
    expect(accountsText(12, 4)).toBe("12 حساباً، 4 منها موقوفة.");
    expect(accountsText(3, 3)).toBe("3 حسابات، كلها موقوفة.");
  });
});

describe("where an account stands and how its person enters", () => {
  const until = new Date("2026-11-22T11:05:00Z");

  it("says whether it works, was stopped, or is locked for a while", () => {
    expect(standingOf({ active: true, lockedUntil: null })).toBe("working");
    expect(standingOf({ active: true, lockedUntil: until })).toBe("locked");
    // A stopped account is stopped, whatever lock it also carries.
    expect(standingOf({ active: false, lockedUntil: until })).toBe("stopped");
    expect(standingText({ active: true, lockedUntil: null })).toBe("يعمل");
    expect(standingText({ active: false, lockedUntil: null })).toBe("موقوف");
    // The hour is Riyadh's, and reads left to right inside the line.
    expect(standingText({ active: true, lockedUntil: until })).toBe("مقفل حتى ⁦14:05⁩");
    expect(strip(timeText(new Date("2026-11-22T21:30:00Z")))).toBe("00:30");
  });

  it("lists the ways in beyond the password", () => {
    expect(waysText({ authenticator: false, passkeys: 0 })).toBe("كلمة المرور فقط");
    expect(waysText({ authenticator: true, passkeys: 0 })).toBe("تطبيق المصادقة");
    expect(waysText({ authenticator: false, passkeys: 1 })).toBe("مفتاح مرور");
    expect(waysText({ authenticator: true, passkeys: 2 })).toBe("مفتاحا مرور، تطبيق المصادقة");
    expect(waysText({ authenticator: false, passkeys: 3 })).toBe("3 مفاتيح مرور");
  });

  it("says when a person last came in and from how many devices they are in now", () => {
    const now = new Date("2026-11-22T09:00:00Z");
    expect(lastSeenText(null, now)).toBe("لم يدخل بعد");
    expect(lastSeenText(new Date("2026-11-20T09:00:00Z"), now)).toBe("آخر دخول 20 نوفمبر");
    // Last year is said with its year.
    expect(lastSeenText(new Date("2025-12-30T09:00:00Z"), now)).toBe("آخر دخول 30 ديسمبر 2025");
    expect(signedInText(0)).toBe("");
    expect(signedInText(1)).toBe("داخل الآن من جهاز واحد");
    expect(signedInText(2)).toBe("داخل الآن من جهازين");
    expect(signedInText(4)).toBe("داخل الآن من 4 أجهزة");
  });
});

describe("what an admin is told when a change to an account is refused", () => {
  it("has a sentence for every refusal, said plainly and ended", () => {
    for (const code of REFUSALS) expect(USERS_ERROR_CODES, code).toContain(code);
    for (const code of USERS_ERROR_CODES) {
      const text = usersError(code);
      expect(text, code).not.toMatch(broken);
      expect(text, code).not.toMatch(/[A-Z_]{4,}/);
      expect(text.endsWith("."), code).toBe(true);
      expect(text, code).not.toBe(usersError("NO_SUCH_CODE"));
    }
    expect(usersError("NO_SUCH_CODE")).toBe("تعذر الحفظ. حاول مرة أخرى.");
  });
});
