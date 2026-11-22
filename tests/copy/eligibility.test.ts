import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  adviceText,
  capacityWarningText,
  capRuleText,
  CHECK_TITLE,
  checkText,
  DOCUMENT_CATEGORY,
  documentLabel,
  FINANCE_TYPE,
  limitText,
  MISSING_FACT,
  OBLIGATION_KIND,
  pointText,
  STUDY_VERDICT,
} from "@/copy/eligibility";
import { FINANCE_TYPES, requiredDocuments, SECTORS, study, type Product, type Profile } from "@/domain/eligibility";

const golden = JSON.parse(readFileSync(new URL("../golden/eligibility.json", import.meta.url), "utf8")) as {
  catalogue: Product[];
  cases: { profile: Profile; extra: Product[] }[];
};
const broken = /undefined|NaN|null|\[object/;
const strip = (text: string) => text.replace(/[⁦⁩]/g, "");

describe("eligibility wording", () => {
  it("has a sentence for every check, limit, point and piece of advice the engine produces", () => {
    const seen = new Set<string>();
    const say = (code: string, text: string, sentence = true) => {
      expect(text.length, code).toBeGreaterThan(8);
      expect(text, code).not.toMatch(broken);
      expect(text.endsWith("."), code).toBe(sentence);
      seen.add(code);
    };
    for (const c of golden.cases) {
      const s = study(c.profile, [...golden.catalogue, ...c.extra]);
      for (const m of s.matches) {
        for (const check of m.checks) {
          say(`check.${check.code}.${check.status}`, checkText(check));
          expect(CHECK_TITLE[check.key]).toBeTruthy();
        }
        say(`limit.${m.limitedBy.code}`, limitText(m.limitedBy), false);
      }
      for (const p of s.strengths) say(`good.${p.code}`, pointText(p));
      for (const p of s.risks) say(`bad.${p.code}`, pointText(p));
      for (const a of s.advice) say(`advice.${a.code}`, adviceText(a));
      for (const w of s.capacity.warnings) say(`warning.${w}`, capacityWarningText(w));
      say(`rule.${s.capacity.rule}`, capRuleText(s.capacity.rule, s.capacity.capUsed, s.capacity), false);
      expect(STUDY_VERDICT[s.verdict]).toBeTruthy();
      for (const fact of s.missing) expect(MISSING_FACT[fact]).toBeTruthy();
    }
    // 29 checks by outcome, 4 limits, 4 strengths, 6 risks, 7 pieces of advice, 2 warnings and 2 rules.
    expect([...seen].filter((code) => code.startsWith("check.")).length).toBe(29);
    expect(seen.size).toBe(54);
  });

  it("names every kind of finance, obligation and paper", () => {
    for (const table of [FINANCE_TYPE, OBLIGATION_KIND, DOCUMENT_CATEGORY, STUDY_VERDICT, MISSING_FACT, CHECK_TITLE]) {
      for (const text of Object.values(table)) expect(text).toBeTruthy();
    }
    for (const financeType of FINANCE_TYPES) {
      for (const sector of SECTORS) {
        for (const nationality of ["saudi", "non_saudi"] as const) {
          const needs = requiredDocuments(financeType, sector, nationality);
          expect(new Set(needs.map((n) => n.code)).size).toBe(needs.length);
          for (const n of needs) {
            const label = documentLabel(n.code, { financeType, sector, nationality });
            expect(label, n.code).not.toBe(n.code);
            expect(label, n.code).not.toMatch(/[A-Za-z—(]/);
            expect(DOCUMENT_CATEGORY[n.category]).toBeTruthy();
          }
        }
      }
    }
  });

  it("reads naturally", () => {
    expect(strip(checkText({ key: "salary", status: "fail", code: "SALARY_MIN", params: { salary: 3500, min: 4000 } }))).toBe("الراتب 3,500 أقل من الحد الأدنى 4,000.");
    expect(strip(checkText({ key: "age", status: "warn", code: "TENOR_SHORTENED", params: { tenor: 36, max: 60 } }))).toBe("قُصّرت المدة إلى 36 شهراً حتى ينتهي التمويل قبل سن 60.");
    expect(strip(checkText({ key: "dbr", status: "pass", code: "ROOM", params: { available: 4000, rule: "SALARY_DEDUCTION", share: 0.3333, retired: false, mortgage: false } }))).toBe(
      "القسط المتاح 4,000، ويحكمه حد ثلث الراتب.",
    );
    expect(strip(checkText({ key: "dbr", status: "pass", code: "ROOM", params: { available: 7800, rule: "TOTAL_CAP", share: 0.65, retired: false, mortgage: true } }))).toBe(
      "القسط المتاح 7,800، ويحكمه السقف الكلي 65% من الدخل شاملاً العقاري.",
    );
    expect(strip(checkText({ key: "ltv", status: "pass", code: "DOWN_PAYMENT", params: { percent: 90, propertyValue: 1000000, down: 100000 } }))).toBe(
      "تموّل الجهة حتى 90% من 1,000,000، والدفعة الأولى 100,000.",
    );
    expect(strip(adviceText({ code: "APPLY_ORDER", lenders: ["مصرف الراجحي", "بنك الرياض"] }))).toBe(
      "قدّم بالترتيب: مصرف الراجحي ثم بنك الرياض. طلب بعد طلب لا معاً، حتى لا تكثر الاستعلامات في سمة.",
    );
    expect(strip(adviceText({ code: "PAY_SMALLEST", lender: null, kind: "card" }))).toBe("سدّد أصغر التزام (بطاقة ائتمانية) أو أعد جدولته ليرتفع القسط المتاح.");
    expect(documentLabel("id", { financeType: "personal", sector: "gov", nationality: "non_saudi" })).toBe("الإقامة سارية المفعول");
    expect(documentLabel("deed", { financeType: "project", sector: "self", nationality: "saudi" })).toBe("صك الأرض ورقم الهوية العقارية");
  });
});
