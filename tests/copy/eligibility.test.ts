import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  adviceText,
  ANSWER,
  ASKED_KIND,
  askedLabel,
  askedOpenText,
  capacityWarningText,
  capRuleText,
  CHECK_TITLE,
  checkText,
  conditionText,
  CONTRACT_TYPE,
  DOCUMENT_CATEGORY,
  documentLabel,
  FINANCE_TYPE,
  INQUIRY_WINDOW,
  limitText,
  MISSING_FACT,
  OBLIGATION_KIND,
  pointText,
  SPECIAL_KIND,
  STUDY_VERDICT,
  UNMET,
  UNMET_CHOICE,
} from "@/copy/eligibility";
import { ASKED_KINDS, CONTRACT_TYPES, FINANCE_TYPES, INQUIRY_WINDOWS, requiredDocuments, SECTORS, SPECIAL_KINDS, specialChecks, study, type NewCondition, type Product, type Profile, type SpecialCondition } from "@/domain/eligibility";

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

  it("names every kind of special condition, contract, answer and window, each in words of its own", () => {
    for (const [keys, table] of [
      [SPECIAL_KINDS, SPECIAL_KIND],
      [ASKED_KINDS, ASKED_KIND],
      [CONTRACT_TYPES, CONTRACT_TYPE],
      [["met", "unmet"], ANSWER],
      [["block", "action"], UNMET],
      [["block", "action"], UNMET_CHOICE],
      [INQUIRY_WINDOWS.map(String), INQUIRY_WINDOW],
    ] as const) {
      const said = keys.map((key) => (table as Record<string, string>)[key]!);
      for (const text of said) {
        expect(text).toMatch(/^[؀-ۿ]/);
        expect(strip(text)).not.toMatch(/[A-Za-z_]{3,}|—/);
      }
      expect(new Set(said).size).toBe(said.length);
    }
  });

  it("reads a special condition as the lender would say it", () => {
    const said = (condition: NewCondition) => strip(conditionText(condition));
    expect(said({ kind: "min_amount", amount: 20000 })).toBe("لا تموّل أقل من 20,000");
    expect(said({ kind: "inquiries", count: 0, months: 6 })).toBe("لا تقبل استعلاماً في آخر 6 أشهر");
    expect(said({ kind: "inquiries", count: 1, months: 6 })).toBe("لا تقبل أكثر من استعلام واحد في آخر 6 أشهر");
    expect(said({ kind: "inquiries", count: 2, months: 12 })).toBe("لا تقبل أكثر من استعلامين في آخر 12 شهراً");
    expect(said({ kind: "inquiries", count: 4, months: 12 })).toBe("لا تقبل أكثر من 4 استعلامات في آخر 12 شهراً");
    expect(said({ kind: "contract", contracts: ["permanent"] })).toBe("تقبل عقد العمل: دائم");
    expect(said({ kind: "contract", contracts: ["permanent", "fixed_term"] })).toBe("تقبل عقد العمل: دائم أو محدد المدة");
    // A known kind is named, with the lender's words beside it. A condition of no known kind is only its words.
    expect(said({ kind: "guarantor", text: null, unmet: "action" })).toBe("كفيل");
    expect(said({ kind: "guarantor", text: "موظف حكومي", unmet: "action" })).toBe("كفيل (موظف حكومي)");
    expect(said({ kind: "employer", text: null, unmet: "block" })).toBe("جهة عمل معتمدة عندها");
    expect(said({ kind: "other", text: "فحص طبي", unmet: "block" })).toBe("فحص طبي");
    expect(askedLabel({ kind: "other", text: null })).toBe("شرط آخر");
  });

  it("says what each special condition found about the client, and never calls a missing fact met", () => {
    const list: SpecialCondition[] = [
      { id: "1", kind: "min_amount", amount: 150000 },
      { id: "2", kind: "inquiries", count: 3, months: 6 },
      { id: "3", kind: "contract", contracts: ["permanent"] },
      { id: "4", kind: "guarantor", text: "موظف حكومي", unmet: "action" },
      { id: "5", kind: "employer", text: null, unmet: "block" },
    ];
    const said = (facts: Parameters<typeof specialChecks>[1]) => specialChecks(list, facts).map((check) => strip(checkText(check)));
    const base = { amount: 200000, most: 300000, contract: "permanent" as const, noContract: false, inquiries: { m6: 2, m12: 2 }, answers: { "4": "met" as const, "5": "met" as const } };
    expect(said(base)).toEqual([
      "المبلغ فوق أدنى تمويل عند الجهة، وهو 150,000.",
      "في السجل استعلامان في آخر 6 أشهر، وحد الجهة 3.",
      "نوع العقد مقبول (دائم).",
      "مستوفى: كفيل (موظف حكومي).",
      "مستوفى: جهة عمل معتمدة عندها.",
    ]);
    expect(said({ ...base, amount: 100000, contract: "probation", inquiries: { m6: 5, m12: 5 }, answers: { "4": "unmet", "5": "unmet" } })).toEqual([
      "أدنى تمويل عند الجهة 150,000، والمطلوب أقل منه.",
      "في السجل 5 استعلامات في آخر 6 أشهر، والجهة لا تقبل أكثر من 3.",
      "الجهة لا تقبل نوع العقد (تحت التجربة).",
      "تشترط الجهة ولم يستوفه العميل بعد: كفيل (موظف حكومي).",
      "العميل لا يستوفي شرط الجهة: جهة عمل معتمدة عندها.",
    ]);
    expect(said({ ...base, amount: 100000, most: 120000, contract: null, inquiries: null, answers: {} })).toEqual([
      "أدنى تمويل عند الجهة 150,000، والمتاح للعميل 100,000.",
      "عدد الاستعلامات في سمة غير معروف.",
      "نوع عقد العميل غير مدخل.",
      "لم يُجب بعد عن شرط الجهة: كفيل (موظف حكومي).",
      "لم يُجب بعد عن شرط الجهة: جهة عمل معتمدة عندها.",
    ]);
    expect(strip(checkText({ key: "special", status: "pass", code: "INQUIRIES", ref: "2", params: { count: 0, max: 3, months: 12 } }))).toBe("لا استعلام في السجل في آخر 12 شهراً، وحد الجهة 3.");
    // A lender that takes no inquiry at all is told in words, never as a limit of zero.
    expect(strip(checkText({ key: "special", status: "pass", code: "INQUIRIES", ref: "2", params: { count: 0, max: 0, months: 6 } }))).toBe("لا استعلام في السجل في آخر 6 أشهر، والجهة لا تقبل أي استعلام فيها.");
    expect(strip(checkText({ key: "special", status: "fail", code: "INQUIRIES", ref: "2", params: { count: 1, max: 0, months: 6 } }))).toBe("في السجل استعلام واحد في آخر 6 أشهر، والجهة لا تقبل أي استعلام.");
    expect(checkText({ key: "special", status: "pass", code: "SPECIAL_LIST", params: { count: 0 } })).toBe("لا شروط خاصة مسجلة للجهة.");
    expect(checkText({ key: "special", status: "pass", code: "SPECIAL_LIST", params: { count: 2 } })).toBe("للجهة شروط خاصة مسجلة.");
  });

  it("counts a client's unanswered questions with Arabic agreement", () => {
    expect([0, 1, 2, 3, 11].map((open) => strip(askedOpenText(open)))).toEqual(["أُجيب عنها كلها", "شرط واحد لم يُجب عنه", "شرطان لم يُجب عنهما", "3 شروط لم يُجب عنها", "11 شرطاً لم يُجب عنها"]);
  });
});
