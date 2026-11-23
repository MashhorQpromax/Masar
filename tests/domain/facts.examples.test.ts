import { describe, expect, it } from "vitest";
import {
  BIRTH_YEAR_TOLERANCE,
  disputedFacts,
  factsAgree,
  incomeProven,
  PAPER_CODES,
  PAPER_STATES,
  readFacts,
  relyProblem,
  SALARY_TOLERANCE,
  statedOf,
  statedProblem,
  statesOf,
  type FactReading,
  type StatedPaper,
} from "@/domain/documents";
import { CHECK_RULES, conflictChecks, eligibilityOf, findingOf, isPaperFact, PAPER_FACTS, type PaperFact } from "@/domain/eligibility";

const file = (parts: Partial<Record<PaperFact, number | null>> = {}): Record<PaperFact, number | null> => ({ totalSalary: 15200, basicSalary: 11000, birthYear: 1989, ...parts });
const paper = (id: number, code: string, stated: StatedPaper["stated"], label: string | null = null): StatedPaper => ({ id, code, label, stated });
const of = (readings: FactReading[], fact: PaperFact): FactReading => readings.find((reading) => reading.fact === fact)!;

describe("what each paper states", () => {
  it("names only papers the engine knows, and only facts the file holds too", () => {
    for (const [code, facts] of Object.entries(PAPER_STATES)) {
      expect(PAPER_CODES).toContain(code);
      expect(facts.length).toBeGreaterThan(0);
      for (const fact of facts) expect(isPaperFact(fact)).toBe(true);
    }
    expect(PAPER_FACTS).toEqual(["totalSalary", "basicSalary", "birthYear"]);
  });

  it("gives every fact a paper that states it", () => {
    for (const fact of PAPER_FACTS) expect(Object.values(PAPER_STATES).some((facts) => facts.includes(fact))).toBe(true);
  });

  it("takes only the basic wage from a GOSI statement, which registers no whole salary", () => {
    expect(statesOf("gosi")).toEqual(["basicSalary"]);
    expect(statesOf("salary_cert")).toEqual(["totalSalary", "basicSalary"]);
    expect(statesOf("id")).toEqual(["birthYear"]);
  });

  it("knows no fact of a paper a person added by name, or of one that states none", () => {
    expect(statesOf("custom:7")).toEqual([]);
    expect(statesOf("deed")).toEqual([]);
    expect(statesOf("nothing")).toEqual([]);
  });
});

describe("whether two figures say the same thing", () => {
  it("lets a rounding pass and not a raise", () => {
    expect(SALARY_TOLERANCE).toBe(0.01);
    expect(factsAgree("totalSalary", 15200, 15200)).toBe(true);
    expect(factsAgree("totalSalary", 15200, 15250)).toBe(true);
    // One part in a hundred of the larger: 15,352 against 15,200 is the last that passes.
    expect(factsAgree("totalSalary", 15200, 15353)).toBe(true);
    expect(factsAgree("totalSalary", 15200, 15354)).toBe(false);
    expect(factsAgree("basicSalary", 11000, 10500)).toBe(false);
    // Whichever side the larger figure is on.
    expect(factsAgree("totalSalary", 15354, 15200)).toBe(false);
    expect(factsAgree("totalSalary", 15353, 15200)).toBe(true);
  });

  it("lets a year of birth differ by the one a Hijri date can fall in", () => {
    expect(BIRTH_YEAR_TOLERANCE).toBe(1);
    expect(factsAgree("birthYear", 1989, 1989)).toBe(true);
    expect(factsAgree("birthYear", 1989, 1990)).toBe(true);
    expect(factsAgree("birthYear", 1989, 1988)).toBe(true);
    expect(factsAgree("birthYear", 1989, 1991)).toBe(false);
    expect(factsAgree("birthYear", 1989, 1986)).toBe(false);
  });
});

