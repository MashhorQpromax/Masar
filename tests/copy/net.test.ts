import { describe, expect, it } from "vitest";
import { CERTAINTY, deductionText, lineSource, NET_PART, netWhy } from "@/copy/net";
import { NET_PARTS, type NetLine } from "@/domain/deal";

const plain = (text: string) => text.replace(/[⁦⁩]/g, "");
const wordy = /undefined|NaN|null|\[object|[A-Za-z_]{3,}|—|–/;
const line = (over: Partial<NetLine> & Pick<NetLine, "part">): NetLine => ({ amount: 100000, certainty: "estimated", confirmed: 0, ...over });

describe("the wording of the client's net", () => {
  it("names every line and both kinds of figure", () => {
    for (const part of NET_PARTS) expect(NET_PART[part]).toMatch(/^[؀-ۿ]/);
    expect(CERTAINTY).toEqual({ confirmed: "مؤكد", estimated: "تقديري" });
  });

  it("says where each line's figure comes from", () => {
    expect(lineSource(line({ part: "mortgage", certainty: "confirmed", confirmed: 100000 }))).toBe("من عرض الجهة المكتوب");
    expect(lineSource(line({ part: "personal", held: false }))).toBe("محسوب من الراتب والشروط، بلا عرض مكتوب");
    expect(lineSource(line({ part: "personal", held: true }))).toBe("سقف منتج الجهة، بلا عرض مكتوب");
    expect(lineSource(line({ part: "obligations", count: { all: 3, confirmed: 3 }, certainty: "confirmed" }))).toBe("كلها بخطابات من الدائنين");
    expect(lineSource(line({ part: "obligations", count: { all: 1, confirmed: 1 }, certainty: "confirmed" }))).toBe("بخطاب من الدائن");
    expect(plain(lineSource(line({ part: "obligations", count: { all: 4, confirmed: 1 } })))).toBe("1 من 4 بخطاب من الدائن");
    expect(lineSource(line({ part: "obligations", count: { all: 2, confirmed: 0 } }))).toBe("بلا خطابات من الدائنين");
    expect(lineSource(line({ part: "costs" }))).toBe("محسوبة من التقييم المتوقع والشروط العامة");
    expect(lineSource(line({ part: "fee", certainty: "confirmed" }))).toBe("على أرقام مؤكدة");
    expect(lineSource(line({ part: "fee" }))).toBe("على أرقام فيها تقدير");
  });

  it("never lets a sum of both kinds go without saying which is which", () => {
    expect(netWhy({ certainty: "confirmed", confirmed: ["mortgage", "obligations", "fee"], estimated: [], partly: [] })).toBe("كل ما فيه من عرض مكتوب وخطابات الدائنين.");
    expect(netWhy({ certainty: "estimated", confirmed: [], estimated: ["mortgage", "costs"], partly: [] })).toBe("كل ما فيه محسوب من الشروط العامة، ولا شيء منه بورقة مكتوبة.");
    expect(netWhy({ certainty: "estimated", confirmed: ["mortgage", "personal"], estimated: ["obligations", "costs", "fee"], partly: [] })).toBe(
      "المؤكد فيه: التمويل العقاري والتمويل الشخصي. والتقديري: الالتزامات والرسوم والتكاليف وأتعابنا.",
    );
    // One creditor's letter among three: the line stays an estimate, and the sum does not say nothing is written.
    expect(netWhy({ certainty: "estimated", confirmed: [], estimated: ["mortgage", "obligations", "costs"], partly: ["obligations"] })).toBe(
      "التقديري فيه: التمويل العقاري والالتزامات (مؤكد بعضها) والرسوم والتكاليف.",
    );
    expect(netWhy({ certainty: "estimated", confirmed: ["personal"], estimated: ["obligations"], partly: ["obligations"] })).toBe(
      "المؤكد فيه: التمويل الشخصي. والتقديري: الالتزامات (مؤكد بعضها).",
    );
  });

  it("puts the deduction beside its cap, and says nothing without a salary", () => {
    expect(plain(deductionText({ after: 44.8, cap: 65 })!)).toBe("الاستقطاع بعد التمويل 44.8% من الراتب، والسقف 65%");
    expect(deductionText({ after: null, cap: 65 })).toBeNull();
  });

  it("never leaks a code or a dash into anything it says", () => {
    for (const part of NET_PARTS)
      for (const certainty of ["confirmed", "estimated"] as const)
        for (const held of [false, true])
          for (const count of [{ all: 1, confirmed: 0 }, { all: 5, confirmed: 2 }, { all: 2, confirmed: 2 }]) {
            expect(lineSource(line({ part, certainty, held, count }))).not.toMatch(wordy);
          }
  });
});
