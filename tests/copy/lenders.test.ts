import { describe, expect, it } from "vitest";
import { afterDefaultText, confirmedText, LENDER_ERROR_CODES, LENDER_TYPE, lenderError, NATIONALITY_CHOICE, PRODUCT_NAME, RATE_TYPE, SOURCE_KIND, SOURCE_PROBLEMS, SOURCE_REFERENCE, standingText, TERM_NAME, VALIDITY_SAY } from "@/copy/lenders";
import { PRODUCT_KINDS, SOURCE_KINDS, sourceProblem, TERMS, termStanding, type TermSource } from "@/domain/eligibility";

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
    expect(LENDER_ERROR_CODES).toEqual(["INVALID_INPUT", "NOT_FOUND", "LENDER_KNOWN", "FORBIDDEN", "SOURCE_REFUSED", "TERM_VALUE_MISSING"]);
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

  it("names every term and every kind of source, each in words of its own", () => {
    for (const words of [TERMS.map((term) => TERM_NAME[term]), SOURCE_KINDS.map((kind) => SOURCE_KIND[kind]), SOURCE_KINDS.map((kind) => SOURCE_REFERENCE[kind])]) {
      for (const word of words) {
        expect(word).toMatch(/^[؀-ۿ]/);
        expect(word).not.toMatch(broken);
        expect(word.endsWith(".")).toBe(false);
      }
      expect(new Set(words).size).toBe(words.length);
    }
    expect(VALIDITY_SAY).toBe("التأكيد يصلح 3 أشهر، ثم تُسأل الجهة من جديد.");
  });

  it("says how far a term can be relied on, with the day it stops", () => {
    const source: TermSource = { kind: "lender_document", reference: "تعرفة الأفراد", confirmedOn: "2026-11-20" };
    expect(standingText(undefined)).toBe("غير مؤكد");
    expect(standingText(termStanding(null, "2026-11-22"))).toBe("غير مؤكد");
    expect(strip(standingText(termStanding(source, "2026-11-22")))).toBe("مؤكد حتى 20 فبراير 2027");
    expect(strip(standingText(termStanding(source, "2027-02-21")))).toBe("انتهى تأكيده في 20 فبراير 2027");
  });

  it("says how much of a product is confirmed in a word or a count", () => {
    expect(confirmedText(0, 11)).toBe("استرشادية");
    expect(confirmedText(11, 11)).toBe("مؤكدة");
    expect(strip(confirmedText(5, 11))).toBe("مؤكد 5 من 11");
    expect(confirmedText(5, 11)).not.toMatch(broken);
  });

  it("says why a source cannot confirm a term, one sentence for each reason the engine gives", () => {
    const today = "2026-11-22";
    const refused: TermSource[] = [
      { kind: "lender_staff", reference: "أحمد", confirmedOn: today },
      { kind: "lender_website", reference: "موقع البنك الرسمي", confirmedOn: today },
      { kind: "lender_document", reference: "تعرفة الأفراد", confirmedOn: "2026-02-30" },
      { kind: "lender_document", reference: "تعرفة الأفراد", confirmedOn: "2026-11-23" },
      { kind: "lender_document", reference: "تعرفة الأفراد", confirmedOn: "2026-08-21" },
    ];
    // Every reason the engine can give is among the ones that have words.
    expect(refused.map((source) => sourceProblem(source, today))).toEqual(SOURCE_PROBLEMS);
    const said = SOURCE_PROBLEMS.map((problem) => lenderError("SOURCE_REFUSED", { problem }));
    for (const [index, sentence] of said.entries()) {
      expect(sentence, SOURCE_PROBLEMS[index]).toMatch(/^[؀-ۿ]/);
      expect(sentence.endsWith("."), SOURCE_PROBLEMS[index]).toBe(true);
      expect(strip(sentence), SOURCE_PROBLEMS[index]).not.toMatch(broken);
    }
    expect(new Set(said).size).toBe(said.length);
    // A reason from a newer build still reads.
    expect(lenderError("SOURCE_REFUSED", { problem: "SOMETHING_NEW" })).toBe("هذا المصدر لا يكفي لتأكيد الشرط.");
    expect(lenderError("SOURCE_REFUSED")).toBe("هذا المصدر لا يكفي لتأكيد الشرط.");
  });
});
