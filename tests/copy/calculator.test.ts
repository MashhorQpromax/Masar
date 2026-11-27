import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { afterRetirementText, heldByText, largestOfferText, othersText, QUICK_VERDICT, RECORD_STANDING, refusingText, stepsDownText, takingText, upToText, WAYS_BASIS } from "@/copy/calculator";
import { checkText } from "@/copy/eligibility";
import { strictLines, strictRefusalLines } from "@/copy/funding";
import { advise, largestOffer, openOffers, QUICK_DEFAULTS, quickProfile, quickVerdict, strictMatch, TERMS, termStanding, type Product, type QuickFacts } from "@/domain/eligibility";

// The golden catalogue carries no sources: it reads as lenders nobody confirmed.
const catalogue = (JSON.parse(readFileSync(new URL("../golden/advisor.json", import.meta.url), "utf8")) as { catalogue: Product[] }).catalogue;
const confirmed: Product["terms"] = Object.fromEntries(TERMS.map((term) => [term, termStanding({ kind: "lender_document", reference: "نشرة المنتج", confirmedOn: "2026-11-01" }, "2026-11-23")]));
const sure = catalogue.map((product): Product => ({ ...product, terms: confirmed }));
const broken = /undefined|NaN|null|\[object|—/;
const strip = (text: string) => text.replace(/[⁦⁩]/g, "");
const answer = (change: Partial<QuickFacts> = {}) => advise(quickProfile({ ...QUICK_DEFAULTS, ...change }), catalogue);

describe("the calculator's wording", () => {
  it("names every standing of a record and every verdict", () => {
    expect(Object.keys(RECORD_STANDING).sort()).toEqual(["clean", "default", "late", "unknown"]);
    // The same four results a file gets, in the same words.
    expect(QUICK_VERDICT).toEqual({ eligible: "مؤهل مبدئياً", conditional: "مؤهل بشروط", not_eligible: "غير مؤهل الآن", needs_verification: "بحاجة إلى تحقق" });
    for (const word of [...Object.values(RECORD_STANDING), ...Object.values(QUICK_VERDICT)]) expect(word.endsWith(".")).toBe(false);
  });

  it("counts lenders the way Arabic counts", () => {
    expect(takingText(0)).toBe("لا جهة تقبل بهذه الأرقام");
    // The lists go by what the recorded terms say, and say so. Each row says whether its lender confirmed them.
    expect(takingText(1)).toBe("جهة واحدة تقبل بشروطها المسجلة");
    expect(takingText(2)).toBe("جهتان تقبلان بشروطهما المسجلة");
    expect(strip(takingText(7))).toBe("7 جهات تقبل بشروطها المسجلة");
    expect(strip(takingText(11))).toBe("11 جهة تقبل بشروطها المسجلة");
    expect(strip(othersText(3))).toBe("3 جهات أخرى");
    expect(refusingText(1)).toBe("جهة لا تقبل بشروطها المسجلة");
    expect(strip(refusingText(4))).toBe("4 جهات لا تقبل بشروطها المسجلة");
    expect(WAYS_BASIS).not.toMatch(broken);
    expect(WAYS_BASIS.endsWith(".")).toBe(true);
  });

  it("says where the largest amount is and what it costs every month", () => {
    const study = answer();
    const top = largestOffer(study)!;
    expect(top.maxPrincipal).toBe(study.bestAmount);
    const said = largestOfferText(top);
    expect(said).not.toMatch(broken);
    expect(said.endsWith(".")).toBe(true);
    expect(strip(said)).toBe(`عند ${top.product.lenderName}، بقسط ${top.installment.toLocaleString("en-US")} لمدة ${top.tenor} شهراً.`);
    // The digits are isolated, so they read left to right inside the sentence.
    expect(said).toContain("⁦");
  });

  it("says the installment is the one of the amount asked for, when less than the most was asked", () => {
    const study = answer({ requestedAmount: 50000 });
    const top = largestOffer(study)!;
    expect(top.offerPrincipal).toBe(50000);
    expect(top.maxPrincipal).toBeGreaterThan(50000);
    expect(strip(largestOfferText(top))).toBe(`عند ${top.product.lenderName}. المطلوب 50,000 بقسط ${top.installment.toLocaleString("en-US")} لمدة ${top.tenor} شهراً.`);
    expect(strip(upToText(top.maxPrincipal))).toBe(`حتى ${top.maxPrincipal.toLocaleString("en-US")}`);
  });

  it("names the rule that holds the installment for a salary, a pension and a mortgage", () => {
    expect(heldByText(answer().capacity)).toBe("القسط الجديد يحكمه حد ثلث الراتب.");
    expect(heldByText(answer({ sector: "retired", age: 62 }).capacity)).toBe("القسط الجديد يحكمه حد ربع المعاش.");
    const mortgage = strip(heldByText(answer({ financeType: "mortgage" }).capacity));
    expect(mortgage).toBe("القسط الجديد يحكمه السقف الكلي 55% من الدخل شاملاً العقاري.");
  });

  it("gives one of the four results, and never a yes on terms nobody confirmed", () => {
    const on = (products: Product[], change: Partial<QuickFacts> = {}) => advise(quickProfile({ ...QUICK_DEFAULTS, ...change }), products);
    // As written the lenders take the client. Nobody confirmed that they do.
    expect(answer().verdict).toBe("eligible");
    expect(quickVerdict(answer())).toBe("needs_verification");
    // A standing default refuses at every lender, and no lender has to confirm that.
    expect(quickVerdict(answer({ simah: "default" }))).toBe("not_eligible");
    expect(largestOffer(answer({ simah: "default" }))).toBeNull();

    // With the terms confirmed the estimate can say more. No salary bank is asked, so a lender that wants the salary is a condition.
    expect(quickVerdict(on(sure))).toBe(sure.some((product) => product.financeType === "personal" && !product.requiresSalaryTransfer) ? "eligible" : "conditional");
    expect(quickVerdict(on(sure, { simah: "default" }))).toBe("not_eligible");
    // What was not typed is never taken as met.
    expect(quickVerdict(on(sure, { age: null, serviceMonths: null }))).toBe("needs_verification");
    expect(quickVerdict(on(sure, { simah: "unknown" }))).toBe("needs_verification");
  });

  it("names a lender whose terms are confirmed before one that reads better and is not", () => {
    const personal = catalogue.filter((product) => product.financeType === "personal");
    const open = advise(quickProfile(QUICK_DEFAULTS), personal);
    const largest = largestOffer(open)!;
    // Confirm one other lender's terms: it becomes the one the estimate names, though it lends less.
    const other = openOffers(open).find((match) => match.product.lenderId !== largest.product.lenderId && match.maxPrincipal < largest.maxPrincipal)!;
    const mixed = advise(
      quickProfile(QUICK_DEFAULTS),
      personal.map((product): Product => (product.id === other.product.id ? { ...product, terms: confirmed } : product)),
    );
    const named = largestOffer(mixed)!;
    expect(named.product.id).toBe(other.product.id);
    expect(named.maxPrincipal).toBeLessThan(mixed.bestAmount);
    expect(["eligible", "conditional"]).toContain(strictMatch(named).eligibility);
    expect(quickVerdict(mixed)).toBe(strictMatch(named).eligibility);
    expect(openOffers(mixed)[0]).toBe(named);
    expect(openOffers(mixed)).toHaveLength(openOffers(open).length);
  });

  it("says under each lender what is confirmed of it and what is not", () => {
    const lines = (products: Product[], change: Partial<QuickFacts> = {}) =>
      advise(quickProfile({ ...QUICK_DEFAULTS, ...change }), products).matches.map((match) => ({ match, read: strictMatch(match) }));
    for (const products of [catalogue, sure]) {
      for (const change of [{}, { simah: "late" }, { simah: "default" }, { age: 58 }, { totalSalary: 3500 }, { sector: "private" }] as Partial<QuickFacts>[]) {
        for (const { match, read } of lines(products, change)) {
          for (const line of [...strictLines(read, checkText), ...strictRefusalLines(read, checkText)]) {
            expect(strip(line), line).not.toMatch(/undefined|NaN|null|\[object|[A-Za-z_]{3,}|—/);
            expect(line.endsWith("."), line).toBe(true);
          }
          // A lender that refuses says why, and one nobody confirmed never says it in its own name.
          if (match.verdict === "fail") expect(strictRefusalLines(read, checkText).length, match.product.id).toBeGreaterThan(0);
          if (products === catalogue) expect([...read.blockers, ...read.actions, ...read.remarks].filter((finding) => finding.basis === "lender")).toEqual([]);
          if (products === catalogue && match.verdict !== "fail") expect(strip(strictLines(read, checkText)[0]!)).toMatch(/لم يؤكَّد|لم تؤكَّد/);
        }
      }
    }
  });

  it("names the step down after retirement in a few words, beside a row that shows the figure", () => {
    expect(stepsDownText(96)).toBe("يتقاعد بعد 96 شهراً، وينزل القسط بعدها.");
    expect(stepsDownText(2)).toBe("يتقاعد بعد شهرين، وينزل القسط بعدها.");
  });

  it("keeps a figure's caption free of a full stop", () => {
    expect(strip(afterRetirementText(1271))).toBe("بعد التقاعد 1,271");
    expect(afterRetirementText(1271).endsWith(".")).toBe(false);
  });
});