describe("the figures a person may write from a paper", () => {
  const year = 2026;

  it("keeps what the paper states, within its bounds", () => {
    expect(statedProblem("salary_cert", { totalSalary: 15200, basicSalary: 11000 }, year)).toBeNull();
    expect(statedProblem("salary_cert", { totalSalary: 15200 }, year)).toBeNull();
    expect(statedProblem("id", { birthYear: 1989 }, year)).toBeNull();
    expect(statedProblem("gosi", { basicSalary: 11000 }, year)).toBeNull();
    // Nothing written is nothing wrong: it takes back what was written.
    expect(statedProblem("salary_cert", {}, year)).toBeNull();
    expect(statedProblem("deed", {}, year)).toBeNull();
  });

  it("refuses a fact the paper does not state", () => {
    expect(statedProblem("id", { totalSalary: 15200 }, year)).toBe("NOT_ON_PAPER");
    expect(statedProblem("gosi", { totalSalary: 15200 }, year)).toBe("NOT_ON_PAPER");
    expect(statedProblem("salary_cert", { birthYear: 1989 }, year)).toBe("NOT_ON_PAPER");
    expect(statedProblem("deed", { basicSalary: 1 }, year)).toBe("NOT_ON_PAPER");
    expect(statedProblem("custom:3", { totalSalary: 15200 }, year)).toBe("NOT_ON_PAPER");
  });

  it("refuses a salary that is not a positive amount", () => {
    for (const value of [0, -1, 10_000_001, Number.NaN, Number.POSITIVE_INFINITY]) expect(statedProblem("salary_cert", { totalSalary: value }, year)).toBe("OUT_OF_RANGE");
    expect(statedProblem("salary_cert", { totalSalary: 10_000_000 }, year)).toBeNull();
    expect(statedProblem("salary_cert", { totalSalary: 0.5 }, year)).toBeNull();
  });

  it("refuses a year nobody applying could be born in", () => {
    expect(statedProblem("id", { birthYear: 1929 }, year)).toBe("OUT_OF_RANGE");
    expect(statedProblem("id", { birthYear: 1930 }, year)).toBeNull();
    // Eighteen this year is the youngest.
    expect(statedProblem("id", { birthYear: 2008 }, year)).toBeNull();
    expect(statedProblem("id", { birthYear: 2009 }, year)).toBe("OUT_OF_RANGE");
    expect(statedProblem("id", { birthYear: 1989.5 }, year)).toBe("OUT_OF_RANGE");
    // A Hijri year is not a year of the file. The edge turns it before it gets here.
    expect(statedProblem("id", { birthYear: 1409 }, year)).toBe("OUT_OF_RANGE");
  });

  it("refuses a basic salary above the total of the same paper", () => {
    expect(statedProblem("salary_cert", { totalSalary: 11000, basicSalary: 15200 }, year)).toBe("BASIC_ABOVE_TOTAL");
    expect(statedProblem("payslip", { totalSalary: 11000, basicSalary: 11000 }, year)).toBeNull();
  });

  it("reads a stored value as the figures the paper may state, and nothing else of it", () => {
    expect(statedOf("salary_cert", { totalSalary: 15200, basicSalary: 11000, birthYear: 1989, other: 4 })).toEqual({ totalSalary: 15200, basicSalary: 11000 });
    expect(statedOf("gosi", { totalSalary: 15200, basicSalary: 11000 })).toEqual({ basicSalary: 11000 });
    expect(statedOf("id", { birthYear: "1989" })).toEqual({});
    expect(statedOf("id", { birthYear: 0 })).toEqual({});
    expect(statedOf("salary_cert", { totalSalary: Number.NaN })).toEqual({});
    for (const value of [null, undefined, "x", 7, [15200], true]) expect(statedOf("salary_cert", value)).toEqual({});
    expect(statedOf("custom:2", { totalSalary: 15200 })).toEqual({});
  });
});

