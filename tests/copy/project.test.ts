import { describe, expect, it } from "vitest";
import { amountParts, millions, plainMillions } from "@/copy/format";
import {
  ALERT_LEVEL,
  alertDetail,
  alertExit,
  alertTitle,
  BORROWER_TYPE,
  criticalGaps,
  DEED,
  DEED_FACT,
  FIT,
  GAP_STANDING,
  gapLabel,
  gapWhy,
  HELD_SAY,
  incomeSteps,
  PAPERS_CLOSE_GAPS,
  PROJECT_ERROR_CODES,
  PROJECT_TYPE,
  PROJECT_VERDICT,
  PROJECT_VERDICT_SHORT,
  projectError,
  projectLine,
  PURPOSE,
  PURPOSE_FACT,
  ratioLines,
  reachSay,
  REJECTED_PROJECT,
  REJECTED_PROJECT_SAY,
  structureAsk,
  structureHow,
  structureNeeds,
  structureTitle,
  verdictSay,
} from "@/copy/project";
import {
  ALERT_CODES,
  BORROWER_TYPES,
  DEEDS,
  EMPTY_PROJECT,
  GAP_CODES,
  PROJECT_TYPES,
  PROJECT_VERDICTS,
  projectStudy,
  PURPOSES,
  STRUCTURE_IDS,
  type ProjectAlert,
  type ProjectFacts,
} from "@/domain/project";

