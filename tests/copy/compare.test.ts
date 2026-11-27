import { describe, expect, it } from "vitest";
import { COMPARE_ROW, diffText, LEVER, leverText, PRESET, scenarioText, SIDE, WHAT_IF } from "@/copy/compare";
import { COMPARE_ROWS, LEVERS, type Levers } from "@/domain/deal";

const plain = (text: string) => text.replace(/[⁦⁩]/g, "");
const wordy = /undefined|NaN|null|\[object|[A-Za-z_]{3,}|—|–/;
const all: Levers = { structure: "settle_personal", settlePct: 12, financePct: 15, financeBase: "net", discountPct: 20, bankMortgage: 750000, bankPersonal: 180000, propertyValue: 1100000 };

describe("the wording of two scenarios side by side", () => {
  it("names every row and every lever", () => {
    for (const row of COMPARE_ROWS) expect(COMPARE_ROW[row]).toMatch(/^[؀-ۿ]/);
    for (const lever of LEVERS) expect(LEVER[lever]).toMatch(/^[؀-ۿ]/);
    expect(SIDE).toEqual({ a: "الصفقة كما هي", b: "السيناريو", diff: "الفرق" });
    expect(WHAT_IF).toBe("حساب افتراضي: لا يغيّر الصفقة ولا يُعرض على العميل.");
  });

  it("signs the difference on each row, in riyals", () => {
    expect(diffText(46796)).toBe("+46,796");
    expect(diffText(-40596)).toBe("−40,596");
    expect(diffText(0)).toBe("لا فرق");
  });

  it("says what the scenario moves, in the levers' order", () => {
    expect(plain(scenarioText(["financePct", "discountPct"], all))).toBe("أتعاب التمويل 15%، خصم 20% على التنفيذ والمتعثرات");
    expect(scenarioText([], {})).toBe("مثل الصفقة، لم يتغير شيء");
    expect(leverText("structure", all)).toBe("شخصي فقط");
    expect(leverText("financeBase", all)).toBe("أتعاب التمويل على الصافي بعد التسويات");
    expect(plain(leverText("bankMortgage", all))).toBe("عرض عقاري 750,000");
    expect(plain(PRESET.discount(29))).toBe("خصم 29% يغلقها");
    expect(plain(PRESET.feeMin(10))).toBe("الأتعاب 10% على كل جزء");
    expect(PRESET.structure("settle_refi")).toBe("الهيكل: عقاري فقط");
  });

  it("never leaks a code or a dash into anything it says", () => {
    for (const lever of LEVERS) expect(leverText(lever, all), lever).not.toMatch(wordy);
    expect(scenarioText([...LEVERS], all)).not.toMatch(wordy);
  });
});
