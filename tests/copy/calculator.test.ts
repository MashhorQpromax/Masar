import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { afterRetirementText, heldByText, largestOfferText, othersText, QUICK_VERDICT, RECORD_STANDING, refusingText, stepsDownText, takingText, upToText } from "@/copy/calculator";
import { advise, largestOffer, QUICK_DEFAULTS, quickProfile, quickVerdict, type Product, type QuickFacts } from "@/domain/eligibility";

const catalogue = (JSON.parse(readFileSync(new URL("../golden/advisor.json", import.meta.url), "utf8")) as { catalogue: Product[] }).catalogue;
const broken = /undefined|NaN|null|\[object|—/;
const strip = (text: string) => text.replace(/[⁦⁩]/g, "");
const answer = (change: Partial<QuickFacts> = {}) => advise(quickProfile({ ...QUICK_DEFAULTS, ...change }), catalogue);

describe("the calculator's wording", () => {
  it("names every standing of a record and every verdict", () => {
    expect(Object.keys(RECORD_STANDING).sort()).toEqual(["clean", "default", "late", "unknown"]);
    expect(Object.keys(QUICK_VERDICT).sort()).toEqual(["conditional", "eligible", "not_eligible"]);
    for (const word of [...Object.values(RECORD_STANDING), ...Object.values(QUICK_VERDICT)]) expect(word.endsWith(".")).toBe(false);
  });

  it("counts lenders the way Arabic counts", () => {
    expect(takingText(0)).toBe("لا جهة تقبل بهذه الأرقام");
    expect(takingText(1)).toBe("جهة واحدة تقبل");
    expect(takingText(2)).toBe("جهتان تقبلان");
    expect(takingText(7)).toBe("7 جهات تقبل");
    expect(takingText(11)).toBe("11 جهة تقبل");
    expect(othersText(3)).toBe("3 جهات أخرى تقبل");
    expect(refusingText(1)).toBe("جهة لا تقبل الآن");
    expect(refusingText(4)).toBe("4 جهات لا تقبل الآن");
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

  it("gives a verdict from who takes the client, never from what was not asked", () => {
    expect(quickVerdict(answer())).toBe("eligible");
    expect(answer().verdict).toBe("eligible");
    // With the age left empty the file would wait for facts. The estimate still answers.
    const noAge = answer({ age: null, serviceMonths: null });
    expect(noAge.verdict).toBe("pending");
    expect(["eligible", "conditional", "not_eligible"]).toContain(quickVerdict(noAge));
    expect(quickVerdict(answer({ simah: "default" }))).toBe("not_eligible");
    expect(largestOffer(answer({ simah: "default" }))).toBeNull();
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
