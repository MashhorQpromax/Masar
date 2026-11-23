import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AFTER_CLEARING,
  ANALYSIS_VERDICT,
  DECISION_SUPPORT,
  fitCheckText,
  fitDoubtLines,
  fitLines,
  fitRefusalLines,
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
import { TERMS, termStanding, type Product, type Term } from "@/domain/eligibility";

/** Every term of a product confirmed three weeks ago, except the ones left open. A lender whose terms nobody confirmed has none. */
const confirmed = (open: Term[] = [], confirmedOn = "2026-11-01"): Product["terms"] =>
  Object.fromEntries(TERMS.filter((term) => !open.includes(term)).map((term) => [term, termStanding({ kind: "lender_document", reference: "نشرة المنتج", confirmedOn }, "2026-11-23")]));
const unconfirmed: Partial<Product> = { verified: false, terms: undefined };

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
  terms: confirmed(),
  ...parts,
});
const home = (id: string, lender: string, parts: Partial<Product> = {}): Product =>
  product(id, lender, { financeType: "mortgage", maxAgeAtMaturity: 70, maxTenor: 300, maxAmount: 5_000_000, rate: 5, rateType: "reducing", maxLtv: 90, ...parts });
const catalogue: Product[] = [
  product("1", "a"),
  product("2", "b", { ...unconfirmed, settledDefaultWaitMonths: null }),
  product("3", "c", { lenderType: "finance_company", bankCode: null, requiresSalaryTransfer: false, acceptsLateSimah: true, settledDefaultWaitMonths: 12, minSalary: 20000 }),
  home("4", "a"),
  home("5", "b", { ...unconfirmed, settledDefaultWaitMonths: 6, minServiceMonths: 240 }),
];
/** A lender that asks beyond its terms: three conditions the system measures, and two only a person can answer. */
const asking: Product[] = [
  product("6", "d", {
    special: [
      { id: "1", kind: "contract", contracts: ["permanent"] },
      { id: "2", kind: "inquiries", count: 2, months: 6 },
      { id: "3", kind: "min_amount", amount: 30000 },
      { id: "4", kind: "guarantor", text: "موظف حكومي", unmet: "action" },
      { id: "5", kind: "other", text: "فحص طبي", unmet: "block" },
    ],
  }),
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
  // With lenders nobody confirmed, every one of them has to be asked first.
  analyzeClient({ file: files[0]!, record: record(report), products: catalogue.map((p) => ({ ...p, ...unconfirmed })) }),
  // A salary paid elsewhere is something for the client to do at a lender that is confirmed to want it.
  analyzeClient({ file: file({ salaryBank: "x" }), record: record(report), products: [catalogue[0]!] }),
  // A lender with conditions of its own: nothing known of the client, nobody asked yet, not met, and met.
  analyzeClient({ file: file({ contractType: null }), record: record(report), products: asking }),
  analyzeClient({ file: file({ contractType: "permanent", answers: {} }), record: record(report), products: asking }),
  analyzeClient({ file: file({ contractType: "fixed_term", answers: { "4": "unmet", "5": "unmet" } }), record: record(report), products: asking }),
  analyzeClient({ file: file({ contractType: "permanent", answers: { "4": "met", "5": "met" } }), record: record(report), products: asking }),
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
    const read = new Set<string>();
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
          for (const check of [...fit.conditions, ...fit.refusals]) {
            sentence(fitCheckText(check), `check.${check.code}`);
            seen.add(`check.${check.code}`);
          }
          // What a lender's row says, and why it is closed when it is. A line already read is not read again.
          for (const line of [...fitLines(fit), ...fitDoubtLines(fit), ...fitRefusalLines(fit)]) {
            if (read.has(line)) continue;
            read.add(line);
            sentence(line, `fit.${fit.eligibility}`);
          }
          seen.add(`fit.${fit.eligibility}`);
          // A lender in need of checking says of what, and a refusal says why.
          if (fit.eligibility === "needs_verification") expect(fitDoubtLines(fit).length, fit.product.id).toBeGreaterThan(0);
          if (fit.status === "fail") expect(fitRefusalLines(fit).length, fit.product.id).toBeGreaterThan(0);
          // Nothing a row says plainly of a lender nobody confirmed is that lender's own policy.
          if (!fit.product.terms) expect([...fit.blockers, ...fit.actions, ...fit.remarks].filter((finding) => finding.basis === "lender")).toEqual([]);
        }
      }
      for (const c of a.commitments) expect(noInstallment(c)).toBeTruthy();
      expect(INCOME_BASIS[a.income.basis]).toBeTruthy();
      const how = incomeHow(a.income);
      if (how) sentence(how, "income");
    }
    // Every gap and every step the engine has, each met at least once.
    const gaps: Gap["code"][] = ["INCOME", "TOTAL_SALARY", "INCOME_PROOF", "AGE", "SERVICE", "SALARY_BANK", "CONTRACT", "INSTALLMENT", "CARD_SHARE", "REPORT_AGE", "READING", "SUSPENSION", "TERMS", "CONSENT"];
    for (const code of gaps) expect(seen, code).toContain(`gap.${code}`);
    const steps: Step["code"][] = ["RECORD_CONSENT", "COMPLETE_FILE", "REVIEW_READING", "CONFIRM_SUSPENSION", "CREDIT", "REFRESH_REPORT", "FREE_ROOM", "VERIFY_INCOME", "CONFIRM_TERMS", "ASK_CLIENT", "APPLY"];
    for (const code of steps) expect(seen, code).toContain(`step.${code}`);
    const met = [
      "verdict.eligible.null",
      "verdict.conditional.null",
      "verdict.needs_verification.null",
      "verdict.not_eligible.null",
      "verdict.pending.null",
      "fit.eligible",
      "fit.conditional",
      "fit.needs_verification",
      "fit.not_eligible",
      "mark.file",
      "mark.record",
      "check.RECORD_OPEN",
      "check.SETTLED_UNCONFIRMED",
      "check.SETTLED_WAIT",
      // What a lender asks beyond its terms, measured or answered, and what nobody knows of it.
      "check.AMOUNT_MIN",
      "check.INQUIRIES",
      "check.INQUIRIES_UNKNOWN",
      "check.CONTRACT",
      "check.CONTRACT_MISSING",
      "check.ASKED",
      "check.ASKED_OPEN",
    ];
    for (const key of met) expect(seen, key).toContain(key);
  });

  it("names each result and says what it is", () => {
    // The four results. An analysis that cannot be read yet is in need of checking, in the same words.
    expect(ANALYSIS_VERDICT).toEqual({ eligible: "مؤهل مبدئياً", conditional: "مؤهل بشروط", not_eligible: "غير مؤهل الآن", needs_verification: "بحاجة إلى تحقق", pending: "بحاجة إلى تحقق" });
    // No result reads as a lender's yes.
    expect(DECISION_SUPPORT).toBe("هذا التحليل يدعم قرار الموظف، وليس موافقة تمويلية. القرار النهائي للجهة الممولة.");
    for (const text of [AFTER_CLEARING, noTaker(true), noTaker(false)]) sentence(text, "lenders");
    expect(AFTER_CLEARING).toContain("لا يضمن القبول");
  });

  it("says the result in a sentence", () => {
    const clean = report({ facilities: [loan({ installment: 1000, balance: 20000 })] });
    const say = (products: Product[], who: Partial<FileFacts> = {}, r = clean, toClear = 0) => strip(verdictSay(analyzeClient({ file: file(who), record: record(r), products }), toClear));

    expect(say([product("1", "a"), product("2", "b", { requiresSalaryTransfer: false }), home("3", "a")])).toBe("جهتان تقبلانه وشروطهما مؤكدة.");
    // What a lender does after a paid default is not asked of a client who never had one.
    expect(say([product("1", "a", { settledDefaultWaitMonths: null })])).toBe("جهة واحدة تقبله وشروطها مؤكدة.");
    expect(say([product("1", "a")], { salaryBank: "x" })).toBe("جهة واحدة تقبله إذا أكمل ما تشترطه.");
    expect(say([product("1", "a")], { totalSalary: 3000, basicSalary: 3000 })).toBe("لا جهة في القائمة تقبله، والمانع مؤكد.");

    // The same lenders with nothing confirmed: neither a yes nor a no is said for them.
    expect(say([product("1", "a", unconfirmed)])).toBe("جهة واحدة قد تقبله بشروطها المسجلة. لم يتأكد ذلك بعد.");
    expect(say([product("1", "a", unconfirmed), product("2", "b", unconfirmed), product("3", "c", unconfirmed)])).toBe("3 جهات قد تقبله بشروطها المسجلة. لم يتأكد ذلك بعد.");
    expect(say([product("1", "a", { ...unconfirmed, sectors: ["private"] })])).toBe("لا جهة تقبله بشروطها المسجلة، وهذه الشروط لم تؤكَّد.");
    // What SAMA's limits leave no room for is certain at every lender, whoever confirmed what.
    expect(say([product("1", "a", unconfirmed)], { totalSalary: 3000, basicSalary: 3000 })).toBe("لا جهة في القائمة تقبله، والمانع مؤكد.");
    // One confirmed lender is worth more than any number of unconfirmed ones.
    expect(say([product("1", "a", unconfirmed), product("2", "b", { requiresSalaryTransfer: false })])).toBe("جهة واحدة تقبله وشروطها مؤكدة.");

    // A yes that rests on an employee's word alone is said to be one. One paper behind any lender, and the line is not needed.
    const spoken = (terms: Product["terms"]) => Object.fromEntries(Object.entries(terms!).map(([term, standing]) => [term, { ...standing, strength: "verbal" as const }]));
    const byWord = { terms: spoken(confirmed()) };
    expect(say([product("1", "a", byWord)])).toBe("جهة واحدة تقبله وشروطها مؤكدة، على إفادة موظف لا على مستند.");
    expect(say([product("1", "a", byWord)], { salaryBank: "x" })).toBe("جهة واحدة تقبله إذا أكمل ما تشترطه، على إفادة موظف لا على مستند.");
    expect(say([product("1", "a", byWord), product("2", "b", { requiresSalaryTransfer: false })])).toBe("جهتان تقبلانه وشروطهما مؤكدة.");

    // A default that is paid: the sentence promises nothing, and less still where nobody asked the lender.
    const owing = report({ facilities: [loan({ status: "default", defaultAmount: 40000, defaultNow: 40000 })] });
    const blocked = analyzeClient({ file: file(), record: record(owing), products: [product("1", "a", { settledDefaultWaitMonths: null })] });
    expect([blocked.verdict, blocked.afterClearing]).toEqual(["not_eligible", "needs_verification"]);
    expect(strip(verdictSay(blocked, 40000))).toBe("لا جهة تقبله قبل سداد 40,000. بعده جهة واحدة قد تقبله بشروطها المسجلة. لم يتأكد ذلك بعد، والسداد لا يضمن القبول.");
    expect(strip(verdictSay(blocked, 0))).toBe("لا جهة تقبله قبل رفع ما يمنع. بعده جهة واحدة قد تقبله بشروطها المسجلة. لم يتأكد ذلك بعد، والسداد لا يضمن القبول.");
    expect(say([product("1", "a")], {}, owing, 40000)).toBe("لا جهة تقبله قبل سداد 40,000. بعده جهة واحدة تقبله وشروطها مؤكدة، والسداد لا يضمن القبول.");
    expect(say([product("1", "a", { settledDefaultWaitMonths: 12 })], {}, owing, 40000)).toBe("لا جهة تقبله قبل سداد 40,000. وبعده لا جهة في القائمة تقبله، والمانع مؤكد.");
    expect(say([product("1", "a", { ...unconfirmed, settledDefaultWaitMonths: 12 })], {}, owing, 40000)).toBe("لا جهة تقبله قبل سداد 40,000. وبعده لا جهة تقبله بشروطها المسجلة، وهذه الشروط لم تؤكَّد.");

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
    expect(strip(gapText({ kind: "unconfirmed", code: "TERMS", unverified: 3, of: 11 }))).toBe("شروط 3 من 11 منتجاً لم تؤكَّد كلها مع جهاتها.");
    expect(strip(gapText({ kind: "unconfirmed", code: "REPORT_AGE", months: 4 }))).toBe("مضى على التقرير 4 أشهر، وقد تغيّر ما فيه.");
    expect(strip(gapText({ kind: "unconfirmed", code: "READING", confidence: "medium", warnings: 2 }))).toBe("في قراءة التقرير ملاحظتان تحتاج مطابقة على الأصل.");
    expect(noInstallment({ kind: "card" })).toBe("بلا قسط في التقرير");
    expect(noInstallment({ kind: "personal" })).toBe("القسط غير مذكور");
  });

  it("words a step with what it takes and never promises a lender's yes", () => {
    const apply: Step = { code: "APPLY", kind: "personal", lender: "جهة أ", product: "منتج", amount: 177000, installment: 3422, months: 60, eligibility: "conditional", afterClearing: true, estimated: true };
    expect(stepTitle(apply)).toBe("بعد السداد: جهة أ");
    expect(strip(stepText(apply))).toBe("تمويل شخصي حتى 177,000 بقسط 3,422 لمدة 60 شهراً. تقبل بشروط مذكورة عندها. سداد التعثر لا يضمن القبول. المبلغ والهامش استرشاديان حتى يؤكَّدا.");
    const sure: Step = { ...apply, eligibility: "eligible", afterClearing: false, estimated: false };
    expect(stepTitle(sure)).toBe("قدّم إلى جهة أ");
    expect(strip(stepText(sure))).toBe("تمويل شخصي حتى 177,000 بقسط 3,422 لمدة 60 شهراً.");
    // Nobody is told to apply to a lender whose terms nobody confirmed: the step waits for the confirmation.
    const unsure: Step = { ...sure, eligibility: "needs_verification" };
    expect(stepTitle(unsure)).toBe("بعد التأكيد: جهة أ");
    expect(strip(stepText(unsure))).toBe("تمويل شخصي حتى 177,000 بقسط 3,422 لمدة 60 شهراً. الأرقام على شروطها المسجلة، ولم تؤكَّد.");
    const ask: Step = { code: "CONFIRM_TERMS", lender: "جهة أ", kinds: ["personal"], terms: ["salary", "transfer", "settled"], beforePaying: false };
    expect(stepTitle(ask)).toBe("أكّد شروط جهة أ");
    expect(stepText(ask)).toBe("تمويل شخصي. لم يؤكَّد: أدنى راتب، تحويل الراتب، بعد سداد التعثر. اسأل الجهة واحفظ مصدر جوابها قبل وعد العميل أو التقديم.");
    // Where the office would pay the client's debts first, it asks before it pays. One lender is asked once for both kinds.
    const first: Step = { ...ask, kinds: ["personal", "mortgage"], beforePaying: true };
    expect(stepTitle(first)).toBe("قبل أي سداد: أكّد شروط جهة أ");
    expect(stepText(first)).toBe("تمويل شخصي وتمويل عقاري. لم يؤكَّد: أدنى راتب، تحويل الراتب، بعد سداد التعثر. اسأل الجهة واحفظ مصدر جوابها قبل أن يُسدَّد عن العميل شيء: السداد لا يضمن القبول.");
    expect(strip(stepText({ code: "COMPLETE_FILE", missing: ["INCOME", "AGE", "SERVICE", "SALARY_BANK"] }))).toBe(
      "ينقصه: الراتب، سنة الميلاد، مدة الخدمة، بنك الراتب. ما ينقص يبقى شرطاً عند كل جهة ولا يُحسب قبولاً.",
    );
    // What only the client can answer is asked of the client, and an unanswered question is never a pass.
    const asked = { code: "ASK_CLIENT", lender: "جهة أ", questions: [{ kind: "guarantor", text: "موظف حكومي" }, { kind: "other", text: "فحص طبي" }, { kind: "collateral", text: null }], beforePaying: false } satisfies Step;
    expect(stepTitle(asked)).toBe("اسأل العميل عن شروط جهة أ");
    expect(stepText(asked)).toBe("تشترط: كفيل (موظف حكومي)، فحص طبي، ضمان أو رهن. سجّل جواب العميل عن كل شرط: ما لم يُجب عنه لا يُحسب مستوفى.");
    expect(stepTitle({ ...asked, beforePaying: true })).toBe("قبل أي سداد: اسأل العميل عن شروط جهة أ");
    expect(strip(stepText({ code: "COMPLETE_FILE", missing: ["CONTRACT"] }))).toBe("ينقصه: نوع العقد. ما ينقص يبقى شرطاً عند كل جهة ولا يُحسب قبولاً.");
    expect(gapText({ kind: "missing", code: "CONTRACT" })).toBe("نوع عقد العميل غير مدخل، وفي الجهات من تشترط نوعاً منه.");
    expect(strip(stepText({ code: "FREE_ROOM", lender: "بنك", kind: "personal", monthly: 1900 }))).toBe("لا قسط متاح اليوم. سداد بنك يحرر 1,900 في الشهر، وهو أصغر التزام رصيداً.");
  });

  it("says under a lender what is confirmed of it, what is not, and what the record only leans to", () => {
    const clean = report({ facilities: [loan({ installment: 1000, balance: 20000 })] });
    const fitsOf = (products: Product[], who: Partial<FileFacts> = {}, r = clean) => {
      const a = analyzeClient({ file: file(who), record: record(r), products });
      return (a.kinds[0]!.cleared ?? a.kinds[0]!.today).fits;
    };

    // Confirmed in writing and nothing asked of the client: the row has nothing to add.
    expect(fitLines(fitsOf([product("1", "a")])[0]!)).toEqual([]);
    // Confirmed, and the client has something to do.
    expect(fitLines(fitsOf([product("1", "a")], { salaryBank: "x" })[0]!)).toEqual(["تشترط تحويل الراتب إليها."]);
    // The same demand on a term nobody confirmed is what the record leans to, never the lender's word.
    const open = fitsOf([product("1", "a", unconfirmed)], { salaryBank: "x" })[0]!;
    expect(fitLines(open).map(strip)).toEqual(["7 شروط لم تؤكَّد.", "إن صحّ المسجل عندنا: تشترط تحويل الراتب إليها."]);
    expect(fitDoubtLines(open)).toEqual(["لم يؤكَّد: أدنى راتب، لمن يُعطى، الجنسية، حدود العمر، مدة الخدمة، تحويل الراتب، الشروط الخاصة."]);
    // An employee's word is said to be one, and an unconfirmed margin makes the figures an estimate.
    const word = product("1", "a", { terms: Object.fromEntries(Object.entries(confirmed(["rate"])!).map(([term, standing]) => [term, { ...standing, strength: "verbal" }])) });
    expect(fitLines(fitsOf([word])[0]!)).toEqual(["على إفادة موظف في الجهة، لا على مستند منها.", "المبلغ والهامش استرشاديان."]);
    // A confirmation that ran out is named as that.
    const stale = fitsOf([product("1", "a", { terms: { ...confirmed(["salary"]), ...confirmed(["sector", "nationality", "age", "service", "transfer", "late", "settled", "special", "amount", "tenor", "rate"], "2026-07-01") } })])[0]!;
    expect(fitDoubtLines(stale)).toEqual(["انتهى تأكيده: أدنى راتب."]);
    // A fact the file lacks is said in its own words and is nobody's term.
    expect(fitLines(fitsOf([product("1", "a")], { age: null })[0]!)).toEqual(["سنة الميلاد غير مدخلة."]);

    // Why a lender is closed: for certain, or only as the record reads.
    const other = { sectors: ["private" as const] };
    expect(fitRefusalLines(fitsOf([product("1", "a", other)])[0]!).map(strip)).toEqual(["المنتج لا يقبل جهة العمل (حكومي)."]);
    expect(fitRefusalLines(fitsOf([product("1", "a", { ...unconfirmed, ...other })])[0]!).map(strip)).toEqual(["إن صحّ المسجل عندنا: المنتج لا يقبل جهة العمل (حكومي)."]);
    // A debt that stands closes every lender, confirmed or not.
    const owing = report({ facilities: [loan({ status: "default", defaultAmount: 40000, defaultNow: 40000 })] });
    const today = analyzeClient({ file: file(), record: record(owing), products: [product("1", "a", unconfirmed)] }).kinds[0]!.today.fits[0]!;
    expect(fitRefusalLines(today)).toEqual(["في السجل تعثر أو قرار تنفيذ قائم، ولا تقبله قبل سداده."]);
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
