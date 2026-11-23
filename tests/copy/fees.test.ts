import { describe, expect, it } from "vitest";
import { auditDetail } from "@/copy/audit";
import { FEE_REFUSALS, saveError } from "@/copy/editor";
import { feeText, policyError, policyText, POLICY_PROBLEMS, rangeText } from "@/copy/fees";
import { DEFAULT_POLICY, policyFee } from "@/domain/deal";

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
    expect(plain(policyText(DEFAULT_POLICY))).toBe("تبدأ كل صفقة جديدة بـ 10% على السداد و10% على كامل التمويل. الحدود من 10% إلى 35%.");
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
  });
});
