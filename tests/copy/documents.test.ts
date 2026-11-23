import { describe, expect, it } from "vitest";
import { conflictText, conflictWay, factValue, missingText, owedBrief, owedLines, PAPER_CATEGORY, PAPER_ERROR_CODES, PAPER_STATUS, paperError, paperLabel, sourcePaper, STATED_FIELD, statedLine } from "@/copy/documents";
import { PAPER_CATEGORIES, PAPER_CODES, PAPER_STATES, PAPER_STATUSES } from "@/domain/documents";
import { PAPER_FACTS, SECTORS } from "@/domain/eligibility";

const broken = /undefined|NaN|null|\[object|—|–/;
const strip = (text: string) => text.replace(/[⁦⁩]/g, "");

describe("the wording of papers", () => {
  it("has a name for every paper the engine knows, whoever the client is", () => {
    for (const code of PAPER_CODES) {
      for (const sector of SECTORS) {
        for (const nationality of ["saudi", "non_saudi"] as const) {
          const label = paperLabel({ code, label: null }, { sector, nationality });
          expect(label, code).not.toMatch(/[a-z_]{3,}/);
          expect(label, code).not.toMatch(broken);
          expect(label.length, code).toBeGreaterThan(3);
        }
      }
    }
  });

  it("calls a paper a person added by the name they gave it", () => {
    expect(paperLabel({ code: "custom:ab12", label: "فحص طبي" }, { sector: "gov", nationality: "saudi" })).toBe("فحص طبي");
    expect(paperLabel({ code: "id", label: null }, { sector: "gov", nationality: "non_saudi" })).toBe("الإقامة سارية المفعول");
    expect(paperLabel({ code: "transfer_deed", label: null }, { sector: "gov", nationality: "saudi" })).toBe("صك العقار بعد الإفراغ لطرفنا");
  });

  it("names a project's papers as a project's, and tells the company's credit report from its owner's", () => {
    const who = { sector: "self", nationality: "saudi" } as const;
    for (const code of PAPER_CODES) {
      const label = paperLabel({ code, label: null }, who, "project");
      expect(label, code).not.toMatch(/[a-z_]{3,}/);
      expect(label, code).not.toMatch(broken);
    }
    expect(paperLabel({ code: "simah_company", label: null }, who, "project")).toBe("تقرير سمة التجارية للشركة");
    expect(paperLabel({ code: "simah_company", label: null }, who, "project")).not.toBe(paperLabel({ code: "simah", label: null }, who, "project"));
    expect(paperLabel({ code: "custom:ab12", label: "خطاب المشغّل" }, who, "project")).toBe("خطاب المشغّل");
  });

  it("has a word for every state and every group", () => {
    for (const status of PAPER_STATUSES) expect(PAPER_STATUS[status]).toBeTruthy();
    for (const category of PAPER_CATEGORIES) expect(PAPER_CATEGORY[category]).toBeTruthy();
  });

  it("counts what is owed the way Arabic does", () => {
    expect(missingText(0)).toBe("الملف مكتمل");
    expect(missingText(1)).toBe("ينقص مستند واحد");
    expect(missingText(2)).toBe("ينقص مستندان");
    expect(missingText(4)).toBe("ينقص 4 مستندات");
    expect(missingText(11)).toBe("ينقص 11 مستنداً");
    expect(owedBrief([])).toBe("");
    expect(owedBrief(["صك العقار"])).toBe("صك العقار.");
    expect(owedBrief(["صك العقار", "الهوية الوطنية"])).toBe("صك العقار، ومستند آخر.");
    expect(owedBrief(["صك العقار", "أ", "ب", "ج"])).toBe("صك العقار، و3 مستندات أخرى.");
  });

  it("numbers the papers owed, and says why one is needed again", () => {
    const lines = owedLines([
      { label: "صك العقار", note: null },
      { label: "تعريف بالراتب لا يتجاوز شهراً", note: "مضى عليه أكثر من شهر" },
    ]);
    expect(lines).toEqual(["1. صك العقار", "2. تعريف بالراتب لا يتجاوز شهراً (نحتاجه من جديد: مضى عليه أكثر من شهر)"]);
    expect(owedLines([])).toEqual([]);
  });

  it("names the tray of what arrived by WhatsApp", () => {
    expect(paperLabel({ code: "inbox", label: null }, { sector: "gov", nationality: "saudi" })).toBe("وصل في واتساب");
  });

  it("has a sentence for every refusal", () => {
    for (const code of PAPER_ERROR_CODES) {
      const text = strip(paperError(code));
      expect(text, code).not.toMatch(broken);
      expect(text.endsWith("."), code).toBe(true);
    }
    for (const code of ["FILE_TYPE", "FILE_TOO_LARGE", "FILE_LIMIT", "PAPER_EMPTY", "PAPER_HAS_FILES", "UPLOAD_LIMIT", "LINK_CLOSED", "NOT_FOUND", "INVALID_INPUT", "DEMO", "NO_FILE", "UNREADABLE"]) expect(PAPER_ERROR_CODES).toContain(code);
    expect(paperError("SOMETHING_ELSE")).toBe("تعذر الحفظ. حاول مرة أخرى.");
  });
});

describe("the wording of what a paper states", () => {
  it("has a sentence for every reason a figure or a change to the file is refused", () => {
    for (const code of ["NOT_ON_PAPER", "OUT_OF_RANGE", "BASIC_ABOVE_TOTAL", "NOT_VERIFIED", "FILE_BASIC_ABOVE_TOTAL", "FORBIDDEN", "NOT_STATED", "NO_CONFLICT", "PAPERS_DISAGREE"]) {
      expect(PAPER_ERROR_CODES, code).toContain(code);
      expect(paperError(code), code).not.toBe(paperError("SOMETHING_ELSE"));
    }
    // The two refusals that carry no reason of their own fall back to the plain sentence.
    expect(paperError("FIGURE_REFUSED")).toBe(paperError("SOMETHING_ELSE"));
    expect(paperError("RELY_REFUSED")).toBe(paperError("SOMETHING_ELSE"));
  });

  it("names every paper a figure is written from, and every figure over its field", () => {
    for (const code of Object.keys(PAPER_STATES)) {
      const name = sourcePaper({ code, label: null });
      expect(name, code).not.toBe("مستند");
      expect(name, code).not.toMatch(/[a-z_]{3,}/);
    }
    expect(sourcePaper({ code: "custom:ab12", label: "خطاب من جهة العمل" })).toBe("خطاب من جهة العمل");
    expect(sourcePaper({ code: "deed", label: null })).toBe("مستند");
    for (const fact of PAPER_FACTS) expect(STATED_FIELD[fact]).toMatch(/في المستند$/);
    expect(new Set(Object.values(STATED_FIELD)).size).toBe(PAPER_FACTS.length);
  });

  it("reads a salary as an amount and a year as a year", () => {
    expect(strip(factValue("totalSalary", 15200))).toBe("15,200");
    expect(strip(factValue("basicSalary", 11000))).toBe("11,000");
    // A year takes no separator.
    expect(strip(factValue("birthYear", 1986))).toBe("1986");
  });

  it("lists what was written from a paper on one line, and nothing when nothing was", () => {
    expect(strip(statedLine({ totalSalary: 19800, basicSalary: 14500 }))).toBe("الراتب الإجمالي 19,800 · الأساسي 14,500");
    expect(strip(statedLine({ basicSalary: 14500 }))).toBe("الأساسي 14,500");
    expect(strip(statedLine({ birthYear: 1986 }))).toBe("سنة الميلاد 1986");
    expect(statedLine({})).toBe("");
  });

  it("says a conflict with what the file and every paper says", () => {
    expect(strip(conflictText({ fact: "birthYear", file: 1989, stated: [{ code: "id", label: null, value: 1986 }] }))).toBe("سنة الميلاد: في الملف 1989، وفي الهوية 1986.");
    expect(
      strip(
        conflictText({
          fact: "totalSalary",
          file: 15200,
          stated: [
            { code: "salary_cert", label: null, value: 13000 },
            { code: "payslip", label: null, value: 15200 },
          ],
        }),
      ),
    ).toBe("الراتب الإجمالي: في الملف 15,200، وفي تعريف الراتب 13,000، وفي مسير الرواتب 15,200.");
    // A fact the file left empty is said as empty, never as zero.
    expect(strip(conflictText({ fact: "basicSalary", file: null, stated: [{ code: "gosi", label: null, value: 9000 }] }))).toBe("الراتب الأساسي: غير مدخل في الملف، وفي برنت التأمينات 9,000.");
    for (const fact of PAPER_FACTS) expect(conflictText({ fact, file: null, stated: [] })).not.toMatch(broken);
  });

  it("says the way out of a conflict, which is another one when the papers themselves differ", () => {
    expect(conflictWay({ papersAgree: true })).toContain("اعتمد");
    expect(conflictWay({ papersAgree: false })).not.toContain("اعتمد");
    for (const papersAgree of [true, false]) expect(conflictWay({ papersAgree }).endsWith(".")).toBe(true);
  });
});
