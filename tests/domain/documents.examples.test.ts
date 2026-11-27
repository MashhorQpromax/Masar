import { describe, expect, it } from "vitest";
import type { DealItem, Stage } from "@/domain/deal";
import {
  checklist,
  cleanFileName,
  dealPapers,
  FILE_KINDS,
  FILE_MIME,
  fileKind,
  hasReached,
  isCustomCode,
  isPaperCode,
  PAPER_CODES,
  PAPERS,
  paperSource,
  type DealOnTheRoad,
  type KeptPaper,
} from "@/domain/documents";
import { FINANCE_TYPES, requiredDocuments, SECTORS } from "@/domain/eligibility";

const items: DealItem[] = [
  { id: "a", kind: "execution", label: "قرار تنفيذ", original: 90000, pay: 80000, by: "company" },
  { id: "b", kind: "mortgage_payoff", label: "مخالصة العقاري", original: 400000, pay: 380000, by: "company" },
  { id: "c", kind: "personal_payoff", label: "مخالصة الشخصي", original: 60000, pay: 55000, by: "bank" },
];
const road: Stage[] = ["study", "agreement", "settlement", "clearance", "simah_update", "payoff", "transfer", "bank_submit", "approval", "disbursement", "recovered"];
const deal = (stage: Stage, parts: Partial<DealOnTheRoad> = {}): DealOnTheRoad => ({
  structure: "settle_refi_personal",
  stage,
  history: road.slice(0, Math.max(1, road.indexOf(stage) + 1)),
  items,
  ...parts,
});
const gov = { sector: "gov", nationality: "saudi" } as const;
const codes = (stage: Stage, parts: Partial<DealOnTheRoad> = {}, who: Parameters<typeof dealPapers>[1] = gov) =>
  dealPapers(deal(stage, parts), who)
    .filter((need) => need.required)
    .map((need) => need.code);

describe("the papers the engine knows", () => {
  it("files every paper a lender can ask for under the lender's own group", () => {
    for (const financeType of FINANCE_TYPES) {
      for (const sector of SECTORS) {
        for (const need of requiredDocuments(financeType, sector, "saudi")) {
          expect(isPaperCode(need.code), need.code).toBe(true);
          expect(PAPERS[need.code as keyof typeof PAPERS], need.code).toBe(need.category);
        }
      }
    }
    expect(new Set(PAPER_CODES).size).toBe(PAPER_CODES.length);
  });

  it("tells a paper a person added from one it knows", () => {
    expect(isCustomCode("custom:4f2a9c")).toBe(true);
    expect(isCustomCode("custom:")).toBe(false);
    expect(isCustomCode("id")).toBe(false);
    expect(isPaperCode("custom:4f2a9c")).toBe(false);
    expect(isPaperCode("toString")).toBe(false);
  });
});

