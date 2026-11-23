import { describe, expect, it } from "vitest";
import { can, isRole, passwordProblem, PERMISSION_NAMES, ROLES, type Role } from "@/domain/auth";
import { deviceName } from "@/domain/auth/device";
import { digitsOf, normalizePhone } from "@/domain/shared/phone";

describe("what each role may do", () => {
  it("is exactly this table", () => {
    const table = Object.fromEntries(PERMISSION_NAMES.map((p) => [p, ROLES.filter((role) => can(role, p)).join(" ")]));
    expect(table).toEqual({
      "client.create": "admin analyst officer",
      "client.edit": "admin analyst officer",
      "client.delete": "admin",
      "client.view_pii": "admin analyst officer",
      "deal.edit": "admin analyst officer",
      "study.approve": "admin",
      "doc.upload": "admin analyst officer",
      "doc.verify": "admin analyst",
      "app.manage": "admin analyst officer",
      "lender.manage": "admin analyst",
      "lender.confirm": "admin",
      "user.manage": "admin",
      "audit.view": "admin",
    });
  });

  it("gives the admin everything and the viewer nothing", () => {
    for (const permission of PERMISSION_NAMES) {
      expect(can("admin", permission)).toBe(true);
      expect(can("viewer", permission)).toBe(false);
    }
  });

  it("knows a role from a stranger's text", () => {
    expect(isRole("officer")).toBe(true);
    for (const value of ["owner", "", "Admin", null, 1]) expect(isRole(value)).toBe(false);
    expect(can("root" as Role, "user.manage")).toBe(false);
  });
});

describe("a new password", () => {
  it("needs ten characters, counted as people count them", () => {
    expect(passwordProblem("123456789")).toBe("PASSWORD_SHORT");
    expect(passwordProblem("1234567890")).toBeNull();
    expect(passwordProblem("كلمة سر طويلة")).toBeNull();
    expect(passwordProblem("")).toBe("PASSWORD_SHORT");
  });

  it("is refused past what bcrypt reads, instead of being cut without a word", () => {
    expect(passwordProblem("a".repeat(72))).toBeNull();
    expect(passwordProblem("a".repeat(73))).toBe("PASSWORD_LONG");
    expect(passwordProblem("ك".repeat(37))).toBe("PASSWORD_LONG");
  });
});

describe("a phone number", () => {
  it("is read in every form people write it", () => {
    for (const text of ["0551234567", "551234567", "+966 55 123 4567", "00966551234567", "٠٥٥١٢٣٤٥٦٧", "۰۵۵۱۲۳۴۵۶۷", "055-123-4567"]) {
      expect(normalizePhone(text)).toBe("966551234567");
    }
    expect(normalizePhone("+44 7700 900123")).toBe("447700900123");
  });

  it("is refused when it is not one", () => {
    for (const text of ["", null, undefined, "12345", "abc", "0551234", "1".repeat(16)]) expect(normalizePhone(text)).toBeNull();
  });

  it("keeps digits only", () => {
    expect(digitsOf(" ١٢٣ ٤٥٦ ")).toBe("123456");
    expect(digitsOf("12-34a")).toBe("1234");
  });
});

describe("the name a device is listed by", () => {
  it("is its system and its browser", () => {
    expect(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1")).toBe("iPhone · Safari");
    expect(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1")).toBe("iPhone · Chrome");
    expect(deviceName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36")).toBe("Mac · Chrome");
    expect(deviceName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0")).toBe("Windows · Edge");
    expect(deviceName("Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36")).toBe("أندرويد · Chrome");
    expect(deviceName("Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0")).toBe("Linux · Firefox");
  });

  it("is plain when the browser says nothing", () => {
    expect(deviceName(null)).toBe("جهاز");
    expect(deviceName("curl/8")).toBe("جهاز");
  });
});
