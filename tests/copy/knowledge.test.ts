import { describe, expect, it } from "vitest";
import { acceptedText, allAcceptedText, askText, DECISION, DECISIONS_COUNT, knowledgeError, NOTES, PART, ratioText, refusalText, RULE_KIND, RULE_KIND_HINT, similarText } from "@/copy/knowledge";
import { counted } from "@/copy/format";
import { ASKS, DECISIONS, REFUSALS, RULE_KINDS } from "@/domain/knowledge";

const broken = /undefined|NaN|null|\[object|[A-Za-z_]{3,}|—|–/;
const strip = (text: string) => text.replace(/[⁦⁩]/g, "");

describe("the wording of what the office knows about lenders", () => {
  it("names every kind of note, every decision, every ask and every reason in Arabic", () => {
    const words = [...RULE_KINDS.map((kind) => RULE_KIND[kind]), ...DECISIONS.map((d) => DECISION[d]), ...ASKS.map(askText), ...REFUSALS.map(refusalText), PART.mortgage, PART.personal];
    for (const word of words) {
      expect(word).toMatch(/^[؀-ۿ]/);
      expect(word).not.toMatch(broken);
      // A label carries no full stop.
      expect(word.endsWith(".")).toBe(false);
    }
    // No two asks read alike, nor two reasons, nor two kinds.
    expect(new Set(ASKS.map(askText)).size).toBe(ASKS.length);
    expect(new Set(REFUSALS.map(refusalText)).size).toBe(REFUSALS.length);
    expect(new Set(RULE_KINDS.map((kind) => RULE_KIND[kind])).size).toBe(RULE_KINDS.length);
    expect(new Set(DECISIONS.map((d) => DECISION[d])).size).toBe(DECISIONS.length);
  });

  it("says what each kind of note is for in one sentence", () => {
    for (const kind of RULE_KINDS) {
      expect(RULE_KIND_HINT[kind]).toMatch(/^[؀-ۿ]/);
      expect(RULE_KIND_HINT[kind].endsWith(".")).toBe(true);
      expect(RULE_KIND_HINT[kind]).not.toMatch(broken);
    }
  });

  it("still reads a code it does not know as words", () => {
    expect(askText("something_new")).toBe(askText("other"));
    expect(refusalText("something_new")).toBe(refusalText("other"));
    expect(knowledgeError("SOMETHING_NEW")).toBe("تعذر الحفظ. حاول مرة أخرى.");
    for (const code of ["INVALID_INPUT", "NOT_FOUND", "DEAL_ENDED", "FORBIDDEN"]) {
      expect(knowledgeError(code), code).not.toBe(knowledgeError("SOMETHING_NEW"));
      expect(knowledgeError(code).endsWith("."), code).toBe(true);
      expect(knowledgeError(code), code).not.toMatch(broken);
    }
  });

  it("says how often a lender said yes the way Arabic counts", () => {
    expect(acceptedText({ n: 1, approved: 1 })).toBe("قبلت الطلب الوحيد المسجل");
    expect(acceptedText({ n: 1, approved: 0 })).toBe("رفضت الطلب الوحيد المسجل");
    expect(acceptedText({ n: 2, approved: 2 })).toBe("قبلت الطلبين المسجلين");
    expect(strip(acceptedText({ n: 2, approved: 1 }))).toBe("قبلت 1 من طلبين");
    expect(strip(acceptedText({ n: 2, approved: 0 }))).toBe("لم تقبل أياً من طلبين");
    expect(strip(acceptedText({ n: 4, approved: 3 }))).toBe("قبلت 3 من 4 طلبات");
    expect(strip(acceptedText({ n: 5, approved: 5 }))).toBe("قبلت كل الطلبات، وهي 5");
    expect(strip(acceptedText({ n: 12, approved: 0 }))).toBe("لم تقبل أياً من 12 طلباً");
    expect(strip(acceptedText({ n: 12, approved: 7 }))).toBe("قبلت 7 من 12 طلباً");
  });

  it("says the same for every lender together", () => {
    expect(allAcceptedText({ n: 1, approved: 1 })).toBe("وافقت الجهة على الطلب الوحيد المسجل");
    expect(allAcceptedText({ n: 1, approved: 0 })).toBe("رُفض الطلب الوحيد المسجل");
    expect(strip(allAcceptedText({ n: 3, approved: 0 }))).toBe("لم توافق جهة على أي من 3 طلبات");
    expect(strip(allAcceptedText({ n: 11, approved: 8 }))).toBe("وافقت الجهات على 8 من 11 طلباً");
  });

  it("speaks of similar clients only when some were recorded", () => {
    expect(similarText({ similarN: 0, similarApproved: 0 })).toBe("");
    expect(strip(similarText({ similarN: 3, similarApproved: 2 }))).toBe("لعملاء مثله: قبلت 2 من 3 طلبات");
    expect(similarText({ similarN: 1, similarApproved: 0 })).toBe("لعملاء مثله: رفضت الطلب الوحيد المسجل");
  });

  it("says what share of the estimate a lender gives, in whole percent", () => {
    expect(strip(ratioText(0.95))).toBe("تعتمد 95% من تقديرنا");
    expect(strip(ratioText(1))).toBe("تعتمد 100% من تقديرنا");
    expect(strip(ratioText(0.861))).toBe("تعتمد 86% من تقديرنا");
    // The figure is isolated, so it reads left to right inside the sentence.
    expect(ratioText(0.95)).toContain("⁦");
  });

  it("counts notes and decisions with Arabic agreement", () => {
    expect(counted(1, NOTES)).toBe("ملاحظة واحدة");
    expect(counted(2, NOTES)).toBe("ملاحظتان");
    expect(strip(counted(5, NOTES))).toBe("5 ملاحظات");
    expect(strip(counted(11, NOTES))).toBe("11 ملاحظة");
    expect(counted(1, DECISIONS_COUNT)).toBe("قرار واحد");
    expect(counted(2, DECISIONS_COUNT)).toBe("قراران");
    expect(strip(counted(3, DECISIONS_COUNT))).toBe("3 قرارات");
    expect(strip(counted(18, DECISIONS_COUNT))).toBe("18 قراراً");
  });

  it("never lets a sentence break, whatever the numbers", () => {
    for (let n = 1; n <= 30; n++) {
      for (const approved of [0, 1, Math.floor(n / 2), n]) {
        if (approved > n) continue;
        for (const said of [acceptedText({ n, approved }), allAcceptedText({ n, approved }), similarText({ similarN: n, similarApproved: approved })]) {
          expect(said, `${approved}/${n}`).not.toMatch(broken);
          expect(said.endsWith("."), `${approved}/${n}`).toBe(false);
        }
      }
    }
  });
});
