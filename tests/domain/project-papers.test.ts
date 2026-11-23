import { describe, expect, it } from "vitest";
import { gapPapers, gapStanding, heldGaps, isPaperCode, PAPERS, projectPapers, type PaperStatus } from "@/domain/documents";
import { EMPTY_PROJECT, GAP_CODES, GAPS_BEFORE_VERDICT, projectStudy, type GapCode, type ProjectFacts } from "@/domain/project";

const facts = (over: Partial<ProjectFacts> = {}): ProjectFacts => ({ ...EMPTY_PROJECT, ...over });
const codes = (over: Partial<ProjectFacts> = {}) => projectPapers(facts(over), "saudi");
const required = (over: Partial<ProjectFacts> = {}) =>
  codes(over)
    .filter((need) => need.required)
    .map((need) => need.code);
const optional = (over: Partial<ProjectFacts> = {}) =>
  codes(over)
    .filter((need) => !need.required)
    .map((need) => need.code);
const kept = (list: Record<string, PaperStatus>) => Object.entries(list).map(([code, status]) => ({ code, status }));

describe("the papers a project's file needs", () => {
  it("asks every project for the owner, the land, the build and the money", () => {
    expect(required()).toEqual(["id", "address", "simah", "bank_12", "deed", "valuation", "feasibility", "permit", "boq", "sources_uses"]);
  });

  it("asks a company for its own papers, a person for none of them, and lists them as optional while nobody said who borrows", () => {
    const company = ["cr", "fin_statements", "zakat", "simah_company"];
    expect(required({ borrowerType: "company" })).toEqual(expect.arrayContaining(company));
    for (const code of company) {
      expect(
        codes({ borrowerType: "individual" }).map((need) => need.code),
        code,
      ).not.toContain(code);
      expect(optional(), code).toContain(code);
    }
  });

  it("asks for the mortgagee's letter when the land is mortgaged, and the municipality's when it is by the holy mosque", () => {
    expect(optional()).toEqual(expect.arrayContaining(["lien", "zoning", "obligations"]));
    expect(required({ existingLien: true })).toContain("lien");
    expect(required({ existingLien: true })).not.toContain("zoning");
    expect(required({ nearHaram: true })).toContain("zoning");
    expect(required({ nearHaram: true })).not.toContain("lien");
  });

  it("names each paper once, by a code the file knows, under that code's group", () => {
    for (const over of [{}, { borrowerType: "company" as const, existingLien: true, nearHaram: true }, { borrowerType: "individual" as const }]) {
      const needs = codes(over);
      expect(new Set(needs.map((need) => need.code)).size).toBe(needs.length);
      for (const need of needs) {
        expect(isPaperCode(need.code), need.code).toBe(true);
        expect(need.category, need.code).toBe(PAPERS[need.code]);
      }
    }
  });

  it("asks for nothing a salary would bring", () => {
    for (const over of [{}, { borrowerType: "company" as const }]) {
      for (const code of ["salary_cert", "payslip", "gosi", "pension", "bank_3"])
        expect(
          codes(over).map((need) => need.code),
          code,
        ).not.toContain(code);
    }
  });
});

describe("the papers that answer a gap of the study", () => {
  it("names the papers of each gap, and none for a fact somebody writes down", () => {
    const person = facts({ borrowerType: "individual" });
    expect(gapPapers("DEED_COPY", person)).toEqual(["deed"]);
    expect(gapPapers("FEASIBILITY", person)).toEqual(["feasibility"]);
    expect(gapPapers("PERMIT", person)).toEqual(["permit"]);
    expect(gapPapers("VALUATION_REPORT", person)).toEqual(["valuation"]);
    expect(gapPapers("USE_OF_FUNDS", person)).toEqual(["sources_uses"]);
    expect(gapPapers("NO_EXPROPRIATION", person)).toEqual(["zoning"]);
    for (const gap of ["BORROWER_TYPE", "BUILD_COST", "BUILT_AREA", "ROOMS", "OWNER_CASH", "OPERATOR_LETTER"] as GapCode[]) expect(gapPapers(gap, person), gap).toEqual([]);
  });

  it("asks a company for its statements and its own credit report beside the owner's", () => {
    expect(gapPapers("STATEMENTS", facts())).toEqual(["bank_12"]);
    expect(gapPapers("CREDIT_REPORT", facts({ borrowerType: "individual" }))).toEqual(["simah"]);
    expect(gapPapers("STATEMENTS", facts({ borrowerType: "company" }))).toEqual(["bank_12", "fin_statements"]);
    expect(gapPapers("CREDIT_REPORT", facts({ borrowerType: "company" }))).toEqual(["simah", "simah_company"]);
  });

  it("names only papers the project's own list asks for", () => {
    for (const borrowerType of [null, "individual", "company"] as const) {
      const asked = new Set(projectPapers(facts({ borrowerType }), "saudi").map((need) => need.code));
      for (const gap of GAP_CODES) for (const code of gapPapers(gap, facts({ borrowerType }))) expect(asked.has(code), `${borrowerType} ${gap} ${code}`).toBe(true);
    }
  });
});

