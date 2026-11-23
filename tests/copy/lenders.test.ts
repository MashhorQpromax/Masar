import { describe, expect, it } from "vitest";
import { afterDefaultText, LENDER_ERROR_CODES, LENDER_TYPE, lenderError, NATIONALITY_CHOICE, PRODUCT_NAME, RATE_TYPE } from "@/copy/lenders";
import { PRODUCT_KINDS } from "@/domain/eligibility";

const broken = /undefined|NaN|null|\[object|[A-Za-z_]{3,}|—|–/;
const strip = (text: string) => text.replace(/[⁦⁩]/g, "");

describe("the wording of the lender catalogue", () => {
  it("names every kind of lender, rate, nationality and product in Arabic, as labels", () => {
    const words = [LENDER_TYPE.bank, LENDER_TYPE.finance_company, RATE_TYPE.flat, RATE_TYPE.reducing, NATIONALITY_CHOICE.saudi, NATIONALITY_CHOICE.non_saudi, ...PRODUCT_KINDS.map((kind) => PRODUCT_NAME[kind])];
    for (const word of words) {
      expect(word).toMatch(/^[؀-ۿ]/);
      expect(word).not.toMatch(broken);
      expect(word.endsWith(".")).toBe(false);
    }
    // A new product starts from a name of its own kind, never another kind's.
    expect(new Set(PRODUCT_KINDS.map((kind) => PRODUCT_NAME[kind])).size).toBe(PRODUCT_KINDS.length);
    expect(NATIONALITY_CHOICE.saudi).not.toBe(NATIONALITY_CHOICE.non_saudi);
  });

  it("says what a lender does after a paid default, and says so when nobody confirmed it", () => {
    expect(afterDefaultText(null)).toBe("بعد سداد التعثر: لم نؤكد");
    expect(afterDefaultText(undefined)).toBe(afterDefaultText(null));
    expect(afterDefaultText(0)).toBe("بعد سداد التعثر: تقبل فوراً");
    expect(strip(afterDefaultText(6))).toBe("بعد سداد التعثر: تنتظر 6 أشهر");
    for (const wait of [1, 2, 3, 6, 11, 12, 24]) expect(strip(afterDefaultText(wait)), String(wait)).not.toMatch(broken);
  });

  it("says in one sentence why a change to the catalogue was not kept", () => {
    expect(LENDER_ERROR_CODES).toEqual(["INVALID_INPUT", "NOT_FOUND", "LENDER_KNOWN", "FORBIDDEN"]);
    const unknown = lenderError("SOMETHING_NEW");
    expect(unknown).toBe("تعذر الحفظ. حاول مرة أخرى.");
    for (const code of LENDER_ERROR_CODES) {
      const said = lenderError(code);
      expect(said, code).not.toBe(unknown);
      expect(said, code).toMatch(/^[؀-ۿ]/);
      expect(said.endsWith("."), code).toBe(true);
      expect(said, code).not.toMatch(broken);
    }
    expect(new Set(LENDER_ERROR_CODES.map((code) => lenderError(code))).size).toBe(LENDER_ERROR_CODES.length);
  });

  it("names the lender that is already in the list, and still reads without a name", () => {
    expect(lenderError("LENDER_KNOWN", { name: "بنك الرياض" })).toBe("«بنك الرياض» في القائمة من قبل.");
    expect(lenderError("LENDER_KNOWN")).toBe("هذه الجهة في القائمة من قبل.");
    expect(lenderError("LENDER_KNOWN", { name: "" })).toBe(lenderError("LENDER_KNOWN"));
    // Params a code does not use change nothing.
    expect(lenderError("NOT_FOUND", { name: "بنك الرياض" })).toBe(lenderError("NOT_FOUND"));
  });
});
