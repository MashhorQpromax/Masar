import { describe, expect, it } from "vitest";
import { missingText, owedBrief, owedLines, PAPER_CATEGORY, PAPER_ERROR_CODES, PAPER_STATUS, paperError, paperLabel } from "@/copy/documents";
import { PAPER_CATEGORIES, PAPER_CODES, PAPER_STATUSES } from "@/domain/documents";
import { SECTORS } from "@/domain/eligibility";

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