const broken = /undefined|NaN|null|\[object|[A-Za-z_]{3,}|—|–/;
const strip = (text: string) => text.replace(/[⁦⁩]/g, "");
/** What is left of a text once every isolated run is taken out. */
const outside = (text: string) => text.replace(/⁦[^⁩]*⁩/g, "");

/** Arabic from its first word. A number may come first, in its own run. */
const ARABIC = /^(⁦[^⁩]+⁩ )?[؀-ۿ]/;

/** A label: Arabic, whole, and with no full stop. */
const label = (text: string, about: string) => {
  expect(text, about).toMatch(ARABIC);
  expect(text, about).not.toMatch(broken);
  expect(text.endsWith("."), about).toBe(false);
};
/** A sentence: Arabic, whole, ended, and with every sign and percent mark inside its own number. */
const sentence = (text: string, about: string) => {
  expect(text, about).toMatch(ARABIC);
  expect(text, about).not.toMatch(broken);
  expect(text.endsWith("."), about).toBe(true);
  expect(outside(text), about).not.toMatch(/[%−]|\d,\d/);
};

/** A hotel on land its owner holds, asking for more than the build costs. Every figure is made up. */
const HOTEL: ProjectFacts = {
  ...EMPTY_PROJECT,
  borrowerType: "individual",
  city: "جدة",
  district: "أبحر الشمالية",
  landArea: 4800,
  landValue: 96_000_000,
  valuer: "مكتب تقييم معتمد",
  deed: "registered",
  projectType: "hotel",
  purpose: "build_cashout",
  constructionCost: 62_000_000,
  gfa: 21_500,
  keys: 180,
  adr: 420,
  occupancy: 64,
  equityCash: 6_000_000,
  hasFeasibility: true,
  hasPermit: true,
};

/** One alert of every kind, and both ways the two that depend on a missing fact are said. */
const ALERTS: ProjectAlert[] = [
  { code: "DEED_UNREGISTERED", level: "block", deed: "paper" },
  { code: "DEED_UNREGISTERED", level: "block", deed: null },
  { code: "NEAR_HARAM", level: "warn" },
  { code: "INDIVIDUAL_BORROWER", level: "warn", known: true },
  { code: "INDIVIDUAL_BORROWER", level: "warn", known: false },
  { code: "HIGH_LAND_PRICE", level: "warn", pricePerM2: 120_000 },
  { code: "CASH_ABOVE_LAND_LIMIT", level: "warn", ltv: 68.8 },
  { code: "ABOVE_BUILD_COST", level: "info", amount: 4_000_000 },
  { code: "EXISTING_LIEN", level: "warn" },
  { code: "LOW_COVER", level: "warn", dscr: 0.86 },
];

describe("the names a project's study uses", () => {
  it("names every kind, purpose, deed, fit, level and answer in Arabic, with no full stop", () => {
    for (const type of PROJECT_TYPES) label(PROJECT_TYPE[type], type);
    for (const who of BORROWER_TYPES) label(BORROWER_TYPE[who], who);
    for (const deed of DEEDS) {
      label(DEED[deed], deed);
      label(DEED_FACT[deed], deed);
    }
    for (const purpose of PURPOSES) {
      label(PURPOSE[purpose], purpose);
      label(PURPOSE_FACT[purpose], purpose);
    }
    for (const fit of ["high", "medium", "low"] as const) label(FIT[fit], fit);
    for (const level of ["block", "warn", "info"] as const) label(ALERT_LEVEL[level], level);
    for (const verdict of PROJECT_VERDICTS) {
      label(PROJECT_VERDICT[verdict], verdict);
      label(PROJECT_VERDICT_SHORT[verdict], verdict);
      // The short form is the one a row in a list has room for.
      expect(PROJECT_VERDICT_SHORT[verdict].length, verdict).toBeLessThanOrEqual(PROJECT_VERDICT[verdict].length);
    }
    expect(new Set(PROJECT_VERDICTS.map((verdict) => PROJECT_VERDICT[verdict])).size).toBe(PROJECT_VERDICTS.length);
    expect(new Set(PROJECT_VERDICTS.map((verdict) => PROJECT_VERDICT_SHORT[verdict])).size).toBe(PROJECT_VERDICTS.length);
    expect(new Set(DEEDS.map((deed) => DEED[deed])).size).toBe(DEEDS.length);
    expect(new Set(PURPOSES.map((purpose) => PURPOSE[purpose])).size).toBe(PURPOSES.length);
  });

  it("says a project in a line, and says nothing when nothing is known", () => {
    expect(projectLine(HOTEL)).toBe("فندق في أبحر الشمالية، جدة");
    expect(projectLine({ projectType: "residential", city: "الرياض", district: null })).toBe("مشروع سكني في الرياض");
    expect(projectLine({ projectType: "mixed", city: null, district: null })).toBe("مشروع متعدد الاستخدام");
    expect(projectLine({ projectType: null, city: "الدمام", district: null })).toBe("مشروع في الدمام");
    expect(projectLine({ projectType: null, city: null, district: null })).toBe("");
  });
});

describe("what the study answers", () => {
  it("explains every answer in sentences that end", () => {
    for (const verdict of PROJECT_VERDICTS) {
      const gaps = [1, 2, 3, 4, 5].map(() => ({ code: "STATEMENTS" as const, critical: true }));
      sentence(verdictSay({ verdict, gaps }), verdict);
    }
    expect(new Set(PROJECT_VERDICTS.map((verdict) => verdictSay({ verdict, gaps: [] }))).size).toBe(PROJECT_VERDICTS.length);
  });

  it("counts what holds the answer back the way Arabic counts, and only what is critical", () => {
    const gaps = (critical: number, other = 2) => [...Array.from({ length: critical }, () => ({ code: "STATEMENTS" as const, critical: true })), ...Array.from({ length: other }, () => ({ code: "OPERATOR_LETTER" as const, critical: false }))];
    expect(criticalGaps({ gaps: gaps(3) })).toBe(3);
    expect(verdictSay({ verdict: "needs_info", gaps: gaps(1) })).toContain("ينقصه أمر أساسي واحد.");
    expect(verdictSay({ verdict: "needs_info", gaps: gaps(2) })).toContain("ينقصه أمران أساسيان.");
    expect(verdictSay({ verdict: "needs_info", gaps: gaps(5) })).toContain("ينقصه 5 أمور أساسية.");
    expect(verdictSay({ verdict: "needs_info", gaps: gaps(12) })).toContain("ينقصه 12 أمراً أساسياً.");
  });

  it("says where the request stands against the land's value", () => {
    expect(strip(reachSay(42))).toBe("في حدود 50% من قيمة الأرض، وهو ما تقبله الجهات بضمانها.");
    expect(strip(reachSay(50))).toBe(strip(reachSay(42)));
    expect(strip(reachSay(68.8))).toBe("فوق 50%، فلا يُعطى كله سيولة بضمان الأرض. يبقى ممكناً إذا رُبط جزء منه بالبناء.");
    expect(strip(reachSay(70))).toBe(strip(reachSay(68.8)));
    expect(strip(reachSay(70.1))).toBe("فوق 70% من قيمة الأرض، وهذا أعلى مما تموله الجهات.");
    for (const ltv of [10, 50, 60, 70, 90, 140]) sentence(reachSay(ltv), String(ltv));
  });
});

describe("what stands in a project's way", () => {
  it("has a title, a reason and a way out for every alert", () => {
    // Every kind the study can raise is covered here.
    expect(new Set(ALERTS.map((alert) => alert.code))).toEqual(new Set(ALERT_CODES));
    for (const alert of ALERTS) {
      const title = alertTitle(alert);
      label(title, alert.code);
      expect(outside(title), alert.code).not.toMatch(/[%−]|\d,\d/);
      sentence(alertDetail(alert), alert.code);
      sentence(alertExit(alert), alert.code);
    }
    // No two alerts are told apart by their number alone.
    expect(new Set(ALERTS.map(alertTitle)).size).toBe(ALERTS.length);
    expect(new Set(ALERT_CODES.map((code) => alertExit(ALERTS.find((alert) => alert.code === code)!))).size).toBe(ALERT_CODES.length);
  });

  it("does not call a fact nobody gave by the name of the worse answer", () => {
    expect(alertTitle({ code: "DEED_UNREGISTERED", level: "block", deed: null })).toBe("نوع الصك غير محدد");
    expect(alertTitle({ code: "DEED_UNREGISTERED", level: "block", deed: "electronic" })).toBe("الصك ليس في السجل العقاري");
    expect(alertTitle({ code: "INDIVIDUAL_BORROWER", level: "warn", known: false })).toBe("صفة المقترض غير محددة");
    expect(alertTitle({ code: "INDIVIDUAL_BORROWER", level: "warn", known: true })).toBe("المقترض فرد");
  });

  it("puts the alert's own number in its title", () => {
    expect(strip(alertTitle({ code: "HIGH_LAND_PRICE", level: "warn", pricePerM2: 120_000 }))).toBe("سعر المتر 120,000 ريال");
    expect(strip(alertTitle({ code: "CASH_ABOVE_LAND_LIMIT", level: "warn", ltv: 68.8 }))).toBe("المطلوب 68.8% من قيمة الأرض");
    expect(strip(alertTitle({ code: "ABOVE_BUILD_COST", level: "info", amount: 4_000_000 }))).toBe("4 مليون من الطلب فوق تكلفة البناء");
    expect(strip(alertTitle({ code: "ABOVE_BUILD_COST", level: "info", amount: 650_000 }))).toBe("650,000 من الطلب فوق تكلفة البناء");
    expect(strip(alertTitle({ code: "LOW_COVER", level: "warn", dscr: 0.86 }))).toBe("دخل الفندق يغطي قسط السنة 0.86 مرة");
  });
});

describe("what a project's file still needs, and how it could be financed", () => {
  it("names every missing paper and says why a lender asks for it", () => {
    for (const code of GAP_CODES) {
      label(gapLabel(code), code);
      sentence(gapWhy(code), code);
    }
    expect(new Set(GAP_CODES.map(gapLabel)).size).toBe(GAP_CODES.length);
  });

  it("explains every way of financing, what it asks for and who to take it to", () => {
    for (const id of STRUCTURE_IDS) {
      label(structureTitle(id), id);
      sentence(structureHow(id), id);
      expect(structureNeeds(id).length, id).toBeGreaterThanOrEqual(2);
      expect(structureAsk(id).length, id).toBeGreaterThanOrEqual(1);
      for (const line of [...structureNeeds(id), ...structureAsk(id)]) label(line, id);
    }
    expect(new Set(STRUCTURE_IDS.map(structureTitle)).size).toBe(STRUCTURE_IDS.length);
  });

  it("promises no lender: a name stands only under who to ask", () => {
    const promise = /يقبل|تقبل|يوافق|توافق|مضمون[^اً]/;
    for (const id of STRUCTURE_IDS) for (const line of structureAsk(id)) expect(line, id).not.toMatch(promise);
  });
});

describe("the numbers of a study, said with where they came from", () => {
  const study = projectStudy(HOTEL, 66_000_000);

  it("gives the three shares a lender looks at, each with its division", () => {
    const lines = ratioLines(HOTEL, study);
    expect(lines.map((line) => [line.key, line.value])).toEqual([
      ["ltv", 68.8],
      ["ltc", 41.8],
      ["equity", 64.6],
    ]);
    expect(lines.map((line) => strip(line.from))).toEqual(["66 مليون من 96 مليون", "66 مليون من 158 مليون، الأرض والبناء", "الأرض و6 مليون سيولة"]);
    for (const line of lines) label(line.label, line.key);
    // With no cash from the owner the land stands alone, and it says so.
    const bare = { ...HOTEL, equityCash: null };
    expect(ratioLines(bare, projectStudy(bare, 66_000_000)).at(-1)!.from).toBe("الأرض وحدها، بلا سيولة");
  });

  it("leaves out a share while what it divides by is not known", () => {
    const landOnly = { ...HOTEL, constructionCost: null };
    expect(ratioLines(landOnly, projectStudy(landOnly, 66_000_000)).map((line) => line.key)).toEqual(["ltv"]);
    expect(ratioLines(EMPTY_PROJECT, projectStudy(EMPTY_PROJECT, 66_000_000))).toEqual([]);
  });

  it("works out a hotel's income against a year of its debt one step at a time", () => {
    const steps = incomeSteps(HOTEL, study);
    expect(steps.map((step) => strip(step.value))).toEqual(["17.66 مليون", "20.31 مليون", "8.12 مليون", "9.4 مليون", "0.86 مرة"]);
    expect(strip(steps[0]!.how)).toBe("180 غرفة، الليلة 420 ريال، والإشغال 64% من 365 ليلة.");
    for (const step of steps) {
      label(step.label, step.label);
      sentence(step.how, step.label);
      // A figure and its unit read in order wherever the line is set.
      expect(step.value, step.label).toMatch(/^⁦[\d.,]+⁩ [؀-ۿ]+$/);
    }
  });

  it("stops before the debt when nothing is asked for, and says nothing for what is not a hotel", () => {
    expect(incomeSteps(HOTEL, projectStudy(HOTEL, 0))).toHaveLength(3);
    const flats = { ...HOTEL, projectType: "residential" as const };
    expect(incomeSteps(flats, projectStudy(flats, 66_000_000))).toEqual([]);
    const noRooms = { ...HOTEL, keys: null };
    expect(incomeSteps(noRooms, projectStudy(noRooms, 66_000_000))).toEqual([]);
  });
});

describe("a large amount, the way it is said", () => {
  it("says millions with two decimals at most, and writes anything smaller in full", () => {
    expect(plainMillions(66_000_000)).toBe("66 مليون");
    expect(plainMillions(64_437_000)).toBe("64.44 مليون");
    expect(plainMillions(1_000_000)).toBe("1 مليون");
    expect(plainMillions(1_250_000_000)).toBe("1,250 مليون");
    expect(plainMillions(999_999)).toBe("999,999");
    expect(plainMillions(0)).toBe("0");
    expect(strip(millions(8_123_674))).toBe("8.12 مليون");
    expect(millions(8_123_674)).toBe("⁦8.12⁩ مليون");
    expect(millions(650_000)).toBe("⁦650,000⁩");
  });

  it("splits a figure from its unit for a figure set large", () => {
    expect(amountParts(66_000_000)).toEqual({ figure: "66", unit: "مليون ريال" });
    expect(amountParts(96_500_000)).toEqual({ figure: "96.5", unit: "مليون ريال" });
    expect(amountParts(480_000)).toEqual({ figure: "480,000", unit: "ريال" });
  });
});

describe("a project's papers and its rejection, as the study says them", () => {
  it("says where a gap's paper stands, and that a checked paper closed a gap", () => {
    for (const standing of ["received", "rejected"] as const) label(GAP_STANDING[standing], standing);
    expect(GAP_STANDING.received).not.toBe(GAP_STANDING.rejected);
    label(HELD_SAY, "held");
    sentence(PAPERS_CLOSE_GAPS, "papers close gaps");
  });

  it("says a rejected file is kept as it was, and how to change it again", () => {
    label(REJECTED_PROJECT, "rejected");
    sentence(REJECTED_PROJECT_SAY, "rejected say");
    // The refusal to save sends the person to where the file is reopened.
    expect(projectError("FILE_REJECTED")).toContain("أعد فتحه");
  });
});

describe("why a project was not saved", () => {
  it("has a sentence for every refusal, and one for a refusal it does not know", () => {
    for (const code of ["INVALID_INPUT", "NOT_FOUND", "NOT_A_PROJECT", "FILE_REJECTED", "BAD_PHONE", "PHONE_TAKEN", "FORBIDDEN"]) expect(PROJECT_ERROR_CODES, code).toContain(code);
    for (const code of PROJECT_ERROR_CODES) {
      const text = projectError(code, { fileNo: "C-014" });
      expect(text, code).toMatch(/^[؀-ۿ]/);
      expect(text, code).not.toMatch(/undefined|NaN|null|\[object|[A-Z_]{4,}|—|–/);
      expect(text.endsWith("."), code).toBe(true);
      expect(text, code).not.toBe(projectError("NO_SUCH_CODE"));
      expect(projectError(code), code).not.toMatch(/undefined|null/);
    }
    expect(projectError("NO_SUCH_CODE")).toBe("تعذر الحفظ. حاول مرة أخرى.");
    expect(projectError("PHONE_TAKEN", { fileNo: "C-014" })).toContain("⁦C-014⁩");
  });
});
