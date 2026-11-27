import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AFTER_WAIT, alternativeText, glance, ledgerText, mortgageFirstText, NEXT_STEP, riskText, roadText, STAGE, waitText, withinRoad, yearlyText } from "@/copy/deal";
import { counted, countedInWords, dueIn, inDays, money, percent } from "@/copy/format";
import { dealAlternatives, dealStudy, dealWait, mortgageFirst, STAGES, type DealWait } from "@/domain/deal";

const golden = JSON.parse(readFileSync(new URL("../golden/deal.json", import.meta.url), "utf8"));
const cases: { input: never; borrower: never; credit: never }[] = golden.cases;
const broken = /undefined|NaN|null|\[object/;
const strip = (text: string) => text.replace(/[⁦⁩]/g, "");

describe("deal wording", () => {
  it("has a sentence for every risk and every ledger line the engine produces", () => {
    const seenRisks = new Set<string>();
    const seenLines = new Set<string>();
    for (const c of cases) {
      const study = dealStudy(c.input, c.borrower, c.credit);
      for (const risk of study.risks) {
        const text = riskText(risk);
        expect(text.length, risk.code).toBeGreaterThan(10);
        expect(text, risk.code).not.toMatch(broken);
        seenRisks.add(risk.code);
      }
      for (const line of study.ledger) {
        const { label, how } = ledgerText(line);
        expect(label, `${line.section}.${line.key}`).not.toBe(line.key);
        expect(`${label} ${how ?? ""}`, `${line.section}.${line.key}`).not.toMatch(broken);
        seenLines.add(`${line.section}.${line.key}`);
      }
    }
    expect(seenRisks.size).toBeGreaterThanOrEqual(20);
    expect(seenLines.size).toBeGreaterThanOrEqual(25);
  });

  it("has a sentence for every alternative", () => {
    const seen = new Set<string>();
    for (const c of cases.slice(0, 90)) {
      for (const alt of dealAlternatives(c.input, c.borrower, c.credit)) {
        const { title, detail } = alternativeText(alt);
        expect(`${title} ${detail}`, alt.code).not.toMatch(broken);
        expect(title.length, alt.code).toBeGreaterThan(8);
        seen.add(alt.code);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(8);
  });

  it("says the mortgage first as a way, with what it raises and that a bank must write it", () => {
    const closes = mortgageFirstText({ closes: true, mortgage: 1350000, personal: 110035, mortgageNow: 825127, personalNow: 278243, clientNet: 248931, installment: 8291, installmentPct: 52 });
    expect(closes.title).toBe("العقاري أولاً يغلقها");
    expect(strip(closes.detail)).toBe(
      "عقاري 1,350,000 وشخصي 110,035 بدل 825,127 و278,243. يبقى للعميل 248,931 ريال، وقسط العقاري 52% من الراتب. تقدير حتى يكتبه البنك: اطلب منه هذا التقسيم وسجّل عرضه.",
    );
    const short = mortgageFirstText({ closes: false, mortgage: 1350000, personal: 110035, mortgageNow: 825127, personalNow: 278243, clientNet: -351069, installment: 8291, installmentPct: 52 });
    expect(short.title).toBe("العقاري أولاً يقلّص العجز ولا يغلقها");
    expect(strip(short.detail)).toBe("عقاري 1,350,000 وشخصي 110,035 بدل 825,127 و278,243. يبقى عجز 351,069 ريال.");

    let ways = 0;
    for (const c of cases) {
      const way = mortgageFirst(c.input, c.borrower, c.credit);
      if (!way) continue;
      ways += 1;
      const { title, detail } = mortgageFirstText(way);
      expect(`${title} ${detail}`).not.toMatch(broken);
      // Its own ledger explains the order it was counted in.
      const lines = dealStudy(c.input, c.borrower, c.credit, "mortgage").ledger.map((line) => ({ key: `${line.section}.${line.key}`, ...ledgerText(line) }));
      expect(lines.find((line) => line.key === "mortgage.available_installment")?.how).toContain("العقاري أولاً");
      expect(lines.find((line) => line.key === "personal.max_installment")?.how).toContain("بعد القسط العقاري");
      for (const line of lines) expect(`${line.label} ${line.how ?? ""}`, line.key).not.toMatch(broken);
    }
    expect(ways).toBeGreaterThan(0);
  });

  it("names every stage and its next step", () => {
    for (const [stage] of STAGES) {
      expect(STAGE[stage]).toBeTruthy();
      if (stage !== "closed" && stage !== "lost") expect(NEXT_STEP[stage]?.title).toBeTruthy();
    }
  });
});

describe("numbers and counts in Arabic", () => {
  it("keeps numbers left to right inside a sentence", () => {
    expect(money(1284000)).toBe("⁦1,284,000⁩");
    expect(strip(money(-48000.4))).toBe("\u221248,000");
    expect(strip(percent(24))).toBe("24%");
    expect(strip(percent(33.8))).toBe("33.8%");
  });

  it("agrees the noun with the count", () => {
    const deals = { one: "صفقة واحدة", two: "صفقتان", few: "صفقات", many: "صفقة" };
    expect(countedInWords(1, deals)).toBe("صفقة واحدة");
    expect(countedInWords(2, deals)).toBe("صفقتان");
    expect(countedInWords(4, deals)).toBe("أربع صفقات");
    expect(countedInWords(10, deals)).toBe("عشر صفقات");
    expect(countedInWords(12, deals)).toBe("12 صفقة");
    expect(counted(3, deals)).toBe("3 صفقات");
  });

  it("says when", () => {
    expect(inDays(0)).toBe("اليوم");
    expect(inDays(1)).toBe("غداً");
    expect(inDays(2)).toBe("بعد يومين");
    expect(inDays(9)).toBe("بعد 9 أيام");
    expect(inDays(12)).toBe("بعد 12 يوماً");
    expect(dueIn(2)).toBe("خلال يومين");
    expect(dueIn(1)).toBe("خلال يوم");
    expect(dueIn(0)).toBe("اليوم");
    expect(dueIn(-3)).toBe("متأخر 3 أيام");
  });
});

/**
 * The wait after a paid default, as a deal's page says it: how long and on whose word, what it does to
 * the road, the money out through it, and when it ends.
 */
describe("the wording of the wait after a paid default", () => {
  const wait = (over: Partial<DealWait> = {}): DealWait => ({
    months: { from: 6, to: 12 },
    basis: "market",
    lenders: [],
    days: { from: 230, to: 412 },
    annualized: { low: 17.7, high: 31.7 },
    exposed: 140000,
    ...over,
  });
  const ends = { from: new Date("2027-04-09T09:00:00Z"), to: new Date("2027-10-08T09:00:00Z") };

  it("says a road as one figure or as its shortest and longest", () => {
    expect(strip(roadText({ from: 62, to: 62 }))).toBe("62 يوماً");
    expect(strip(roadText({ from: 230, to: 412 }))).toBe("من 230 إلى 412 يوماً");
    expect(strip(withinRoad({ from: 62, to: 62 }))).toBe("في 62 يوماً");
    expect(strip(withinRoad({ from: 230, to: 412 }))).toBe("خلال 230 إلى 412 يوماً");
    expect(strip(yearlyText({ low: 31.7, high: 31.7 }))).toBe("سنوياً 31.7%");
    expect(strip(yearlyText({ low: 17.7, high: 31.7 }))).toBe("سنوياً من 17.7% إلى 31.7%");
  });

  it("says the market's practice, the longer road, the money out, and to ask the lender before paying", () => {
    expect(strip(waitText(wait(), 62, null))).toBe(
      "بعد سداد التعثر تنتظر جهات التمويل من 6 إلى 12 شهراً قبل أي تمويل جديد. تصير مدة الصفقة من 230 إلى 412 يوماً بدل 62، ويبقى ما ندفعه للتعثرات وقرارات التنفيذ (140,000 ريال) خارجاً طوالها. مهلة جهة هذه الصفقة لم تُؤكد: اسألها قبل السداد.",
    );
  });

  it("says when the wait ends once the defaults were paid", () => {
    const text = strip(waitText(wait(), 62, ends));
    expect(text).toContain("تنتهي المهلة بين 9 أبريل 2027 و8 أكتوبر 2027.");
    // Paid already: nothing is left to ask before paying.
    expect(text.endsWith("مهلة جهة هذه الصفقة لم تُؤكد.")).toBe(true);
    expect(text).not.toContain("قبل السداد");
  });

  it("names the lender and its months when its own term is confirmed", () => {
    const year = wait({ months: { from: 12, to: 12 }, basis: "lender", lenders: ["المثال للتمويل"], days: { from: 412, to: 412 }, exposed: 0 });
    expect(strip(waitText(year, 62, null))).toBe("مهلة المثال للتمويل بعد سداد التعثر 12 شهراً، وهي مؤكدة. تصير مدة الصفقة 412 يوماً بدل 62.");
    expect(strip(waitText(year, 62, { from: ends.to, to: ends.to }))).toContain("تنتهي المهلة 8 أكتوبر 2027.");
    const two = wait({ months: { from: 3, to: 3 }, basis: "lender", lenders: ["بنك أ", "شركة ب"], days: { from: 138, to: 138 } });
    expect(strip(waitText(two, 62, null))).toContain("مهلة بنك أ وشركة ب بعد سداد التعثر 3 أشهر، وهي مؤكدة.");
  });

  it("says there is nothing to wait for when the lender confirmed it takes the client at once", () => {
    const none = wait({ months: { from: 0, to: 0 }, basis: "lender", lenders: ["بنك المثال"], days: { from: 62, to: 62 } });
    expect(waitText(none, 62, null)).toBe("بنك المثال: القبول بعد سداد التعثر مباشرة، وهذا مؤكد. لا مهلة تُضاف إلى مدة الصفقة.");
  });

  it("says a deal that went on before the wait ended is counted without it", () => {
    const text = strip(waitText(wait(), 62, ends, true));
    expect(text).toBe(
      "بعد سداد التعثر تنتظر جهات التمويل من 6 إلى 12 شهراً قبل أي تمويل جديد. الصفقة مضت في طريقها قبل انتهاء المهلة، فمدتها محسوبة دونها. تنتهي المهلة بين 9 أبريل 2027 و8 أكتوبر 2027. مهلة جهة هذه الصفقة لم تُؤكد.",
    );
  });

  it("says on the road that a step waits, where a deal stands still until the wait ends", () => {
    const deal = { stage: "payoff" as const, verdict: "go" as const, clientNet: 400000, daysToDisbursement: 196, stageDueInDays: 169 };
    expect(strip(glance(deal, false).text)).toBe("خطاب المخالصة، خلال 169 يوماً");
    expect(strip(glance({ ...deal, held: true }, false).text)).toBe("خطاب المخالصة بعد المهلة، خلال 169 يوماً");
    expect(glance({ ...deal, held: true }, false).tone).toBe("plain");
    // What is louder stays louder: a deal that does not close is said as that.
    expect(glance({ ...deal, held: true, verdict: "short", clientNet: -5000 }, false).tone).toBe("bad");
    expect(AFTER_WAIT).toBe("بعد انتهاء مهلة ما بعد سداد التعثر");
  });

  it("is a whole sentence for every deal of the golden set that pays a default", () => {
    let seen = 0;
    for (const c of cases) {
      const study = dealStudy(c.input, c.borrower, c.credit);
      const found = dealWait(c.input, study);
      if (!found) continue;
      seen += 1;
      for (const text of [waitText(found, study.days, null), waitText(found, study.days, ends), waitText(found, study.days, ends, true)]) {
        expect(text).not.toMatch(broken);
        expect(text).not.toMatch(/—|–/);
        expect(text.endsWith(".")).toBe(true);
      }
      if (found.annualized) expect(yearlyText(found.annualized)).not.toMatch(broken);
    }
    expect(seen).toBeGreaterThan(100);
  });
});
