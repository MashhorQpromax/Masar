import { describe, expect, it } from "vitest";
import { APPROVAL_PART, APPROVAL_REFUSALS, approvalError, approvalLine, approvalState, changedText, openText } from "@/copy/approval";
import { APPROVAL_PARTS, type ApprovalPart, type Completeness } from "@/domain/analysis";

const done: Completeness = { complete: true, verify: false, missing: 0, unconfirmed: 0, conflict: 0, terms: false, gaps: [] };
const open = (parts: Partial<Completeness>): Completeness => ({ ...done, complete: false, ...parts });
const at = new Date("2026-11-22T09:00:00Z");
const plain = (text: string) => text.replace(/[⁦⁩]/g, "");
const wordy = /undefined|NaN|null|\[object|[A-Za-z_]{3,}|—|–/;

describe("the wording of an approval", () => {
  it("names every part an approval rests on", () => {
    for (const part of APPROVAL_PARTS) expect(APPROVAL_PART[part]).toMatch(/^[؀-ۿ]/);
    expect(changedText([])).toBe("");
    expect(changedText(["file"])).toBe("ملف العميل");
    expect(changedText(["file", "result"])).toBe("ملف العميل ونتيجة التحليل");
    expect(changedText(["file", "record", "lenders"])).toBe("ملف العميل وتقرير سمة وشروط الجهة المقترحة");
  });

  it("says what is still open, by kind, and what needs verification when nothing is listed", () => {
    expect(openText(done)).toBe("");
    expect(openText(open({ missing: 1 }))).toBe("ناقص واحد");
    expect(openText(open({ missing: 3, unconfirmed: 2 }))).toBe("3 نواقص وأمران غير مؤكدين");
    expect(openText(open({ conflict: 1, terms: true }))).toBe("تعارض واحد وشروط لم تؤكدها الجهة المقترحة");
    expect(openText(open({ verify: true }))).toBe("ما يحتاج تحققاً");
    expect(openText(open({ verify: true, unconfirmed: 11 }))).toBe("11 أمراً غير مؤكد");
  });

  it("tells a standing approval with who and when, and an incomplete one with what was open and why", () => {
    const stands = approvalState({ latest: { by: "سارة", at, complete: true, reason: null, changed: [], open: done }, now: done, pending: false, may: true });
    expect(stands.state).toBe("stands");
    expect(stands.title).toBe("التوصية معتمدة");
    expect(plain(stands.text)).toMatch(/^اعتمدها سارة في .+\. كل ما بُني عليه مؤكد، ويسقط الاعتماد إن تغيّر شيء منه\.$/);

    const withReason = approvalState({ latest: { by: null, at, complete: false, reason: "الجهة أكدت هاتفياً", changed: [], open: open({ missing: 2 }) }, now: open({ missing: 2 }), pending: false, may: true });
    expect(plain(withReason.text)).toMatch(/^اعتمدها حساب محذوف في .+\. اعتُمدت وفيها ناقصان\. السبب: الجهة أكدت هاتفياً$/);
  });

  it("tells a fallen approval with what changed, and what approving again asks", () => {
    const fell = approvalState({ latest: { by: "سارة", at, complete: true, reason: null, changed: ["file", "result"], open: done }, now: open({ unconfirmed: 1 }), pending: false, may: true });
    expect(fell).toEqual({ state: "fell", title: "سقط الاعتماد", text: "تغيّر منذ اعتمادها ملف العميل ونتيجة التحليل. فيها أمر غير مؤكد. لا تُعتمد إلا بسبب مكتوب." });
    const notMine = approvalState({ latest: null, now: done, pending: false, may: false });
    expect(notMine).toEqual({ state: "none", title: "التوصية غير معتمدة", text: "كل ما بُني عليه مؤكد. يعتمدها مدير النظام." });
    expect(approvalState({ latest: null, now: open({ missing: 1 }), pending: false, may: false }).text).toBe("فيها ناقص واحد. يعتمدها مدير النظام بسبب مكتوب.");
    expect(approvalState({ latest: null, now: done, pending: false, may: true }).text).toBe("كل ما بُني عليه مؤكد. الاعتماد يثبت ما قرأه التحليل ووجده الآن.");
    expect(approvalState({ latest: null, now: open({ missing: 1 }), pending: true, may: true }).text).toBe("لا تُعتمد قبل أن يُقرأ التحليل: أكمل الملف أو سجّل موافقة العميل.");
  });

  it("lists each approval of the log with its day, who, and whether it stands", () => {
    expect(plain(approvalLine({ by: "سارة", at, complete: true, changed: [] }))).toMatch(/^.+ · سارة · مكتملة · قائم$/);
    expect(plain(approvalLine({ by: null, at, complete: false, changed: ["lenders"] }))).toMatch(/^.+ · حساب محذوف · مع ما لم يكتمل · سقط: تغيّر شروط الجهة المقترحة$/);
  });

  it("words every refusal, and anything else as a plain failure", () => {
    for (const reason of APPROVAL_REFUSALS) {
      const text = approvalError("APPROVAL_REFUSED", { reason });
      expect(text, reason).toMatch(/^[؀-ۿ]/);
      expect(text.endsWith(".")).toBe(true);
      expect(text, reason).not.toMatch(wordy);
    }
    expect(plain(approvalError("APPROVAL_REFUSED", { reason: "REASON_NEEDED" }))).toBe("اكتب سبب اعتمادها رغم ما لم يكتمل، 15 حرفاً على الأقل.");
    expect(approvalError("FORBIDDEN")).toBe("الاعتماد لمدير النظام وحده.");
    expect(approvalError("APPROVAL_REFUSED", { reason: "NO_SUCH" })).toBe("تعذر الاعتماد. حاول مرة أخرى.");
    expect(approvalError("SOMETHING")).toBe("تعذر الاعتماد. حاول مرة أخرى.");
  });

  it("never leaks a code or a dash into anything it says", () => {
    const parts: ApprovalPart[][] = [[], ["file"], ["record", "result"], [...APPROVAL_PARTS]];
    const states = [done, open({ verify: true }), open({ missing: 12, unconfirmed: 3, conflict: 2, terms: true })];
    for (const changed of parts)
      for (const now of states)
        for (const pending of [false, true])
          for (const may of [false, true])
            for (const latest of [null, { by: "سارة", at, complete: now.complete, reason: "سبب مكتوب بما يكفي", changed, open: now }]) {
              const said = approvalState({ latest, now, pending, may });
              expect(said.title).not.toMatch(wordy);
              expect(said.text).not.toMatch(wordy);
              expect(said.text.trim()).toBe(said.text);
            }
  });
});
