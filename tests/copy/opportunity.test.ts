import { describe, expect, it } from "vitest";
import {
  approvalApartText,
  assumptionLabel,
  assumptionSource,
  CLASS_SAY,
  CONFIDENCE,
  financingDiffText,
  FOOTING,
  OPPORTUNITY_CLASS,
  reasonText,
  SETTLE_WARNING,
  waitLines,
  waitText,
} from "@/copy/opportunity";
import { CONFIDENCES, OPPORTUNITY_CLASSES, type Assumption, type ClassReason } from "@/domain/opportunity";

const plain = (text: string) => text.replace(/[⁦⁩]/g, "");
const wordy = /undefined|NaN|null|\[object|[A-Za-z_]{3,}|—|–/;

describe("the wording of an opportunity", () => {
  it("names the four classes and the three levels of confidence as the office asked", () => {
    expect(OPPORTUNITY_CLASS).toEqual({ confirmed: "مؤكدة من الجهة", ready: "قابلة للتنفيذ مبدئياً", theoretical: "نظرية", not_viable: "غير قابلة للتنفيذ" });
    for (const c of OPPORTUNITY_CLASSES) expect(CLASS_SAY[c]).not.toMatch(wordy);
    for (const c of CONFIDENCES) expect(CONFIDENCE[c]).toMatch(/^ثقة /);
    expect(Object.values(FOOTING)).toEqual(["مكتوب", "شفهي", "تقديري", "بلا مصدر"]);
  });

  it("says why an opportunity has its class", () => {
    const reasons: [ClassReason, string][] = [
      [{ code: "DEFICIT", amount: 128000 }, "يبقى على العميل عجز 128,000 ريال."],
      [{ code: "BLOCKED", count: 1 }, "شرط مؤكد من الجهة يمنع العميل."],
      [{ code: "BLOCKED", count: 2 }, "شروط مؤكدة من الجهات تمنع العميل."],
      [{ code: "REFUSED", lender: "بنك المثال", part: "personal", on: "2026-11-20" }, "رفضت بنك المثال الشخصي في 20 نوفمبر 2026."],
      [{ code: "REPLIED" }, "وافقت الجهة كتابةً، والرد مرفق في الملف."],
      [{ code: "MET" }, "كل شرط ينطبق مستوفى على شروط موثقة، ولم ترد الجهة بعد."],
      [{ code: "ACTIONS", count: 1 }, "مستوفاة على شروط موثقة، وعلى العميل خطوة قبل التقديم."],
      [{ code: "DOUBTS", count: 3 }, "3 أمور بلا جواب موثق بعد، فلا تتجاوز «نظرية»."],
      [{ code: "INCOMPLETE" }, "الصفقة ينقصها ما تُحسب به."],
    ];
    for (const [reason, text] of reasons) expect(plain(reasonText(reason))).toBe(text);
    expect(reasonText({ code: "REFUSED_BEFORE", lender: "بنك المثال", part: "mortgage", on: "2026-06-01" })).not.toMatch(wordy);
  });

  it("gives every assumption a label and a source with its date", () => {
    const a = (over: Partial<Assumption> & Pick<Assumption, "key" | "source">): Assumption => ({ lender: "بنك المثال", part: "personal", footing: "written", link: true, ...over });
    expect(assumptionLabel(a({ key: "conditions", source: { kind: "general" } }))).toBe("شروط بنك المثال");
    expect(assumptionLabel(a({ key: "amount", part: "mortgage", source: { kind: "offer" } }))).toBe("مبلغ التمويل العقاري من بنك المثال");
    expect(plain(assumptionSource(a({ key: "conditions", source: { kind: "reply", on: "2026-11-20", until: "2027-02-20", written: true } })))).toBe(
      "رد الجهة المكتوب بتاريخ 20 نوفمبر 2026، يُعتد به حتى 20 فبراير 2027",
    );
    expect(plain(assumptionSource(a({ key: "amount", source: { kind: "reply", on: "2026-11-20", until: "2027-02-20", written: false } })))).toBe(
      "سجّله الموظف من الجهة بلا رد مكتوب، بتاريخ 20 نوفمبر 2026",
    );
    expect(
      plain(assumptionSource(a({ key: "conditions", source: { kind: "term", source: { kind: "lender_document", reference: "دليل المنتجات", confirmedOn: "2026-11-01" }, until: "2027-02-01" } }))),
    ).toBe("مستند من الجهة: دليل المنتجات، بتاريخ 1 نوفمبر 2026، صالح حتى 1 فبراير 2027");
    expect(assumptionSource(a({ key: "conditions", source: { kind: "open", terms: ["salary", "settled"], facts: 1 } }))).toBe("بلا مصدر: أدنى راتب، بعد سداد التعثر، ومعلومة واحدة ناقصة في الملف");
    expect(assumptionSource(a({ key: "amount", source: { kind: "computed", open: [], valuation: true } }))).toBe("محسوب من شروط الجهة والتقييم المتوقع");
    expect(assumptionSource(a({ key: "amount", source: { kind: "computed", open: ["rate"], valuation: false } }))).toBe("محسوب من شروط الجهة، وبلا مصدر: الهامش");
    expect(plain(assumptionSource(a({ key: "obligations", source: { kind: "letters", confirmed: 1, all: 2 } })))).toBe("1 من 2 بخطاب من الدائن");
    expect(assumptionSource(a({ key: "costs", source: { kind: "general" } }))).toBe("محسوبة من التقييم المتوقع والشروط العامة");
    expect(assumptionSource(a({ key: "facts", source: { kind: "conflict", count: 2 } }))).toBe("معلومتان يختلف فيها الملف عن مستند مدقق");
  });

  it("warns on every paid default that it does not guarantee the financing, with each lender's wait", () => {
    expect(SETTLE_WARNING).toContain("لا يضمن التمويل");
    const w = { lender: "بنك المثال", part: "personal" as const, confirmed: true };
    expect(waitText({ ...w, months: null, left: 0, confirmed: false })).toBe("بنك المثال: مدة الانتظار بعد السداد غير مؤكدة، تُسأل الجهة");
    expect(waitText({ ...w, months: 0, left: 0 })).toBe("بنك المثال: تقبل بعد السداد مباشرة بخطاب المخالصة");
    expect(plain(waitText({ ...w, months: 6, left: 6 }))).toBe("بنك المثال: تنتظر 6 أشهر بعد السداد، يبقى منها 6 أشهر");
    expect(plain(waitText({ ...w, months: 6, left: 0, confirmed: false }))).toBe("بنك المثال: تنتظر 6 أشهر بعد السداد، وقد مضت (غير مؤكد)");
    // One lender of both parts is said once.
    expect(waitLines({ pays: true, waits: [{ ...w, months: 0, left: 0 }, { ...w, part: "mortgage", months: 0, left: 0 }] })).toHaveLength(1);
  });

  it("says a lender's written approval the deal is not counted on, with both amounts and what to do", () => {
    const text = approvalApartText({ lender: "بنك المثال", part: "personal", approved: 230009, counted: 233009 });
    expect(plain(text)).toBe("موافقة بنك المثال المكتوبة على التمويل الشخصي 230,009، والصفقة محسوبة على 233,009. احسب الصفقة على مبلغ الموافقة قبل أي عرض للعميل.");
    expect(plain(approvalApartText({ lender: "بنك المثال", part: "mortgage", approved: 900000, counted: 950000 }))).toContain("على التمويل العقاري 900,000");
    expect(plain(text)).not.toMatch(wordy);
  });

  it("tells the difference in financing against the deal as it stands", () => {
    expect(financingDiffText(0)).toBe("مثل الصفقة الآن");
    expect(plain(financingDiffText(45000))).toBe("+45,000 عن الصفقة الآن");
    expect(plain(financingDiffText(-12000))).toBe("−12,000 عن الصفقة الآن");
  });
});
