import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { alternativeText, ledgerText, NEXT_STEP, riskText, STAGE } from "@/copy/deal";
import { counted, countedInWords, dueIn, inDays, money, percent } from "@/copy/format";
import { dealAlternatives, dealStudy, STAGES } from "@/domain/deal";

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