describe("what a deal's file needs", () => {
  it("asks at the study for what both lenders ask, and for the liability letters", () => {
    expect(codes("study")).toEqual(["id", "address", "simah", "obligations", "salary_cert", "bank_3", "deed", "valuation"]);
    const all = dealPapers(deal("study"), gov);
    expect(all.filter((need) => !need.required).map((need) => need.code)).toEqual(["payslip", "family", "sakani"]);
  });

  it("leaves the liability letters optional when the deal settles nothing", () => {
    const nothing = dealPapers(deal("study", { items: [] }), gov);
    expect(nothing.find((need) => need.code === "obligations")).toMatchObject({ required: false });
    const outside = dealPapers(deal("study", { items: items.map((item) => ({ ...item, by: "out" as const })) }), gov);
    expect(outside.find((need) => need.code === "obligations")).toMatchObject({ required: false });
  });

  it("asks for each paper the deal produces once it reaches the stage that produces it", () => {
    const produced = (stage: Stage) => codes(stage).filter((code) => PAPERS[code] === "deal");
    expect(produced("study")).toEqual([]);
    expect(produced("agreement")).toEqual(["agreement"]);
    expect(produced("settlement")).toEqual(["agreement"]);
    expect(produced("clearance")).toEqual(["agreement", "clearance"]);
    expect(produced("simah_update")).toEqual(["agreement", "clearance"]);
    expect(produced("payoff")).toEqual(["agreement", "clearance", "payoff_letter"]);
    expect(produced("transfer")).toEqual(["agreement", "clearance", "payoff_letter", "transfer_deed"]);
    expect(produced("recovered")).toEqual(["agreement", "clearance", "payoff_letter", "transfer_deed"]);
  });

  it("has no property papers when the deal ends in personal finance only", () => {
    const personal = codes("recovered", { structure: "settle_personal" });
    expect(personal).toEqual(["id", "address", "simah", "obligations", "salary_cert", "bank_3", "agreement", "clearance"]);
  });

  it("asks for no clearance letter when the company pays only the mortgage", () => {
    const onlyMortgage = items.filter((item) => item.kind === "mortgage_payoff");
    expect(codes("recovered", { items: onlyMortgage })).not.toContain("clearance");
    expect(codes("recovered", { items: onlyMortgage })).toContain("payoff_letter");
    expect(codes("recovered", { items: items.filter((item) => item.kind !== "mortgage_payoff") })).not.toContain("payoff_letter");
  });

  it("follows who the client is", () => {
    expect(codes("study", {}, { sector: "private", nationality: "non_saudi" })).toContain("gosi");
    expect(codes("study", {}, { sector: "retired", nationality: "saudi" })).toContain("pension");
    expect(codes("study", {}, { sector: "self", nationality: "saudi" })).toEqual(expect.arrayContaining(["cr", "fin_statements", "zakat", "bank_12"]));
  });

  it("knows how far an ended deal got", () => {
    expect(hasReached({ stage: "closed", history: [] }, "transfer")).toBe(true);
    expect(hasReached({ stage: "lost", history: ["study", "agreement", "lost"] }, "agreement")).toBe(true);
    expect(hasReached({ stage: "lost", history: ["study", "agreement", "lost"] }, "clearance")).toBe(false);
    expect(hasReached({ stage: "lost", history: ["study", "lost"] }, "agreement")).toBe(false);
    expect(codes("lost", { history: ["study", "agreement", "settlement", "clearance", "lost"] })).toEqual(expect.arrayContaining(["agreement", "clearance"]));
    expect(codes("lost", { history: ["study", "lost"] })).not.toContain("agreement");
  });
});

