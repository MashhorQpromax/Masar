import { describe, expect, it } from "vitest";
import { ledgerText } from "@/copy/deal";
import { BASIS, ELIGIBILITY, ELIGIBILITY_SAY, ROUTE_ERROR_CODES, ROUTE_STATUS, routeCheckText, routeDoubtCount, routeDoubtLines, routeError, routeFindingText, routeLeanLines, routeLenders, routeNoteText } from "@/copy/funding";
import { defaultDealInput, type Borrower, type DealInput } from "@/domain/deal";
import { TERMS, termStanding, type Product, type Term } from "@/domain/eligibility";
import { fundingRoutes, type FundingRoute, type RecordAfter } from "@/domain/funding";

const broken = /undefined|NaN|null|\[object|[A-Za-z_]{3,}|—|–/;
const strip = (text: string) => text.replace(/[⁦⁩]/g, "");

const product = (id: string, lender: string, parts: Partial<Product>): Product => ({
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
  sectors: ["gov"],
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
  verified: false,
  ...parts,
});
const home = (id: string, lender: string, parts: Partial<Product> = {}) =>
  product(id, lender, { financeType: "mortgage", maxAgeAtMaturity: 70, maxTenor: 300, maxAmount: 5_000_000, rate: 5, rateType: "reducing", maxLtv: 90, ...parts });

/** Every term confirmed in writing three weeks ago, except the ones left open and the ones read too long ago. */
const TODAY = "2026-11-23";
const terms = (open: Term[] = [], expired: Term[] = []): Product["terms"] =>
  Object.fromEntries(TERMS.filter((term) => !open.includes(term)).map((term) => [term, termStanding({ kind: "lender_document", reference: "نشرة المنتج", confirmedOn: expired.includes(term) ? "2026-07-01" : "2026-11-01" }, TODAY)]));

const deal: DealInput = {
  ...defaultDealInput(),
  items: [{ id: "a", kind: "execution", label: "قرار تنفيذ", original: 100000, pay: 100000, by: "company" }],
  propertyValue: 800000,
};
const people: Borrower[] = [
  { age: 35, basicSalary: 12000, totalSalary: 16000, serviceMonths: 120, sector: "gov" },
  { age: 19, basicSalary: 2000, totalSalary: 3000, serviceMonths: 1, sector: "private" },
  { age: 68, basicSalary: 9000, totalSalary: 12000, serviceMonths: 300, sector: "retired" },
  { age: null, basicSalary: null, totalSalary: null, serviceMonths: null, sector: "gov" },
];
const records: RecordAfter[] = [
  { known: true, open: false, settledMonthsAgo: null, delays: false },
  { known: false, open: false, settledMonthsAgo: 0, delays: false },
  { known: true, open: true, settledMonthsAgo: null, delays: false },
  { known: true, open: false, settledMonthsAgo: 3, delays: true },
];
const catalogues: Product[][] = [
  [product("1", "a", {}), home("2", "a"), product("3", "b", { settledDefaultWaitMonths: 12, acceptsLateSimah: true }), home("4", "b", { settledDefaultWaitMonths: null })],
  [product("1", "a", { settledDefaultWaitMonths: null }), home("2", "b", { settledDefaultWaitMonths: 12 })],
  [product("1", "a", { nationalities: ["non_saudi"], maxAmount: 50000 }), home("2", "a", { maxAmount: 200000, sectors: ["gov", "retired", "private"] })],
  // The same lenders with their terms confirmed: all of them, then some left open or read too long ago.
  [product("1", "a", { terms: terms() }), home("2", "a", { terms: terms() }), product("3", "b", { terms: terms(), settledDefaultWaitMonths: 12, acceptsLateSimah: true }), home("4", "b", { terms: terms(), settledDefaultWaitMonths: null })],
  [product("1", "a", { terms: terms(["salary", "late"], ["transfer"]) }), home("2", "b", { terms: terms(["settled"], ["sector", "age"]), sectors: ["gov", "retired"] })],
];

const every: FundingRoute[] = [];
for (const borrower of people) {
  for (const record of records) {
    for (const products of catalogues) {
      for (const salaryBank of ["a", null]) {
        for (const structure of ["settle_refi_personal", "settle_personal", "settle_refi"] as const) {
          every.push(...fundingRoutes({ input: { ...deal, structure }, borrower, who: { nationality: "saudi", salaryBank, record }, products }));
        }
      }
    }
  }
}

describe("funding wording", () => {
  it("has a sentence for every condition a route can raise", () => {
    const seen = new Set<string>();
    for (const route of every) {
      for (const leg of [route.mortgage, route.personal]) {
        for (const check of leg?.checks ?? []) {
          const text = routeCheckText(check);
          expect(strip(text), check.code).not.toMatch(broken);
          expect(text.endsWith("."), check.code).toBe(true);
          seen.add(`${check.code}:${check.status === "pass" ? "pass" : "other"}`);
        }
      }
      for (const note of [...route.conditions, ...route.refusals]) {
        const text = routeNoteText(note, route);
        expect(strip(text), note.check.code).not.toMatch(broken);
        seen.add(`${note.check.code}:other`);
      }
      expect(routeLenders(route).main.length).toBeGreaterThan(2);
      expect(ROUTE_STATUS[route.status]).toBeTruthy();
    }
    const codes = new Set([...seen].map((s) => s.split(":")[0]));
    for (const code of ["RECORD_OPEN", "RECORD_LATE", "RECORD_UNKNOWN", "RECORD_CLEAN", "SETTLED_ACCEPTED", "SETTLED_UNCONFIRMED", "SETTLED_WAIT", "TWO_SALARY_TRANSFERS", "SALARY_TRANSFER", "SECTOR", "NATIONALITY", "SALARY_MIN", "SALARY_MISSING", "AGE_MISSING", "AGE_BELOW_MIN", "AGE_OVER_MAX", "SERVICE_MIN", "SERVICE_MISSING", "SERVICE_NOT_NEEDED"]) {
      expect(codes, code).toContain(code);
    }
  });

  it("names the lender only when the route has two", () => {
    const two = every.find((r) => !r.oneLender && r.conditions.some((n) => n.check.code === "SETTLED_UNCONFIRMED"))!;
    const note = two.conditions.find((n) => n.check.code === "SETTLED_UNCONFIRMED")!;
    expect(routeNoteText(note, two)).toBe(`${note.lender}: لم نؤكد معها متى تقبل عميلاً سدّد تعثره.`);
    expect(routeNoteText(note, { oneLender: true })).toBe("لم نؤكد معها متى تقبل عميلاً سدّد تعثره.");
    expect(routeLenders(two)).toEqual({ main: two.mortgage!.product.lenderName, also: `والشخصي من ${two.personal!.product.lenderName}` });
    expect(strip(routeCheckText({ key: "simah", status: "fail", code: "SETTLED_WAIT", params: { months: 12 } }))).toBe("لا تقبل من سدّد تعثره إلا بعد مدة، والباقي منها 12 شهراً.");
    // On a deal's road the same wait is time, and is said as time: the owner decided on 2026-11-27 that it refuses no deal.
    expect(strip(routeCheckText({ key: "simah", status: "warn", code: "SETTLED_WAIT", params: { months: 12 } }))).toBe("تقبل من سدّد تعثره بعد مدة من السداد، والباقي منها 12 شهراً. تنتظرها الصفقة ولا تُرفض بها.");
  });

  it("words a lender's ceiling in the deal's ledger", () => {
    const held = every.find((r) => r.mortgage?.atCeiling && r.personal?.atCeiling)!;
    const lines = held.study.ledger.filter((l) => l.key === "ceiling" || ((l.key === "principal" || l.key === "mortgage") && l.params?.held));
    expect(lines.map((l) => `${l.section}.${l.key}`)).toEqual(["personal.ceiling", "personal.principal", "mortgage.ceiling", "mortgage.mortgage"]);
    expect(lines.map((l) => strip(ledgerText(l).label))).toEqual(["سقف جهة a للشخصي", "أصل التمويل: سقف الجهة", "سقف جهة a للعقاري", "العقاري: سقف الجهة"]);
    for (const line of lines) expect(strip(`${ledgerText(line).label} ${ledgerText(line).how ?? ""}`)).not.toMatch(/undefined|NaN|null|\[object/);
  });

  it("names the four results and who sets a condition", () => {
    expect(ELIGIBILITY).toEqual({ eligible: "مؤهل مبدئياً", conditional: "مؤهل بشروط", not_eligible: "غير مؤهل", needs_verification: "بحاجة إلى تحقق" });
    for (const text of [...Object.values(ELIGIBILITY_SAY), ...Object.values(BASIS)]) expect(text).not.toMatch(broken);
    // Final approval is the lender's: the best result still says so.
    expect(ELIGIBILITY_SAY.eligible).toContain("الموافقة النهائية للجهة");
  });

  it("says in whole sentences what stands between a route and a reliable answer", () => {
    const results = new Set<string>();
    const doubts = new Set<string>();
    for (const route of every) {
      results.add(route.eligibility);
      for (const doubt of route.doubts) doubts.add(doubt.finding.doubt!);
      const lines = routeDoubtLines(route);
      for (const line of [...lines, ...routeDoubtCount(route), ...routeLeanLines(route)]) {
        expect(strip(line), line).not.toMatch(broken);
        expect(line.endsWith("."), line).toBe(true);
      }
      // A result that asks for a check names what to check, and a result that needs none names nothing.
      if (route.eligibility === "needs_verification") expect(lines.length, route.key).toBeGreaterThan(0);
      if (route.eligibility === "eligible" || route.eligibility === "conditional") expect([...lines, ...routeLeanLines(route)], route.key).toEqual([]);
      if (route.eligibility === "not_eligible") expect(route.blockers.length, route.key).toBeGreaterThan(0);
      expect(routeDoubtCount(route).length > 0).toBe(lines.length > 0);
      // A refusal is said once: as a confirmed blocker, or as what the record leans to.
      const certain = route.blockers.map((blocker) => routeNoteText({ lender: blocker.lender, check: blocker.finding.check }, route));
      for (const lean of routeLeanLines(route)) expect(certain.map((text) => `إن صحّ المسجل عندنا: ${text}`)).not.toContain(lean);
    }
    expect([...results].sort()).toEqual(["conditional", "eligible", "needs_verification", "not_eligible"]);
    expect([...doubts].sort()).toEqual(["FACT_MISSING", "TERM_EXPIRED", "TERM_NOT_KNOWN", "TERM_UNCONFIRMED"]);
  });

  it("names the open terms of each lender once, and counts them where there is room for one line", () => {
    const gov = people[0]!;
    const clean = records[0]!;
    const one = (products: Product[], record = clean, borrower = gov, salaryBank: string | null = "a") =>
      fundingRoutes({ input: deal, borrower, who: { nationality: "saudi", salaryBank, record }, products })[0]!;

    const open = one([product("1", "a", { terms: terms(["salary", "service"]) }), home("2", "a", { terms: terms(["salary"]) })]);
    expect(routeDoubtLines(open)).toEqual(["لم يؤكَّد: أدنى راتب، مدة الخدمة."]);
    expect(routeDoubtCount(open)).toEqual(["شرطان لم يؤكَّدا."]);

    const two = one([product("1", "a", { terms: undefined, requiresSalaryTransfer: false }), home("2", "b", { terms: terms([], ["sector"]) })], clean, gov, "b");
    expect(routeDoubtLines(two)).toEqual(["جهة b: انتهى تأكيده: لمن يُعطى.", "جهة a: لم يؤكَّد: أدنى راتب، لمن يُعطى، الجنسية، حدود العمر، مدة الخدمة، الشروط الخاصة."]);
    expect(strip(routeDoubtCount(two)[0]!)).toBe("7 شروط لم تؤكَّد.");

    const paid = one([product("1", "a", { terms: terms() }), home("2", "a", { terms: terms(), settledDefaultWaitMonths: null })], { ...clean, settledMonthsAgo: 0 });
    expect(routeDoubtLines(paid)).toEqual(["لم نؤكد معها متى تقبل عميلاً سدّد تعثره."]);
    expect(routeDoubtCount(paid)).toEqual(["شرط واحد لم يؤكَّد."]);

    // What the file lacks comes first, in its own words, and is never counted as a lender's term.
    const empty = one([product("1", "a", { terms: terms(["transfer"]) }), home("2", "a", { terms: terms() })], { ...clean, known: false }, people[3]!);
    expect(routeDoubtLines(empty)).toEqual(["الراتب غير مدخل.", "سنة الميلاد غير مدخلة.", "مدة الخدمة غير مدخلة.", "لم يُقرأ تقرير سمة بعد.", "لم يؤكَّد: تحويل الراتب."]);
    expect(routeDoubtCount(empty)).toEqual(["الراتب غير مدخل.", "سنة الميلاد غير مدخلة.", "مدة الخدمة غير مدخلة.", "لم يُقرأ تقرير سمة بعد.", "شرط واحد لم يؤكَّد."]);
  });

  it("says a conflict between the file and its papers once, under no lender's name", () => {
    const gov = people[0]!;
    const clean = records[0]!;
    const one = (products: Product[], disputed: ("totalSalary" | "basicSalary" | "birthYear")[]) => fundingRoutes({ input: deal, borrower: gov, who: { nationality: "saudi", salaryBank: "a", record: clean, disputed }, products })[0]!;

    // Every term confirmed, at one lender: the conflict is all that stands in the way.
    const sure = one([product("1", "a", { terms: terms() }), home("2", "a", { terms: terms() })], ["birthYear"]);
    expect(sure.eligibility).toBe("needs_verification");
    expect(routeDoubtLines(sure)).toEqual(["تعارض في سنة الميلاد بين الملف والمستندات."]);
    expect(routeDoubtCount(sure)).toEqual(["تعارض في سنة الميلاد بين الملف والمستندات."]);
    expect(routeLeanLines(sure)).toEqual([]);

    // At two lenders it still carries no name: it is the file's, and it comes before what each lender leaves open.
    const two = one([product("1", "a", { terms: terms(["salary"]), requiresSalaryTransfer: false }), home("2", "b", { terms: terms() })], ["totalSalary", "birthYear"]);
    expect(routeDoubtLines(two)).toEqual(["تعارض في الراتب الإجمالي بين الملف والمستندات.", "تعارض في سنة الميلاد بين الملف والمستندات.", "جهة a: لم يؤكَّد: أدنى راتب."]);
    expect(routeDoubtCount(two)).toEqual(["تعارض في الراتب الإجمالي بين الملف والمستندات.", "تعارض في سنة الميلاد بين الملف والمستندات.", "شرط واحد لم يؤكَّد."]);
    for (const line of [...routeDoubtLines(two), ...routeDoubtCount(two)]) expect(line.startsWith(":")).toBe(false);
  });

  it("says a refusal on an unconfirmed term as what the record leans to, and a confirmed one as a blocker only", () => {
    const late = { ...records[0]!, delays: true };
    const routes = (products: Product[]) => fundingRoutes({ input: deal, borrower: people[0]!, who: { nationality: "saudi", salaryBank: "a", record: late }, products });

    const [unsure] = routes([product("1", "a", { terms: terms(["late"]) }), home("2", "a", { terms: terms(["late"]) })]);
    expect(unsure!.eligibility).toBe("needs_verification");
    expect(routeLeanLines(unsure!)).toEqual(["إن صحّ المسجل عندنا: في السجل تأخر سداد حديث، وهي لا تقبله."]);
    expect(routeDoubtLines(unsure!)).toEqual(["لم يؤكَّد: تأخر السداد."]);

    const [sure] = routes([product("1", "a", { terms: terms() }), home("2", "a", { terms: terms() })]);
    expect(sure!.eligibility).toBe("not_eligible");
    expect(routeLeanLines(sure!)).toEqual([]);
    expect(sure!.blockers.map((blocker) => routeCheckText(blocker.finding.check))).toEqual(["في السجل تأخر سداد حديث، وهي لا تقبله."]);
  });

  it("puts a lender's name on its own policy only, and only when the route has two lenders", () => {
    const clean = records[0]!;
    const routes = (products: Product[], record = clean) => fundingRoutes({ input: deal, borrower: people[0]!, who: { nationality: "saudi", salaryBank: "a", record }, products });

    const [two] = routes([product("1", "a", { terms: terms() }), home("2", "b", { terms: terms() })]);
    expect(two!.oneLender).toBe(false);
    // The salary goes to one lender: this is about both, so it is said of neither.
    expect(two!.blockers.map((blocker) => routeFindingText(blocker, two!))).toEqual(["الجهتان تشترطان تحويل الراتب، ولا يُحوَّل إلا إلى واحدة."]);
    expect(two!.actions.map((action) => routeFindingText(action, two!))).toEqual(["جهة b: تشترط تحويل الراتب إليها."]);
    expect(two!.actions.map((action) => routeFindingText(action, { oneLender: true }))).toEqual(["تشترط تحويل الراتب إليها."]);

    // An unpaid default stops every lender, whoever the two are.
    const [open] = routes([product("1", "a", { terms: terms(), requiresSalaryTransfer: false }), home("2", "b", { terms: terms() })], { ...clean, open: true });
    expect(open!.blockers.map((blocker) => [blocker.finding.basis, routeFindingText(blocker, open!)])).toEqual([["market", "يبقى في السجل تعثر أو قرار تنفيذ لا تسدده الصفقة."]]);

    for (const route of every) {
      for (const found of [...route.blockers, ...route.actions, ...route.remarks]) {
        const text = routeFindingText(found, route);
        expect(strip(text), found.finding.check.code).not.toMatch(broken);
        expect(text.endsWith("."), found.finding.check.code).toBe(true);
      }
    }
  });

  it("says a lender's special conditions on a route, and names the lender whose question is open", () => {
    const record = { ...records[0]!, inquiries: { m6: 1, m12: 2 } };
    const asks: Product["special"] = [
      { id: "9", kind: "guarantor", text: null, unmet: "action" },
      { id: "10", kind: "employer", text: null, unmet: "block" },
    ];
    const one = (products: Product[], who: { answers?: Record<string, "met" | "unmet">; contractType?: "permanent" | null; record?: RecordAfter } = {}) =>
      fundingRoutes({ input: deal, borrower: people[0]!, who: { nationality: "saudi", salaryBank: "a", record, contractType: "permanent", answers: {}, ...who }, products })[0]!;
    const asked = [product("1", "a", { terms: terms(), requiresSalaryTransfer: false, special: asks }), home("2", "b", { terms: terms() })];

    // Nobody asked the client: a question of one lender, so the line says whose it is.
    const open = one(asked);
    expect(open.eligibility).toBe("needs_verification");
    expect(routeDoubtLines(open)).toEqual(["جهة a: لم يُجب بعد عن شرط الجهة: كفيل.", "جهة a: لم يُجب بعد عن شرط الجهة: جهة عمل معتمدة عندها."]);
    const alone = one([product("1", "a", { terms: terms(), special: asks }), home("2", "a", { terms: terms() })]);
    expect(routeDoubtLines(alone)).toEqual(["لم يُجب بعد عن شرط الجهة: كفيل.", "لم يُجب بعد عن شرط الجهة: جهة عمل معتمدة عندها."]);

    // The client does not meet them: one the lender asks for, one it refuses for.
    const unmet = one(asked, { answers: { "9": "unmet", "10": "unmet" } });
    expect(unmet.eligibility).toBe("not_eligible");
    expect(unmet.blockers.map((blocker) => routeFindingText(blocker, unmet))).toEqual(["جهة a: العميل لا يستوفي شرط الجهة: جهة عمل معتمدة عندها."]);
    expect(unmet.actions.map((action) => routeFindingText(action, unmet))).toContain("جهة a: تشترط الجهة ولم يستوفه العميل بعد: كفيل.");
    expect(one(asked, { answers: { "9": "met", "10": "met" } }).eligibility).toBe("conditional");

    // What the system measures itself, against the record and the file.
    const measured = [
      product("1", "a", {
        terms: terms(),
        requiresSalaryTransfer: false,
        special: [
          { id: "1", kind: "inquiries", count: 0, months: 6 },
          { id: "2", kind: "contract", contracts: ["fixed_term"] },
          { id: "3", kind: "min_amount", amount: 5_000_000 },
        ],
      }),
      home("2", "b", { terms: terms() }),
    ];
    const refused = one(measured);
    expect(refused.blockers.map((blocker) => strip(routeFindingText(blocker, refused)).replace(/[0-9,]+\.$/, "X."))).toEqual([
      "جهة a: في السجل استعلام واحد في آخر 6 أشهر، والجهة لا تقبل أي استعلام.",
      "جهة a: الجهة لا تقبل نوع العقد (دائم).",
      "جهة a: أدنى تمويل عند الجهة 5,000,000، والمتاح للعميل X.",
    ]);
    // What nobody knows about the client is a fact to find, said of no lender, and never a pass.
    const blank = one(measured.map((p) => ({ ...p, special: p.special?.slice(0, 2) })), { contractType: null, record: { ...record, inquiries: null } });
    expect(blank.eligibility).toBe("needs_verification");
    expect(routeDoubtLines(blank)).toEqual(["عدد الاستعلامات في سمة غير معروف.", "نوع عقد العميل غير مدخل."]);

    for (const route of [open, alone, unmet, refused, blank]) {
      for (const line of [...routeDoubtLines(route), ...routeDoubtCount(route), ...[...route.blockers, ...route.actions, ...route.remarks].map((found) => routeFindingText(found, route))]) {
        expect(strip(line)).not.toMatch(broken);
        expect(line.endsWith(".")).toBe(true);
      }
    }
  });

  it("has a sentence for every refusal to apply a route", () => {
    for (const code of ROUTE_ERROR_CODES) expect(strip(routeError(code))).not.toMatch(broken);
    expect(routeError("SOMETHING_ELSE")).toBe("تعذر الحفظ. حاول مرة أخرى.");
  });
});