describe("the gaps a file answers with its papers", () => {
  it("holds a gap only when its paper was checked and stands as good", () => {
    expect([...heldGaps(facts(), [])]).toEqual([]);
    expect([...heldGaps(facts(), kept({ deed: "received", valuation: "rejected", permit: "missing" }))]).toEqual([]);
    expect([...heldGaps(facts(), kept({ deed: "verified", valuation: "verified", permit: "received" }))]).toEqual(["DEED_COPY", "VALUATION_REPORT"]);
  });

  it("holds a company's gap only when every paper it names is good", () => {
    const company = facts({ borrowerType: "company" });
    expect([...heldGaps(company, kept({ bank_12: "verified", simah: "verified" }))]).toEqual([]);
    expect([...heldGaps(company, kept({ bank_12: "verified", fin_statements: "verified", simah: "verified", simah_company: "received" }))]).toEqual(["STATEMENTS"]);
    expect([...heldGaps(company, kept({ bank_12: "verified", fin_statements: "verified", simah: "verified", simah_company: "verified" }))]).toEqual(["STATEMENTS", "CREDIT_REPORT"]);
    // The same papers answer more for a person, who has no company papers to bring.
    expect([...heldGaps(facts({ borrowerType: "individual" }), kept({ bank_12: "verified", simah: "verified" }))]).toEqual(["STATEMENTS", "CREDIT_REPORT"]);
  });

  it("never holds a gap that no paper answers, whatever was checked", () => {
    const everything = kept(Object.fromEntries(Object.keys(PAPERS).map((code) => [code, "verified" as const])));
    const held = heldGaps(facts({ borrowerType: "company" }), everything);
    for (const gap of ["BORROWER_TYPE", "BUILD_COST", "BUILT_AREA", "ROOMS", "OWNER_CASH", "OPERATOR_LETTER"] as GapCode[]) expect(held.has(gap), gap).toBe(false);
    expect(held.size).toBe(8);
  });

  it("says where a gap's papers stand together", () => {
    const company = facts({ borrowerType: "company" });
    expect(gapStanding("BUILD_COST", company, kept({ boq: "verified" }))).toBeNull();
    expect(gapStanding("DEED_COPY", company, [])).toBe("missing");
    expect(gapStanding("DEED_COPY", company, kept({ deed: "received" }))).toBe("received");
    expect(gapStanding("DEED_COPY", company, kept({ deed: "rejected" }))).toBe("rejected");
    expect(gapStanding("DEED_COPY", company, kept({ deed: "verified" }))).toBe("verified");
    // Two papers: one good and one still owed is not good yet; one sent back says so first.
    expect(gapStanding("STATEMENTS", company, kept({ bank_12: "verified" }))).toBe("received");
    expect(gapStanding("STATEMENTS", company, kept({ bank_12: "verified", fin_statements: "rejected" }))).toBe("rejected");
    expect(gapStanding("STATEMENTS", company, kept({ bank_12: "verified", fin_statements: "verified" }))).toBe("verified");
  });
});

describe("a study read against the papers the file holds", () => {
  const bare = facts({ borrowerType: "individual", deed: "paper", landValue: 40_000_000, constructionCost: 20_000_000, gfa: 9000 });

  it("reads the facts alone when nothing is held", () => {
    for (const x of [facts(), bare, facts({ borrowerType: "company", projectType: "hotel", nearHaram: true })]) {
      for (const requested of [0, 12_000_000, 90_000_000]) expect(projectStudy(x, requested, new Set())).toEqual(projectStudy(x, requested));
    }
  });

  it("stops asking for what is held, and changes nothing else", () => {
    const before = projectStudy(bare, 15_000_000);
    const held = new Set<GapCode>(["DEED_COPY", "STATEMENTS"]);
    const after = projectStudy(bare, 15_000_000, held);
    expect(after.gaps).toEqual(before.gaps.filter((gap) => !held.has(gap.code)));
    expect({ ...after, gaps: [], verdict: "" }).toEqual({ ...before, gaps: [], verdict: "" });
    // The deed on paper still blocks: a copy of it in the file does not put the land in the register.
    expect(after.alerts.map((alert) => alert.code)).toContain("DEED_UNREGISTERED");
  });

  it("reaches a verdict once enough of what held it back is answered", () => {
    const critical = (study: ReturnType<typeof projectStudy>) => study.gaps.filter((gap) => gap.critical).map((gap) => gap.code);
    const before = projectStudy(bare, 15_000_000);
    expect(critical(before)).toEqual(["DEED_COPY", "FEASIBILITY", "PERMIT", "VALUATION_REPORT", "STATEMENTS", "CREDIT_REPORT", "OWNER_CASH", "USE_OF_FUNDS"]);
    expect(before.verdict).toBe("needs_info");
    const some = projectStudy(bare, 15_000_000, new Set<GapCode>(["DEED_COPY", "FEASIBILITY", "PERMIT", "VALUATION_REPORT"]));
    expect(critical(some)).toHaveLength(GAPS_BEFORE_VERDICT);
    expect(some.verdict).toBe("needs_info");
    const more = projectStudy(bare, 15_000_000, new Set<GapCode>(["DEED_COPY", "FEASIBILITY", "PERMIT", "VALUATION_REPORT", "STATEMENTS"]));
    expect(critical(more)).toEqual(["CREDIT_REPORT", "OWNER_CASH", "USE_OF_FUNDS"]);
    expect(more.verdict).toBe("feasible");
  });

  it("never turns a weak request into a good one: papers answer gaps, not the numbers", () => {
    const all = new Set<GapCode>(GAP_CODES);
    const weak = projectStudy(bare, 36_000_000, all);
    expect(weak.gaps).toEqual([]);
    expect(weak.verdict).toBe("weak");
  });
});