describe("a file against what the deal needs", () => {
  const file = (id: number) => ({ id, name: `ملف ${id}.pdf`, kind: "pdf" as const, size: 1000 });
  const kept = (parts: Partial<KeptPaper> & Pick<KeptPaper, "code">): KeptPaper => ({ id: 1, label: null, status: "received", note: null, files: [file(1)], ...parts });
  const needs = dealPapers(deal("agreement"), gov);

  it("counts what is owed, what arrived and what was verified", () => {
    const list = checklist(
      needs,
      [
        kept({ id: 1, code: "id", status: "verified" }),
        kept({ id: 2, code: "address" }),
        kept({ id: 3, code: "salary_cert", status: "rejected", note: "قديم" }),
        kept({ id: 4, code: "payslip" }),
      ],
      { creditRead: false },
    );
    expect(list.required).toBe(9);
    expect(list.verified).toBe(1);
    // Sent back counts as owed.
    expect(list.missing).toBe(7);
    // The optional payslip waits to be looked at too.
    expect(list.toCheck).toBe(2);
    expect(list.papers.find((paper) => paper.code === "salary_cert")).toMatchObject({ status: "rejected", note: "قديم", id: 3, required: true });
    expect(list.papers.find((paper) => paper.code === "deed")).toMatchObject({ status: "missing", id: null, files: [] });
  });

  it("takes the SIMAH report as verified once it was read", () => {
    expect(checklist(needs, [], { creditRead: false }).papers.find((paper) => paper.code === "simah")).toMatchObject({ status: "missing" });
    expect(checklist(needs, [], { creditRead: true }).papers.find((paper) => paper.code === "simah")).toMatchObject({ status: "verified" });
    expect(checklist(needs, [kept({ code: "simah" })], { creditRead: false }).papers.find((paper) => paper.code === "simah")).toMatchObject({ status: "received" });
    expect(checklist(needs, [], { creditRead: true }).missing).toBe(checklist(needs, [], { creditRead: false }).missing - 1);
  });

  it("keeps a paper a person added as owed until it arrives", () => {
    const list = checklist(needs, [kept({ id: 9, code: "custom:ab12", label: "فحص طبي", status: "missing", files: [] })], { creditRead: false });
    expect(list.papers.at(-1)).toMatchObject({ code: "custom:ab12", category: "extra", required: true, asked: true, status: "missing" });
    expect(list.required).toBe(10);
  });

  it("shows a kept paper the deal no longer asks for, without counting it", () => {
    const list = checklist(needs, [kept({ code: "quote" }), kept({ id: 2, code: "license", files: [], status: "missing" }), kept({ id: 3, code: "unknown_code" })], { creditRead: false });
    expect(list.papers.find((paper) => paper.code === "quote")).toMatchObject({ required: false, asked: false, category: "collateral" });
    expect(list.papers.some((paper) => paper.code === "license")).toBe(false);
    expect(list.papers.some((paper) => paper.code === "unknown_code")).toBe(false);
    expect(list.required).toBe(9);
  });

  it("says who brings each paper", () => {
    const list = checklist(dealPapers(deal("recovered"), gov), [kept({ code: "custom:x1", label: "فحص طبي" })], { creditRead: false });
    expect(list.papers.filter((paper) => paper.by === "office").map((paper) => paper.code)).toEqual(["valuation", "agreement", "clearance", "payoff_letter", "transfer_deed"]);
    expect(list.papers.find((paper) => paper.code === "custom:x1")!.by).toBe("client");
    expect(paperSource("deed")).toBe("client");
  });

  it("lists the groups in one order", () => {
    const list = checklist(needs, [kept({ code: "custom:x1", label: "ورقة" })], { creditRead: false });
    const groups = list.papers.map((paper) => paper.category).filter((category, index, all) => all.indexOf(category) === index);
    expect(groups).toEqual(["identity", "obligations", "income", "collateral", "deal", "extra"]);
  });

  it("is complete when nothing required is owed", () => {
    const all = needs.filter((need) => need.required).map((need, index) => kept({ id: index + 1, code: need.code, status: "verified" }));
    const list = checklist(needs, all, { creditRead: true });
    expect(list).toMatchObject({ missing: 0, toCheck: 0, verified: list.required });
  });
});

describe("files", () => {
  const bytes = (...head: number[]) => new Uint8Array([...head, ...new Array(32).fill(0)]);

  it("reads what a file is from its own bytes", () => {
    expect(fileKind(new TextEncoder().encode("%PDF-1.7\n..."))).toBe("pdf");
    expect(fileKind(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
    expect(fileKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("png");
    expect(fileKind(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50))).toBe("webp");
  });

  it("refuses everything else, whatever it is called", () => {
    expect(fileKind(new TextEncoder().encode("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(fileKind(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(fileKind(bytes(0x4d, 0x5a))).toBeNull();
    expect(fileKind(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45))).toBeNull();
    expect(fileKind(new Uint8Array())).toBeNull();
    expect(fileKind(new Uint8Array([0x25, 0x50]))).toBeNull();
  });

  it("has a type to send for every kind", () => {
    for (const kind of FILE_KINDS) expect(FILE_MIME[kind]).toMatch(/^(application\/pdf|image\/(jpeg|png|webp))$/);
  });

  it("cleans a file name and gives it the extension of what the file is", () => {
    expect(cleanFileName("كشف الحساب.PDF", "pdf")).toBe("كشف الحساب.pdf");
    expect(cleanFileName("IMG_2041.HEIC", "jpeg")).toBe("IMG_2041.jpg");
    expect(cleanFileName("C:\\Users\\me\\..\\..\\secret.png", "png")).toBe("secret.png");
    expect(cleanFileName("../../etc/passwd", "pdf")).toBe("passwd.pdf");
    expect(cleanFileName('a\r\nSet-Cookie: x="1".pdf', "pdf")).toBe("aSet-Cookie x=1.pdf");
    expect(cleanFileName("\u202Egpj.exe", "jpeg")).toBe("gpj.jpg");
    expect(cleanFileName("", "webp")).toBe("file.webp");
    expect(cleanFileName("....", "pdf")).toBe("file.pdf");
    expect([...cleanFileName("م".repeat(300) + ".pdf", "pdf")].length).toBe(84);
  });
});
