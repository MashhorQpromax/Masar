import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dealStudy, defaultDealInput, STAGES, type DealInput } from "@/domain/deal";
import { clientFacts, clientReachable, isClientMessage, isMessageKind, LINK_DAYS, MESSAGE_KINDS, messageGate, windowOpen } from "@/domain/messages";

const golden = JSON.parse(readFileSync(new URL("../golden/deal.json", import.meta.url), "utf8"));
const cases: { input: DealInput; borrower: never; credit: never }[] = golden.cases;

describe("who the office may write to", () => {
  it("opens every message for a deal that closes", () => {
    for (const verdict of ["go", "tight"] as const) {
      const gate = messageGate({ stage: "settlement", verdict });
      expect(gate).toEqual({ allowed: ["study", "papers", "progress", "reply", "internal"], reason: null });
      expect(clientReachable(gate)).toBe(true);
    }
  });

  it("says nothing to the client of a deal that does not close: a deficit is a rejection", () => {
    const gate = messageGate({ stage: "study", verdict: "short" });
    expect(gate).toEqual({ allowed: ["internal"], reason: "DEFICIT" });
    expect(clientReachable(gate)).toBe(false);
  });

  it("says nothing to the client of a cancelled deal, whatever its numbers were", () => {
    for (const verdict of ["go", "tight", "short", "needs_info"] as const) {
      expect(messageGate({ stage: "lost", verdict })).toEqual({ allowed: ["internal"], reason: "REJECTED" });
    }
  });

  it("asks for papers and answers the client, and no more, while the study still lacks a figure", () => {
    const gate = messageGate({ stage: "study", verdict: "needs_info" });
    expect(gate).toEqual({ allowed: ["papers", "reply", "internal"], reason: "STUDY_OPEN" });
    expect(clientReachable(gate)).toBe(true);
  });

  it("never offers the internal summary as a message for the client", () => {
    expect(MESSAGE_KINDS.filter(isClientMessage)).toEqual(["study", "offer", "papers", "progress", "reply"]);
    expect(isMessageKind("internal")).toBe(true);
    expect(isMessageKind("fees")).toBe(false);
    for (const [stage] of STAGES) {
      for (const verdict of ["go", "tight", "short", "needs_info"] as const) {
        expect(messageGate({ stage, verdict }).allowed).toContain("internal");
      }
    }
  });
});

describe("what a client may be told", () => {
  const input: DealInput = {
    ...defaultDealInput(),
    items: [
      { id: "a", kind: "execution", label: "قرار تنفيذ 4471 — شركة تمويل (2024/03/11)", original: 90000, pay: 80000, by: "company" },
      { id: "b", kind: "default", label: "تعثر — بنك", original: 20000, pay: 20000, by: "company" },
      { id: "c", kind: "mortgage_payoff", label: "مخالصة العقاري — بنك الأول", original: 400000, pay: 390000, by: "company" },
      { id: "d", kind: "card", label: "بطاقة — بنك الأول", original: 15000, pay: 15000, by: "bank" },
      { id: "e", kind: "personal_payoff", label: "تمويل سيارة — شركة تأجير", original: 60000, pay: 60000, by: "out", monthly: 1800 },
    ],
    propertyValue: 1_000_000,
    targetBank: "بنك الراتب",
    bankMortgage: 850000,
    bankPersonal: 200000,
  };
  const study = dealStudy(input, { age: 40, basicSalary: 14000, totalSalary: 19000, serviceMonths: 180, sector: "gov" });
  const facts = clientFacts({ stage: "agreement", input, study });

  it("adds up what is settled and what is paid off, leaving out what stays outside the deal", () => {
    expect(facts.settles).toBe(100000);
    expect(facts.payoff).toBe(405000);
    expect(facts.payoffAt).toEqual(["بنك الأول"]);
  });

  it("carries the new financing and what the client keeps", () => {
    expect(facts.financing.map((part) => [part.part, part.amount])).toEqual([
      ["mortgage", 850000],
      ["personal", 200000],
    ]);
    expect(facts.offered).toBe(true);
    expect(facts.keeps).toBe(Math.max(0, study.clientNet));
    expect(facts.weeks.from).toBeGreaterThanOrEqual(4);
    expect(facts.weeks.to).toBeGreaterThan(facts.weeks.from);
  });

  it("has no place for the company's fee, capital or return", () => {
    const keys = JSON.stringify(Object.keys(facts)).toLowerCase();
    for (const word of ["fee", "capital", "roi", "profit", "cover", "annual"]) expect(keys).not.toContain(word);
    for (const c of cases) {
      const s = dealStudy(c.input, c.borrower, c.credit);
      const f = clientFacts({ stage: "study", input: c.input, study: s });
      expect(Object.keys(f).sort()).toEqual(["financing", "keeps", "keepsCertainty", "offered", "payoff", "payoffAt", "settles", "stage", "structure", "weeks"]);
      for (const part of f.financing) expect(Object.keys(part).sort()).toEqual(["amount", "certainty", "lender", "lenderKind", "part"]);
      expect(f.keeps).toBeGreaterThanOrEqual(0);
      expect(f.weeks.to).toBeGreaterThan(f.weeks.from);
    }
  });
});

describe("the reply window", () => {
  const now = new Date("2026-11-22T12:00:00Z");
  it("is open for a day after the client last wrote", () => {
    expect(windowOpen(new Date("2026-11-22T11:59:00Z"), now)).toBe(true);
    expect(windowOpen(new Date("2026-11-21T12:01:00Z"), now)).toBe(true);
    expect(windowOpen(new Date("2026-11-21T12:00:00Z"), now)).toBe(false);
    expect(windowOpen(new Date("2026-11-01T12:00:00Z"), now)).toBe(false);
    expect(windowOpen(null, now)).toBe(false);
  });
  it("keeps a link open for two weeks", () => {
    expect(LINK_DAYS).toBe(14);
  });
});