describe("a file held against its checked papers", () => {
  it("has nothing behind a fact no paper states, and nothing against it", () => {
    const readings = readFacts(file(), []);
    expect(readings.map((reading) => reading.fact)).toEqual([...PAPER_FACTS]);
    for (const reading of readings) expect(reading).toMatchObject({ state: "unstated", stated: [], papersAgree: true });
    expect(of(readings, "totalSalary").file).toBe(15200);
    expect(disputedFacts(readings)).toEqual([]);
  });

  it("does not take a checked paper nobody wrote a figure from as agreement", () => {
    const readings = readFacts(file(), [paper(1, "salary_cert", {}), paper(2, "id", {})]);
    for (const reading of readings) expect(reading.state).toBe("unstated");
    expect(incomeProven(readings)).toBe(false);
  });

  it("agrees when every paper that states a fact says what the file says", () => {
    const readings = readFacts(file(), [paper(1, "id", { birthYear: 1990 }), paper(2, "salary_cert", { totalSalary: 15200, basicSalary: 11000 }), paper(3, "gosi", { basicSalary: 11050 })]);
    expect(readings.map((reading) => reading.state)).toEqual(["agrees", "agrees", "agrees"]);
    expect(of(readings, "basicSalary").stated).toEqual([
      { paperId: 2, code: "salary_cert", label: null, value: 11000 },
      { paperId: 3, code: "gosi", label: null, value: 11050 },
    ]);
    expect(disputedFacts(readings)).toEqual([]);
  });

  it("finds the file against a paper", () => {
    const readings = readFacts(file(), [paper(1, "id", { birthYear: 1986 })]);
    expect(of(readings, "birthYear")).toEqual({ fact: "birthYear", file: 1989, stated: [{ paperId: 1, code: "id", label: null, value: 1986 }], state: "conflict", papersAgree: true });
    expect(disputedFacts(readings)).toEqual(["birthYear"]);
  });

  it("finds two papers against each other, even when one says what the file says", () => {
    const readings = readFacts(file(), [paper(1, "salary_cert", { totalSalary: 15200 }), paper(2, "payslip", { totalSalary: 13000 })]);
    expect(of(readings, "totalSalary")).toMatchObject({ state: "conflict", papersAgree: false });
    expect(disputedFacts(readings)).toEqual(["totalSalary"]);
  });

  it("holds an empty fact of the file in dispute once a paper states it", () => {
    const readings = readFacts(file({ basicSalary: null, birthYear: 0 }), [paper(1, "gosi", { basicSalary: 11000 }), paper(2, "id", { birthYear: 1989 })]);
    expect(of(readings, "basicSalary")).toMatchObject({ file: null, state: "conflict", papersAgree: true });
    expect(of(readings, "birthYear")).toMatchObject({ file: null, state: "conflict", papersAgree: true });
  });

  it("ignores a figure a paper cannot state, however it got there", () => {
    const readings = readFacts(file(), [paper(1, "gosi", { totalSalary: 9000, basicSalary: 11000 }), paper(2, "custom:1", { totalSalary: 9000 }, "خطاب")]);
    expect(of(readings, "totalSalary").state).toBe("unstated");
    expect(of(readings, "basicSalary").state).toBe("agrees");
  });

  it("names the disputed facts in the order the facts are named", () => {
    const readings = readFacts(file(), [paper(1, "id", { birthYear: 1980 }), paper(2, "salary_cert", { totalSalary: 9000, basicSalary: 7000 })]);
    expect(disputedFacts(readings)).toEqual(["totalSalary", "basicSalary", "birthYear"]);
  });
});

describe("whether the file can take what a paper says", () => {
  it("can when the papers agree and the file is the one that differs", () => {
    const readings = readFacts(file(), [paper(1, "salary_cert", { totalSalary: 13000 }), paper(2, "payslip", { totalSalary: 13050 })]);
    expect(relyProblem(of(readings, "totalSalary"), 1)).toBeNull();
    expect(relyProblem(of(readings, "totalSalary"), 2)).toBeNull();
  });

  it("cannot take a paper that states nothing about the fact", () => {
    const readings = readFacts(file(), [paper(1, "salary_cert", { totalSalary: 13000 }), paper(2, "id", { birthYear: 1989 })]);
    expect(relyProblem(of(readings, "totalSalary"), 2)).toBe("NOT_STATED");
    expect(relyProblem(of(readings, "totalSalary"), 99)).toBe("NOT_STATED");
    expect(relyProblem(of(readings, "basicSalary"), 1)).toBe("NOT_STATED");
  });

  it("has nothing to take when the file already says what the papers say", () => {
    const readings = readFacts(file(), [paper(1, "salary_cert", { totalSalary: 15200 })]);
    expect(relyProblem(of(readings, "totalSalary"), 1)).toBe("NO_CONFLICT");
  });

  it("settles nothing by taking one of two papers that differ", () => {
    const readings = readFacts(file(), [paper(1, "salary_cert", { totalSalary: 15200 }), paper(2, "payslip", { totalSalary: 13000 })]);
    expect(relyProblem(of(readings, "totalSalary"), 1)).toBe("PAPERS_DISAGREE");
    expect(relyProblem(of(readings, "totalSalary"), 2)).toBe("PAPERS_DISAGREE");
  });
});

