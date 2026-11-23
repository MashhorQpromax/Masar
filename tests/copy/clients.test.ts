import { describe, expect, it } from "vitest";
import { CONTACT_ERROR_CODES, contactError, filesCount, fileStateText, foundText, ID_LABEL, NATIONALITY, NOTE_KIND, phoneText, phoneTyped } from "@/copy/clients";
import { STAGE, STATION } from "@/copy/deal";
import { SAVE_ERROR_CODES, saveError } from "@/copy/editor";
import { dayFull, dayOf, dayShort } from "@/copy/format";
import { excerpt, waitingText } from "@/copy/messages";
import { fileState, NATIONALITIES } from "@/domain/clients";
import { STAGES } from "@/domain/deal";

const broken = /undefined|NaN|null|\[object|—|–/;
const strip = (text: string) => text.replace(/[⁦⁩]/g, "");

/** Every refusal the services of a client's file and of the inbox can answer with. */
const FILE_REFUSALS = ["BAD_PHONE", "PHONE_TAKEN", "ID_FORMAT", "ID_KIND", "ID_CHECK", "ID_TAKEN", "BAD_EMAIL", "NOTE_EMPTY", "REASON_EMPTY", "NUMBER_KNOWN", "DEAL_ALREADY_OPEN", "NOT_FOUND", "FORBIDDEN", "INVALID_INPUT"];
/** Every refusal saving a deal can answer with, now that a new file may carry a phone. */
const SAVE_REFUSALS = ["INVALID_INPUT", "NOT_FOUND", "DEAL_ENDED", "DEAL_ALREADY_OPEN", "BAD_PHONE", "PHONE_TAKEN", "FORBIDDEN"];

describe("what a person is told when a change to a file is refused", () => {
  it("has a sentence for every refusal, said plainly and ended", () => {
    for (const code of FILE_REFUSALS) expect(CONTACT_ERROR_CODES, code).toContain(code);
    for (const code of SAVE_REFUSALS) expect(SAVE_ERROR_CODES, code).toContain(code);
    for (const [codes, say] of [
      [CONTACT_ERROR_CODES, contactError],
      [SAVE_ERROR_CODES, saveError],
    ] as const) {
      for (const code of codes) {
        const text = say(code, { fileNo: "C-014" });
        expect(text, code).not.toMatch(broken);
        expect(text, code).not.toMatch(/[A-Z_]{4,}/);
        expect(text.endsWith("."), code).toBe(true);
        expect(text, code).not.toBe(say("NO_SUCH_CODE"));
        // Without the detail the sentence still reads, it only lacks the file number.
        expect(say(code), code).not.toMatch(broken);
      }
    }
    expect(contactError("NO_SUCH_CODE")).toBe("تعذر الحفظ. حاول مرة أخرى.");
  });

  it("names the file a phone or an identity number already belongs to", () => {
    expect(strip(contactError("PHONE_TAKEN", { fileNo: "C-014" }))).toBe("هذا الجوال مسجل في الملف C-014. الرقم الواحد لملف واحد.");
    expect(strip(contactError("ID_TAKEN", { fileNo: "C-008" }))).toContain("C-008");
    expect(strip(saveError("PHONE_TAKEN", { fileNo: "C-014" }))).toBe("هذا الجوال مسجل في الملف C-014. افتح ذلك الملف بدل ملف جديد.");
    // The file number is Latin text inside an Arabic sentence, so it is isolated.
    expect(contactError("PHONE_TAKEN", { fileNo: "C-014" })).toContain("⁦C-014⁩");
  });
});

describe("how a client is reached, in words", () => {
  it("writes a Saudi mobile the way it is read out, however it was stored", () => {
    expect(strip(phoneText("966500000014"))).toBe("050 000 0014");
    expect(strip(phoneText("0551234567"))).toBe("055 123 4567");
    expect(phoneText("966500000014").startsWith("⁦")).toBe(true);
    expect(strip(phoneText("447911123456"))).toBe("+447911123456");
    expect(strip(phoneText("12345"))).toBe("12345");
    expect(phoneText(null)).toBe("");
    expect(phoneText("")).toBe("");
  });

  it("puts a stored number back into a field as a person types it", () => {
    expect(phoneTyped("966551234567")).toBe("0551234567");
    expect(phoneTyped("447911123456")).toBe("447911123456");
    expect(phoneTyped(null)).toBe("");
  });

  it("has a word for each nationality and for its identity number", () => {
    for (const nationality of NATIONALITIES) {
      expect(NATIONALITY[nationality]).toBeTruthy();
      expect(ID_LABEL[nationality]).toBeTruthy();
    }
    expect(ID_LABEL.non_saudi).toBe("رقم الإقامة");
  });
});

describe("where a file stands, in words", () => {
  it("has a word for a file at every stage of a deal, and for a file with none", () => {
    for (const [stage] of STAGES) {
      const text = fileStateText(fileState(stage));
      expect(text, stage).toBeTruthy();
      expect(text, stage).not.toMatch(broken);
      expect(STAGE[stage], stage).toBeTruthy();
    }
    expect(fileStateText(fileState(null))).toBe("بلا صفقة");
    expect(fileStateText(fileState("closed"))).toBe("اكتملت");
    expect(fileStateText(fileState("lost"))).toBe("مرفوض");
    expect(fileStateText(fileState("payoff"))).toBe(STATION.property);
    expect(NOTE_KIND.status).toBe("قرار الملف");
  });

  it("counts files and search results the way Arabic does", () => {
    expect(filesCount(1)).toBe("ملف واحد");
    expect(filesCount(2)).toBe("ملفان");
    expect(filesCount(6)).toBe("6 ملفات");
    expect(filesCount(11)).toBe("11 ملفاً");
    expect(foundText(0, "زيد")).toBe("لا أحد باسم «زيد» أو برقمه.");
    expect(foundText(1, "سالم")).toBe("نتيجة واحدة عن «سالم».");
    expect(foundText(2, "سالم")).toBe("نتيجتان عن «سالم».");
    expect(foundText(4, "وزارة")).toBe("4 نتائج عن «وزارة».");
  });
});

describe("the inbox, in words", () => {
  it("shows a message in one line", () => {
    expect(excerpt({ type: "text", body: "متى يتحدث سجلي في سمة؟" })).toBe("متى يتحدث سجلي في سمة؟");
    expect(excerpt({ type: "text", body: "السلام عليكم\n\nأرسلت   لكم *التعريف* الجديد" })).toBe("السلام عليكم أرسلت لكم التعريف الجديد");
    expect(excerpt({ type: "template", body: null })).toBe("قالب المتابعة برابط ملفه");
    expect(excerpt({ type: "image", body: null })).toBe("صورة");
    expect(excerpt({ type: "document", body: "  " })).toBe("مستند");
    expect(excerpt({ type: "something_new", body: null })).toBe("رسالة");
    const long = excerpt({ type: "text", body: "كلمة ".repeat(60) }, 40);
    expect(long.endsWith("…")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(41);
    expect(long).not.toMatch(/\s…$/);
  });

  it("says how many conversations wait, with the agreement Arabic requires", () => {
    expect(waitingText(0)).toBe("لا أحد ينتظر رداً.");
    expect(waitingText(1)).toBe("محادثة واحدة تنتظر ردك.");
    expect(waitingText(2)).toBe("محادثتان تنتظران ردك.");
    expect(waitingText(3)).toBe("3 محادثات تنتظر ردك.");
    expect(waitingText(14)).toBe("14 محادثة تنتظر ردك.");
  });

  it("gives a day its year only when that is not this year", () => {
    const now = new Date("2026-11-23T09:00:00Z");
    const thisYear = new Date("2026-09-21T09:00:00Z");
    const lastYear = new Date("2025-10-05T09:00:00Z");
    expect(dayOf(thisYear, now)).toBe(dayShort(thisYear));
    expect(dayOf(thisYear, now)).not.toContain("2026");
    expect(dayOf(lastYear, now)).toBe(dayFull(lastYear));
    expect(dayOf(lastYear, now)).toContain("2025");
    // The year turns in Riyadh three hours before it turns in UTC.
    expect(dayOf(new Date("2026-12-31T21:30:00Z"), now)).toContain("2027");
  });
});
