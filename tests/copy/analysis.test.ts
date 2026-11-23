import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AFTER_CLEARING,
  ANALYSIS_VERDICT,
  DECISION_SUPPORT,
  FIT_STATUS,
  fitCheckText,
  floorText,
  GAP_KIND,
  gapText,
  INCOME_BASIS,
  incomeHow,
  kindTitle,
  MARK_SOURCE,
  markText,
  noInstallment,
  noTaker,
  roomRule,
  stepText,
  stepTitle,
  verdictSay,
} from "@/copy/analysis";
import { CONSENT_ASK, CONSENT_WITHDRAWN, creditError, UPLOAD_ERROR_CODES } from "@/copy/credit";
import { analyzeClient, type ClientAnalysis, type FileFacts, type Gap, type RecordFacts, type Step } from "@/domain/analysis";
import { analyzeCredit, emptyReport, type CreditReport, type Facility } from "@/domain/credit";
import type { Product } from "@/domain/eligibility";

const golden = JSON.parse(readFileSync(new URL("../golden/credit.json", import.meta.url), "utf8"));
const reports: CreditReport[] = golden.cases.map((c: { report: CreditReport }) => c.report);
// Names from the reports themselves may be Latin. The wording around them may not.
const broken = /undefined|NaN|null|\[object|—|–/;
const latin = /[A-Za-z_]{3,}/;
const strip = (text: string) => text.replace(/[⁦⁩]/g, "");

const file = (parts: Partial<FileFacts> = {}): FileFacts => ({
  age: 35,
  nationality: "saudi",
  sector: "gov",
  serviceMonths: 120,
  basicSalary: 12000,
  totalSalary: 16000,
  otherIncome: null,
  coIncome: null,
  salaryBank: "a",
  housingSupport: false,
  propertyValue: null,
  request: null,
  incomeVerified: true,
  consent: true,
  ...parts,
});
const record = (report: CreditReport, parts: Partial<RecordFacts> = {}): RecordFacts => ({ report, analysis: analyzeCredit(report), confidence: "high", readingWarnings: 0, ageMonths: 0, ...parts });
const product = (id: string, lender: string, parts: Partial<Product> = {}): Product => ({
  id,
  lenderId: lender,
  lenderName: `جهة ${lender}`,
  lenderType: "bank",
  bankCode: lender,
  financeType: "personal",
  name: "منتج",
  minSalary: 4000,
  minAge: 21,
  maxAgeAtMaturity: 65,
  minServiceMonths: 3,
  sectors: ["gov", "military", "semi_gov"],
  nationalities: ["saudi"],
  maxTenor: 60,
  maxAmount: 2_000_000,
  rate: 3.2,
  rateType: "flat",
  requiresSalaryTransfer: true,
  acceptsLateSimah: false,
  maxLtv: null,
  notes: null,
  settledDefaultWaitMonths: 0,
  verified: true,
  ...parts,
});
const home = (id: string, lender: string, parts: Partial<Product> = {}): Product =>
  product(id, lender, { financeType: "mortgage", maxAgeAtMaturity: 70, maxTenor: 300, maxAmount: 5_000_000, rate: 5, rateType: "reducing", maxLtv: 90, ...parts });
const catalogue: Product[] = [
  product("1", "a"),
  product("2", "b", { verified: false, settledDefaultWaitMonths: null }),
  product("3", "c", { lenderType: "finance_company", bankCode: null, requiresSalaryTransfer: false, acceptsLateSimah: true, settledDefaultWaitMonths: 12, minSalary: 20000 }),
  home("4", "a"),
  home("5", "b", { verified: false, settledDefaultWaitMonths: 6, minServiceMonths: 240 }),
];
const loan = (parts: Partial<Facility>): Facility => ({ lender: "بنك", creditorType: "bank", product: "قرض شخصي", status: "current", ...parts });

/** Clients of every kind the file can describe, so the engine says everything it can say. */
const files: FileFacts[] = [
  file(),
  file({ incomeVerified: false, salaryBank: null, age: null, serviceMonths: null, consent: false }),
  file({ totalSalary: null, otherIncome: 4000 }),
  file({ basicSalary: null, totalSalary: null }),
  file({ sector: "retired", age: 62, serviceMonths: null, totalSalary: 9000, basicSalary: 9000 }),
  file({ age: 58, totalSalary: 30000, request: { kind: "mortgage", amount: 900000, tenor: 240 }, propertyValue: 1_000_000, housingSupport: true }),
  file({ totalSalary: 5000, basicSalary: 4000, request: { kind: "auto", amount: 80000, tenor: 60 } }),
];
const readings: Partial<RecordFacts>[] = [{}, { confidence: "medium", readingWarnings: 2, ageMonths: 4 }, { confidence: "low", readingWarnings: 1 }, { confidence: "medium" }];

const everything: ClientAnalysis[] = reports.flatMap((report) => [
  ...files.flatMap((f) => readings.map((how) => analyzeClient({ file: f, record: record(report, how), products: catalogue }))),
  // With no lenders in the catalogue there is nothing to hold the client against.
  analyzeClient({ file: files[0]!, record: record(report), products: [] }),
]);

/** A sentence a person reads: whole, in Arabic, and ended. */
function sentence(text: string, about: string, names: string[] | null = []): void {
  expect(text.length, about).toBeGreaterThan(8);
  expect(text, about).not.toMatch(broken);
  expect(text.endsWith("."), about).toBe(true);
  expect(text.includes(".."), about).toBe(false);
  // What the report itself names may be written in Latin letters. Nothing else is.
  if (names) expect(names.reduce((left, name) => left.replaceAll(name, ""), strip(text)), about).not.toMatch(latin);
}

describe("analysis wording", () => {
  it("has a sentence for everything the engine can say", () => {
    const seen = new Set<string>();
    for (const a of everything) {
      const names = a.commitments.flatMap((c) => [c.lender, c.product]);
      const toClear = a.afterClearing != null ? 40000 : 0;
      sentence(verdictSay(a, toClear), `verdict.${a.verdict}`);
      sentence(verdictSay(a, 0), `verdict.${a.verdict}`);
      seen.add(`verdict.${a.verdict}.${a.afterClearing}`);
      for (const gap of a.gaps) {
        sentence(gapText(gap), `gap.${gap.code}`, names);
        expect(GAP_KIND[gap.kind]).toBeTruthy();
        seen.add(`gap.${gap.code}`);
      }
      for (const step of a.steps) {
        const title = stepTitle(step);
        const text = stepText(step);
        // The credit record's own steps name the creditors the report names.
        const own = [...names, ...("lender" in step ? [step.lender] : []), ...(step.code === "APPLY" ? [step.product] : [])];
        sentence(text, `step.${step.code}`, step.code === "CREDIT" ? null : own);
        expect(title.length, step.code).toBeGreaterThan(5);
        expect(title, step.code).not.toMatch(broken);
        expect(title.endsWith("."), step.code).toBe(false);
        expect(title.length, step.code).toBeLessThan(text.length);
        seen.add(`step.${step.code}`);
      }
      for (const mark of [...a.strengths, ...a.risks]) {
        const text = markText(mark);
        expect(text.length).toBeGreaterThan(8);
        expect(text).not.toMatch(broken);
        expect(text.endsWith(".")).toBe(true);
        expect(MARK_SOURCE[mark.source]).toBeTruthy();
        seen.add(`mark.${mark.source}`);
      }
      for (const k of a.kinds) {
        expect(strip(kindTitle(k))).toMatch(/^تمويل /);
        expect(strip(roomRule(k.room))).toMatch(/^يحكمه /);
        expect(roomRule(k.room)).not.toMatch(broken);
        for (const fit of [...k.today.fits, ...(k.cleared?.fits ?? [])]) {
          expect(FIT_STATUS[fit.status]).toBeTruthy();
          for (const check of [...fit.conditions, ...fit.refusals]) {
            sentence(fitCheckText(check), `check.${check.code}`);
            seen.add(`check.${check.code}`);
          }
        }
      }
      for (const c of a.commitments) expect(noInstallment(c)).toBeTruthy();
      expect(INCOME_BASIS[a.income.basis]).toBeTruthy();
      const how = incomeHow(a.income);
      if (how) sentence(how, "income");
    }
    // Every gap and every step the engine has, each met at least once.
    const gaps: Gap["code"][] = ["INCOME", "TOTAL_SALARY", "INCOME_PROOF", "AGE", "SERVICE", "SALARY_BANK", "INSTALLMENT", "CARD_SHARE", "REPORT_AGE", "READING", "SUSPENSION", "TERMS", "CONSENT"];
    for (const code of gaps) expect(seen, code).toContain(`gap.${code}`);
    const steps: Step["code"][] = ["RECORD_CONSENT", "COMPLETE_FILE", "REVIEW_READING", "CONFIRM_SUSPENSION", "CREDIT", "REFRESH_REPORT", "FREE_ROOM", "VERIFY_INCOME", "APPLY"];
    for (const code of steps) expect(seen, code).toContain(`step.${code}`);
    for (const key of ["verdict.eligible.null", "verdict.conditional.null", "verdict.not_eligible.null", "verdict.pending.null", "mark.file", "mark.record", "check.RECORD_OPEN", "check.SETTLED_UNCONFIRMED", "check.SETTLED_WAIT"]) {
      expect(seen, key).toContain(key);
    }
  });

  it("names each result and says what it is", () => {
    expect(ANALYSIS_VERDICT).toEqual({ eligible: "مؤهل مبدئياً", conditional: "مؤهل بشروط", not_eligible: "غير مؤهل الآن", pending: "بحاجة إلى تحقق" });
    // No result reads as a lender's yes.
    expect(DECISION_SUPPORT).toBe("هذا التحليل يدعم قرار الموظف، وليس موافقة تمويلية. القرار النهائي للجهة الممولة.");
    for (const text of [AFTER_CLEARING, noTaker(true), noTaker(false)]) sentence(text, "lenders");
    expect(AFTER_CLEARING).toContain("لا يضمن القبول");
  });

  it("says the result in a sentence", () => {
    const clean = report({ facilities: [loan({ installment: 1000, balance: 20000 })] });
    const open = analyzeClient({ file: file(), record: record(clean), products: [product("1", "a"), product("2", "b", { requiresSalaryTransfer: false }), home("3", "a")] });
    expect(strip(verdictSay(open, 0))).toBe("جهتان تقبلانه.");
    const one = analyzeClient({ file: file(), record: record(clean), products: [product("1", "a", { settledDefaultWaitMonths: null })] });
    expect(strip(verdictSay(one, 0))).toBe("جهة واحدة تقبله.");
    const none = analyzeClient({ file: file({ totalSalary: 3000, basicSalary: 3000 }), record: record(clean), products: [product("1", "a")] });
    expect(strip(verdictSay(none, 0))).toBe("لا جهة في القائمة تقبله بشروطها المسجلة.");

    // A default that is paid leaves a lender nobody asked as a condition, and the sentence promises nothing.
    const owing = report({ facilities: [loan({ status: "default", defaultAmount: 40000, defaultNow: 40000 })] });
    const blocked = analyzeClient({ file: file(), record: record(owing), products: [product("1", "a", { settledDefaultWaitMonths: null })] });
    expect(blocked.afterClearing).toBe("conditional");
    expect(strip(verdictSay(blocked, 40000))).toBe("لا جهة تقبله قبل سداد 40,000. بعده جهة واحدة تقبله بشروط، والسداد لا يضمن القبول.");
    expect(strip(verdictSay(blocked, 0))).toBe("لا جهة تقبله قبل رفع ما يمنع. بعده جهة واحدة تقبله بشروط، والسداد لا يضمن القبول.");
    const waits = analyzeClient({ file: file(), record: record(owing), products: [product("1", "a", { settledDefaultWaitMonths: 12 })] });
    expect(strip(verdictSay(waits, 40000))).toBe("لا جهة تقبله قبل سداد 40,000. وبعده لا جهة في القائمة تقبله بشروطها المسجلة.");

    const noConsent = analyzeClient({ file: file({ consent: false, basicSalary: null, totalSalary: null }), record: record(clean), products: catalogue });
    expect(verdictSay(noConsent, 0)).toBe("موافقة العميل على معالجة بياناته وتقريره غير مسجلة. سجّلها قبل الاعتماد على ما هنا.");
    const noSalary = analyzeClient({ file: file({ basicSalary: null, totalSalary: null }), record: record(clean), products: catalogue });
    expect(verdictSay(noSalary, 0)).toBe("الراتب غير مدخل في الملف، فلا نسبة تُحسب ولا جهة تُقاس قبل إدخاله.");
    const noLenders = analyzeClient({ file: file(), record: record(clean), products: [] });
    expect(verdictSay(noLenders, 0)).toBe("لا جهات في القائمة نقيس عليها. أضف الجهات وشروطها أولاً.");
    const doubted = analyzeClient({ file: file(), record: record(clean, { confidence: "low" }), products: catalogue });
    expect(verdictSay(doubted, 0)).toBe("قراءة التقرير ضعيفة الثقة. طابقها على التقرير الأصلي قبل الاعتماد على ما هنا.");
  });

  it("says what is missing with its figures, and counts in correct Arabic", () => {
    expect(strip(floorText(1))).toBe("التزام واحد بلا قسط في التقرير، فالنسبة حد أدنى والقسط المتاح حد أعلى.");
    expect(strip(floorText(2))).toBe("التزامان بلا قسط في التقرير، فالنسبة حد أدنى والقسط المتاح حد أعلى.");
    expect(strip(floorText(3))).toBe("3 التزامات بلا قسط في التقرير، فالنسبة حد أدنى والقسط المتاح حد أعلى.");
    expect(strip(gapText({ kind: "missing", code: "INSTALLMENT", lender: "شركة تقسيط", product: "تمويل شخصي", balance: 27000 }))).toBe(
      "شركة تقسيط، تمويل شخصي: القسط غير مذكور في التقرير، والرصيد 27,000. لم يدخل في النسبة.",
    );
    expect(strip(gapText({ kind: "missing", code: "INSTALLMENT", lender: "شركة تقسيط", product: "تمويل شخصي", balance: null }))).toBe("شركة تقسيط، تمويل شخصي: القسط غير مذكور في التقرير. لم يدخل في النسبة.");
    expect(strip(gapText({ kind: "unconfirmed", code: "CARD_SHARE", lender: "بنك", limit: 20000, balance: 6500 }))).toBe(
      "بطاقة بنك بحد 20,000: لا قسط لها في التقرير، فلم تدخل في النسبة. بعض الجهات تحتسب نسبة من حدّها.",
    );
    expect(strip(gapText({ kind: "unconfirmed", code: "TERMS", unverified: 11, of: 11 }))).toBe("شروط الجهات استرشادية، ولم تؤكَّد مع أي جهة بعد.");
    expect(strip(gapText({ kind: "unconfirmed", code: "TERMS", unverified: 3, of: 11 }))).toBe("شروط 3 من 11 منتجاً استرشادية، ولم تؤكَّد مع جهاتها.");
    expect(strip(gapText({ kind: "unconfirmed", code: "REPORT_AGE", months: 4 }))).toBe("مضى على التقرير 4 أشهر، وقد تغيّر ما فيه.");
    expect(strip(gapText({ kind: "unconfirmed", code: "READING", confidence: "medium", warnings: 2 }))).toBe("في قراءة التقرير ملاحظتان تحتاج مطابقة على الأصل.");
    expect(noInstallment({ kind: "card" })).toBe("بلا قسط في التقرير");
    expect(noInstallment({ kind: "personal" })).toBe("القسط غير مذكور");
  });

  it("words a step with what it takes and never promises a lender's yes", () => {
    const apply: Step = { code: "APPLY", kind: "personal", lender: "جهة أ", product: "منتج", amount: 177000, installment: 3422, months: 60, conditional: true, afterClearing: true, verified: false };
    expect(stepTitle(apply)).toBe("بعد السداد: جهة أ");
    expect(strip(stepText(apply))).toBe("تمويل شخصي حتى 177,000 بقسط 3,422 لمدة 60 شهراً. تقبل بشروط مذكورة عندها. سداد التعثر لا يضمن القبول. شروطها استرشادية، فأكّدها معها قبل وعد العميل.");
    const sure: Step = { ...apply, conditional: false, afterClearing: false, verified: true };
    expect(stepTitle(sure)).toBe("قدّم إلى جهة أ");
    expect(strip(stepText(sure))).toBe("تمويل شخصي حتى 177,000 بقسط 3,422 لمدة 60 شهراً.");
    expect(strip(stepText({ code: "COMPLETE_FILE", missing: ["INCOME", "AGE", "SERVICE", "SALARY_BANK"] }))).toBe(
      "ينقصه: الراتب، سنة الميلاد، مدة الخدمة، بنك الراتب. ما ينقص يبقى شرطاً عند كل جهة ولا يُحسب قبولاً.",
    );
    expect(strip(stepText({ code: "FREE_ROOM", lender: "بنك", kind: "personal", monthly: 1900 }))).toBe("لا قسط متاح اليوم. سداد بنك يحرر 1,900 في الشهر، وهو أصغر التزام رصيداً.");
  });

  it("asks for the client's consent and says why a report was not read without it", () => {
    expect(UPLOAD_ERROR_CODES).toContain("CONSENT_NEEDED");
    expect(creditError("CONSENT_NEEDED")).not.toBe(creditError("SOMETHING_ELSE"));
    expect(creditError("CONSENT_NEEDED").endsWith(".")).toBe(true);
    // A label beside a tick carries no full stop.
    expect(CONSENT_ASK.endsWith(".")).toBe(false);
    expect(CONSENT_ASK).not.toMatch(latin);
    sentence(CONSENT_WITHDRAWN, "withdrawal");
    expect(stepTitle({ code: "RECORD_CONSENT" })).toBe("سجّل موافقة العميل");
    sentence(stepText({ code: "RECORD_CONSENT" }), "consent");
  });
});

function report(parts: Partial<CreditReport> = {}): CreditReport {
  return { ...emptyReport(), ...parts };
}