describe("whether the income is proven", () => {
  it("is when a checked paper states the total salary the income is counted from", () => {
    expect(incomeProven(readFacts(file(), [paper(1, "salary_cert", { totalSalary: 15200 })]))).toBe(true);
    expect(incomeProven(readFacts(file(), [paper(1, "pension", { totalSalary: 15250 })]))).toBe(true);
  });

  it("is not by a paper that states only the other salary", () => {
    // The file counts the total. A GOSI statement states the basic wage only.
    expect(incomeProven(readFacts(file(), [paper(1, "gosi", { basicSalary: 11000 })]))).toBe(false);
  });

  it("counts the basic salary when the file holds no total", () => {
    expect(incomeProven(readFacts(file({ totalSalary: null }), [paper(1, "gosi", { basicSalary: 11000 })]))).toBe(true);
    expect(incomeProven(readFacts(file({ totalSalary: 0 }), [paper(1, "gosi", { basicSalary: 11000 })]))).toBe(true);
    expect(incomeProven(readFacts(file({ totalSalary: null }), [paper(1, "gosi", { basicSalary: 9000 })]))).toBe(false);
  });

  it("is not while the counted salary is in dispute, or the file holds no salary", () => {
    expect(incomeProven(readFacts(file(), [paper(1, "salary_cert", { totalSalary: 13000 })]))).toBe(false);
    expect(incomeProven(readFacts(file(), [paper(1, "salary_cert", { totalSalary: 15200 }), paper(2, "payslip", { totalSalary: 13000 })]))).toBe(false);
    expect(incomeProven(readFacts(file({ totalSalary: null, basicSalary: null }), []))).toBe(false);
    expect(incomeProven([])).toBe(false);
  });

  it("stays proven while only the year of birth is in dispute", () => {
    expect(incomeProven(readFacts(file(), [paper(1, "salary_cert", { totalSalary: 15200 }), paper(2, "id", { birthYear: 1980 })]))).toBe(true);
  });
});

describe("a conflict in the strict reading", () => {
  it("raises one check for each disputed fact, in the order the facts are named", () => {
    expect(conflictChecks(["birthYear", "totalSalary"])).toEqual([
      { key: "file", status: "warn", code: "FACT_CONFLICT", ref: "totalSalary", params: { fact: "totalSalary" } },
      { key: "file", status: "warn", code: "FACT_CONFLICT", ref: "birthYear", params: { fact: "birthYear" } },
    ]);
    expect(conflictChecks(["birthYear", "birthYear"])).toHaveLength(1);
  });

  it("raises none when nothing is in dispute", () => {
    expect(conflictChecks([])).toEqual([]);
    expect(conflictChecks(null)).toEqual([]);
    expect(conflictChecks(undefined)).toEqual([]);
  });

  it("reads as a fact nobody knows: it blocks nothing and confirms nothing", () => {
    const [check] = conflictChecks(["totalSalary"]);
    expect(CHECK_RULES.FACT_CONFLICT).toEqual({ basis: "client", missing: true });
    const finding = findingOf(check!, CHECK_RULES.FACT_CONFLICT, undefined);
    expect(finding).toMatchObject({ outcome: "unknown", doubt: "FACT_MISSING", basis: "client", term: null, leans: null });
    expect(eligibilityOf([{ outcome: "met" }, finding])).toBe("needs_verification");
    // A confirmed blocker still decides alone.
    expect(eligibilityOf([{ outcome: "blocked" }, finding])).toBe("not_eligible");
  });
});
