import { describe, expect, it } from "vitest";
import { endedLine, lenderLine, MONTH_NOTE, monthTitle, requestsText } from "@/copy/report";

const plain = (text: string) => text.replace(/[⁦⁩]/g, "");
const wordy = /undefined|NaN|null|\[object|[A-Za-z_]{3,}|—|–/;

describe("the wording of the office's month", () => {
  it("names the month in Arabic with its year", () => {
    expect(monthTitle("2026-11")).toBe("نوفمبر 2026");
    expect(monthTitle("2027-01")).toBe("يناير 2027");
  });

  it("says what a lender answered, with the counts agreeing", () => {
    expect(plain(lenderLine({ answers: 3, approved: 2, refused: 1, written: 2 }))).toBe("3 ردود: موافقتان ورفض واحد. 2 منها مكتوبة.");
    expect(lenderLine({ answers: 1, approved: 1, refused: 0, written: 1 })).toBe("رد واحد: موافقة واحدة. مكتوب.");
    expect(lenderLine({ answers: 2, approved: 0, refused: 2, written: 0 })).toBe("ردان: رفضان. بلا ورقة مكتوبة.");
    expect(plain(lenderLine({ answers: 12, approved: 12, refused: 0, written: 12 }))).toBe("12 رداً: 12 موافقة. كلها مكتوبة.");
  });

  it("says when a deal ended and how long after it was opened", () => {
    expect(plain(endedLine({ on: "2026-11-20", days: 80 }, true))).toBe("أُغلقت 20 نوفمبر 2026، بعد 80 يوماً من فتحها");
    expect(endedLine({ on: "2026-11-04", days: 1 }, false)).toBe("أُلغيت 4 نوفمبر 2026، بعد يوم من فتحها");
    expect(endedLine({ on: "2026-11-04", days: 0 }, false)).toBe("أُلغيت 4 نوفمبر 2026، يوم فتحها");
  });

  it("says the month's requests, and what waits only of this month", () => {
    expect(requestsText({ sent: 0, answered: 0, waiting: 0 }, true)).toBe("لم يُرسل طلب إلى جهة، ولم يُسجَّل رد على طلب.");
    expect(plain(requestsText({ sent: 3, answered: 2, waiting: 1 }, true))).toBe("أُرسل 3 طلبات إلى الجهات، وسُجّل الرد على طلبين. ينتظر الرد الآن: 1.");
    expect(requestsText({ sent: 1, answered: 1, waiting: 4 }, false)).toBe("أُرسل طلب واحد إلى الجهات، وسُجّل الرد على طلب واحد.");
  });

  it("never calls a computed fee collected", () => {
    expect(MONTH_NOTE).toContain("لا يُسجَّل بعد");
    expect(MONTH_NOTE).not.toMatch(wordy);
  });
});
