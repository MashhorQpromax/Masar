import { describe, expect, it } from "vitest";
import { auditDetail } from "@/copy/audit";
import { FEE_REFUSALS, saveError } from "@/copy/editor";
import { collectedError, COLLECTED_REFUSALS, collectedText, FEE_COLLECTION, FEE_DUE, feeText, movesText, planError, planLine, planState, PLAN_REFUSALS, policyError, policyText, POLICY_PROBLEMS, rangeText, termsText } from "@/copy/fees";
import { offerTerms } from "@/copy/messages";
import { DEFAULT_POLICY, FEE_COLLECTIONS, FEE_DUES, policyFee } from "@/domain/deal";

const plain = (text: string) => text.replace(/[⁦⁩]/g, "");
const wordy = /undefined|NaN|null|\[object|[A-Za-z_]{3,}|—|–/;

describe("the wording of fees", () => {
  it("tells a deal's fee in one line, each part only when it is there", () => {
    expect(plain(feeText(policyFee(DEFAULT_POLICY)))).toBe("10% على السداد و10% على كامل التمويل");
    expect(plain(feeText({ settlePct: 12.5, financePct: 15, financeBase: "personal", settleIncludesPayoff: true, fixed: 5000 }))).toBe("12.5% على السداد والمخالصات و15% على الشخصي فقط ومبلغ مقطوع 5,000");
    expect(plain(feeText({ ...policyFee(DEFAULT_POLICY), financeBase: "net" }))).toBe("10% على السداد و10% على الصافي بعد التسويات");
  });

  it("tells the policy as the settings page shows it", () => {
    expect(plain(rangeText(DEFAULT_POLICY))).toBe("الحدود من 10% إلى 35%");
    expect(plain(policyText(DEFAULT_POLICY))).toBe("تبدأ كل صفقة جديدة بـ 10% على السداد و10% على كامل التمويل. الحدود من 10% إلى 35%. تُستحق عند صرف التمويل وتُخصم منه.");
  });

  it("tells when a fee falls due and how it is collected, to the office and to the client", () => {
    expect(termsText({ due: "disbursement", collection: "deducted" })).toBe("تُستحق عند صرف التمويل وتُخصم منه");
    expect(termsText({ due: "disbursement", collection: "transfer" })).toBe("تُستحق عند صرف التمويل ويسددها العميل بتحويل");
    expect(termsText({ due: "approval", collection: "transfer" })).toBe("تُستحق عند موافقة الجهة ويسددها العميل بتحويل");
    expect(termsText({ due: "agreement", collection: "transfer" })).toBe("تُستحق عند توقيع الاتفاق ويسددها العميل بتحويل");
    expect(offerTerms({ due: "disbursement", collection: "deducted" })).toBe("تُستحق أتعابنا عند صرف تمويلك، وتُخصم منه مباشرة.");
    expect(offerTerms({ due: "approval", collection: "transfer" })).toBe("تُستحق أتعابنا عند موافقة الجهة على تمويلك، وتسددها بتحويل بنكي.");
    expect(offerTerms({ due: "agreement", collection: "transfer" })).toBe("تُستحق أتعابنا عند توقيع الاتفاق، وتسددها بتحويل بنكي.");
    for (const due of FEE_DUES) expect(FEE_DUE[due]).not.toMatch(wordy);
    for (const collection of FEE_COLLECTIONS) expect(FEE_COLLECTION[collection]).not.toMatch(wordy);
  });

  it("words every refusal, of a policy and of a deal's fee, with no code in it", () => {
    for (const reason of POLICY_PROBLEMS) expect(policyError("POLICY_REFUSED", { reason })).not.toMatch(wordy);
    for (const reason of FEE_REFUSALS) {
      const text = saveError("FEE_REFUSED", { reason, min: "10", max: "35" });
      expect(text, reason).toMatch(/^[؀-ۿ]/);
      expect(text, reason).not.toMatch(wordy);
    }
    expect(plain(saveError("FEE_REFUSED", { reason: "OUT_OF_RANGE", min: "10", max: "35" }))).toBe("نسبة الأتعاب خارج سياسة المكتب، من 10% إلى 35%.");
    expect(plain(saveError("FEE_REFUSED", { reason: "REASON_NEEDED" }))).toBe("اكتب سبب تعديل الأتعاب، 10 أحرف على الأقل.");
    expect(policyError("FORBIDDEN")).toBe("سياسة الأتعاب لمدير النظام وحده.");
    expect(policyError("ELSE")).toBe("تعذر الحفظ. حاول مرة أخرى.");
  });

  it("tells in the audit log what a fee was, what it became, and why", () => {
    const before = policyFee(DEFAULT_POLICY);
    const detail = auditDetail("deal.fee", { before, after: { ...before, financePct: 15 }, changed: ["financePct"], reason: "تعثر لدى شركة تمويل", amount: 90000 });
    expect(plain(detail)).toBe("من 10% على السداد و10% على كامل التمويل إلى 10% على السداد و15% على كامل التمويل، تعثر لدى شركة تمويل");
    expect(auditDetail("deal.fee", { before: "broken" })).toBe("");
    const policy = auditDetail("settings.fees", { before: DEFAULT_POLICY, after: { ...DEFAULT_POLICY, max: 30 } });
    expect(plain(policy)).toContain("صارت: تبدأ كل صفقة جديدة بـ 10% على السداد و10% على كامل التمويل. الحدود من 10% إلى 30%.");
    expect(policy).not.toMatch(wordy);
    // A change of the terms alone is told, and a policy logged before the terms reads with the office's own model.
    const terms = auditDetail("settings.fees", { before: DEFAULT_POLICY, after: { ...DEFAULT_POLICY, due: "agreement", collection: "transfer" } });
    expect(plain(terms)).toContain("تُستحق عند توقيع الاتفاق ويسددها العميل بتحويل.");
    const { due: _due, collection: _collection, ...old } = DEFAULT_POLICY;
    expect(plain(auditDetail("settings.fees", { before: old, after: { ...old, max: 30 } }))).toContain("الحدود من 10% إلى 30%. تُستحق عند صرف التمويل وتُخصم منه.");
  });

  it("tells a fee plan that stands with who, when and what it comes to, and one that fell with what moved", () => {
    const at = new Date("2026-11-23T09:00:00Z");
    const plan = { amounts: { settle: 14000, finance: 92000, fixed: 0, total: 106000 }, clientNet: 222000 };
    const stands = planState({ latest: { by: "سارة", at, plan, stands: true, moves: { figures: [], fee: [] } }, closing: true, may: true });
    expect(stands.state).toBe("stands");
    expect(plain(stands.text)).toMatch(/^اعتمدها سارة في .+: أتعاب 106,000، ويبقى للعميل 222,000\. تسقط إن تغيّر رقم في الصفقة أو شرط جهتها\.$/);
    const moves = { figures: [{ name: "fee" as const, then: 106000, now: 104000 }, { name: "clientNet" as const, then: 222000, now: 204000 }], fee: [] };
    const fell = planState({ latest: { by: null, at, plan, stands: false, moves }, closing: true, may: true });
    expect(plain(fell.text)).toBe("تغيّر منذ اعتمادها أتعاب المكتب من 106,000 إلى 104,000، وما يبقى للعميل من 222,000 إلى 204,000. الاعتماد يحفظ منها نسخة لا تتغير.");
    expect(movesText({ figures: [], fee: ["settlePct"] })).toBe("الأتعاب نفسها");
    // A lender's term moved under the deal's route, and nothing on the deal did.
    expect(movesText({ figures: [], fee: [], lenders: true })).toBe("شروط الجهة التي تقوم عليها الصفقة");
    expect(movesText({ figures: [], fee: ["settlePct"], lenders: true })).toBe("الأتعاب نفسها، وشروط الجهة التي تقوم عليها الصفقة");
    expect(plain(movesText({ figures: [{ name: "fee", then: 106000, now: 104000 }], fee: [], lenders: true }))).toBe("أتعاب المكتب من 106,000 إلى 104,000، وشروط الجهة التي تقوم عليها الصفقة");
    expect(planState({ latest: null, closing: false, may: true }).text).toBe("لا تُعتمد صفقة لا تُغلق: فيها عجز، أو ينقصها ما يُحكم به.");
    expect(planState({ latest: null, closing: true, may: false })).toEqual({ state: "none", title: "خطة الأتعاب غير معتمدة", text: "يعتمدها مدير النظام." });
    expect(plain(planLine({ by: null, at, plan, stands: false }))).toMatch(/^.+ · حساب محذوف · أتعاب 106,000 · للعميل 222,000 · سقط$/);
  });

  it("words every refusal of a plan, and logs an approval with the fee and what the client keeps", () => {
    for (const reason of PLAN_REFUSALS) expect(planError("PLAN_REFUSED", { reason })).not.toMatch(wordy);
    expect(planError("FORBIDDEN")).toBe("اعتماد الأتعاب لمدير النظام وحده.");
    const detail = auditDetail("deal.fee_approve", { fee: policyFee(DEFAULT_POLICY), amount: 106000, clientNet: 222000 });
    expect(plain(detail)).toBe("أتعاب 106,000، يبقى للعميل 222,000، 10% على السداد و10% على كامل التمويل");
    // An approval logs the terms it kept, and one logged before them is told without.
    const withTerms = auditDetail("deal.fee_approve", { fee: policyFee(DEFAULT_POLICY), amount: 106000, clientNet: 222000, terms: { due: "agreement", collection: "transfer" } });
    expect(plain(withTerms)).toBe("أتعاب 106,000، يبقى للعميل 222,000، 10% على السداد و10% على كامل التمويل، تُستحق عند توقيع الاتفاق ويسددها العميل بتحويل");
    expect(withTerms).not.toMatch(wordy);
    expect(plain(auditDetail("deal.fee_approve", { fee: policyFee(DEFAULT_POLICY), amount: 106000, clientNet: 222000, terms: { due: "approval", collection: "deducted" } }))).toBe(plain(detail));
  });
});

describe("the wording of a collected fee", () => {
  it("says what was collected beside what was counted, and says plainly when nothing was recorded", () => {
    expect(collectedText(102000, null)).toBe("لم يُسجَّل بعد ما حُصّل من أتعابها.");
    expect(plain(collectedText(102000, 102000))).toBe("حُصّل من أتعابها 102,000 ريال، كما حُسبت.");
    expect(plain(collectedText(102000, 100000))).toBe("حُصّل من أتعابها 100,000 ريال، أقل من المحسوب بـ 2,000.");
    expect(plain(collectedText(102000, 103500))).toBe("حُصّل من أتعابها 103,500 ريال، أكثر من المحسوب بـ 1,500.");
    // Nothing collected is said as such, and a deal whose fee was never counted says the amount alone.
    expect(collectedText(102000, 0)).toBe("لم يُحصَّل شيء من أتعابها.");
    expect(plain(collectedText(null, 100000))).toBe("حُصّل من أتعابها 100,000 ريال.");
    for (const said of [collectedText(102000, null), collectedText(102000, 100000), collectedText(null, 5), collectedText(1, 0)]) expect(plain(said)).not.toMatch(wordy);
  });

  it("tells a person why an amount was not recorded", () => {
    expect(COLLECTED_REFUSALS).toEqual(["NOT_CLOSED", "AMOUNT"]);
    expect(collectedError("COLLECTED_REFUSED", { reason: "NOT_CLOSED" })).toBe("تُسجَّل الأتعاب المحصلة بعد إغلاق الصفقة.");
    expect(collectedError("COLLECTED_REFUSED", { reason: "AMOUNT" })).toBe("اكتب المبلغ المحصل بالريال.");
    expect(collectedError("FORBIDDEN")).toBe("تسجيل الأتعاب المحصلة لمن يملك تعديل الأتعاب.");
    expect(collectedError("NOT_FOUND")).toBe("هذه الصفقة لم تعد موجودة.");
    expect(collectedError("COLLECTED_REFUSED", { reason: "SOMETHING_NEW" })).toBe("تعذر الحفظ. حاول مرة أخرى.");
    for (const code of ["COLLECTED_REFUSED", "FORBIDDEN", "NOT_FOUND", "OTHER"]) expect(collectedError(code)).not.toMatch(wordy);
  });

  it("reads in the log as what was collected of what was counted, and what it replaced", () => {
    expect(plain(auditDetail("deal.fee_collected", { clientId: 1, counted: 102000, before: null, after: 100000 }))).toBe("حُصّل 100,000 من 102,000 محسوبة");
    expect(plain(auditDetail("deal.fee_collected", { counted: 102000, before: 100000, after: 101000 }))).toBe("حُصّل 101,000 من 102,000 محسوبة، كان المسجل 100,000");
    expect(plain(auditDetail("deal.fee_collected", { counted: null, before: null, after: 100000 }))).toBe("حُصّل 100,000");
    expect(plain(auditDetail("deal.fee_collected", { counted: 102000, before: 100000, after: null }))).toBe("أُلغي تسجيل 100,000");
    expect(auditDetail("deal.fee_collected", { after: "broken" })).toBe("");
  });
});
