import { desc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyReport } from "@/domain/credit";
import { FILE_MAX_BYTES, PAPER_MAX_FILES } from "@/domain/documents";
import { addCreditReport } from "@/server/credit/service";
import type { Connection } from "@/server/db/client";
import { auditLog, clients, creditReports, documentFiles, documents, fileBlobs } from "@/server/db/schema";
import { setDealStage } from "@/server/deals/service";
import { roadView } from "@/server/deals/views";
import { seedDemo } from "@/server/demo/seed";
import { addPaper, addPaperFile, clientOfDeal, getPapers, openPaperFile, removePaper, removePaperFile, reviewPaper } from "@/server/documents/service";
import { SYSTEM } from "@/server/shared/actor";
import { testDb } from "../helpers/db";

let c: Connection;
const now = new Date("2026-11-22T09:00:00Z");
const deals: Record<string, number> = {};
const people: Record<string, number> = {};

beforeAll(async () => {
  c = await testDb();
  await seedDemo(c.db, now);
  for (const deal of (await roadView(c.db, now)).deals) {
    deals[deal.clientName] = deal.dealId;
    people[deal.clientName] = (await clientOfDeal(c.db, deal.dealId))!;
  }
});
afterAll(async () => {
  await c.close();
});

const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4\n${text}\n%%EOF\n`);
const jpeg = (seed: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, seed, seed >> 8, 1, 2, 3, 4]);
const list = async (name: string) => (await getPapers(c.db, { dealId: deals[name]!, now }))!.list;
const paper = async (name: string, code: string) => (await list(name)).papers.find((p) => p.code === code)!;
const lastAudit = async () => (await c.db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(1))[0]!;

describe("the file of a demo deal", () => {
  it("holds a deal mid-way against what its stage needs", async () => {
    const salem = await list("سالم");
    expect(salem.papers.filter((p) => p.required).map((p) => [p.code.startsWith("custom:") ? "custom" : p.code, p.status])).toEqual([
      ["id", "verified"],
      ["address", "verified"],
      ["simah", "verified"],
      ["obligations", "verified"],
      ["salary_cert", "rejected"],
      ["bank_3", "received"],
      ["deed", "verified"],
      ["valuation", "missing"],
      ["agreement", "verified"],
      ["clearance", "received"],
      ["payoff_letter", "missing"],
      ["custom", "missing"],
    ]);
    // Two papers wait to be looked at, and so does the file that arrived by WhatsApp.
    expect(salem).toMatchObject({ required: 12, missing: 4, verified: 6, toCheck: 3 });
    expect((await paper("سالم", "salary_cert")).note).toBe("مضى عليه أكثر من شهر");
    expect((await paper("سالم", "bank_3")).files.map((f) => f.name)).toEqual(["كشف الحساب 1.pdf", "كشف الحساب 2.pdf", "كشف الحساب 3.pdf"]);
    expect(salem.papers.at(-2)).toMatchObject({ label: "خطاب تثبيت من جهة العمل", category: "extra" });
    expect(salem.papers.at(-1)).toMatchObject({ code: "inbox", category: "extra", required: false, status: "received" });
    expect(salem.papers.at(-1)!.files.map((f) => f.name)).toEqual(["تعريف جديد.pdf"]);
  });

  it("shows a nearly finished deal that never had its SIMAH report read", async () => {
    const fahad = await list("فهد");
    expect(fahad).toMatchObject({ required: 12, missing: 1, verified: 11, toCheck: 0 });
    expect(fahad.papers.find((p) => p.status === "missing" && p.required)!.code).toBe("simah");
  });

  it("asks an early deal with no property for less", async () => {
    const noura = await list("نورة");
    expect(noura.papers.filter((p) => p.required).map((p) => p.code)).toEqual(["id", "address", "simah", "obligations", "salary_cert", "bank_3", "agreement"]);
    expect(noura).toMatchObject({ required: 7, missing: 2, verified: 1, toCheck: 4 });
  });

  it("starts an untouched file with only the read report", async () => {
    const reem = await list("ريم");
    expect(reem).toMatchObject({ required: 8, missing: 7, verified: 1, toCheck: 0 });
    expect(reem.papers.every((p) => p.id === null)).toBe(true);
  });

  it("asks for more as the deal moves on", async () => {
    expect((await list("نورة")).papers.some((p) => p.code === "clearance")).toBe(false);
    await setDealStage(c.db, { dealId: deals["نورة"]!, stage: "clearance", actor: SYSTEM, now });
    expect(await paper("نورة", "clearance")).toMatchObject({ required: true, status: "missing" });
    expect((await list("نورة")).missing).toBe(3);
  });

  it("answers nothing for a deal that is not there", async () => {
    expect(await getPapers(c.db, { dealId: 99999, now })).toBeNull();
    expect(await clientOfDeal(c.db, 99999)).toBeNull();
    expect(await clientOfDeal(c.db, deals["ريم"]!)).toBe(people["ريم"]);
  });
});

describe("keeping a file", () => {
  const reem = () => people["ريم"]!;

  it("keeps it under its paper, by what its bytes say it is", async () => {
    const bytes = jpeg(1);
    const { fileId, added } = await addPaperFile(c.db, { clientId: reem(), code: "id", file: { name: "../IMG_0012.HEIC", bytes }, actor: SYSTEM, now });
    expect(added).toBe(true);
    const id = await paper("ريم", "id");
    expect(id).toMatchObject({ status: "received", note: null });
    expect(id.files).toEqual([{ id: fileId, name: "IMG_0012.jpg", kind: "jpeg", size: bytes.length }]);
    const [blob] = await c.db.select().from(fileBlobs).where(eq(fileBlobs.fileId, fileId));
    expect(new Uint8Array(blob!.data)).toEqual(bytes);
    expect(await lastAudit()).toMatchObject({ action: "doc.upload", entity: "client", entityId: reem(), details: { paper: "id", fileId, kind: "jpeg", size: bytes.length } });
    expect((await list("ريم")).missing).toBe(6);
  });

  it("keeps the same file once", async () => {
    const before = (await paper("ريم", "id")).files;
    const again = await addPaperFile(c.db, { clientId: reem(), code: "id", file: { name: "copy.jpg", bytes: jpeg(1) }, actor: SYSTEM, now });
    expect(again).toEqual({ fileId: before[0]!.id, added: false });
    expect((await paper("ريم", "id")).files).toEqual(before);
    // The same file under another paper is another file.
    expect((await addPaperFile(c.db, { clientId: reem(), code: "address", file: { name: "a.jpg", bytes: jpeg(1) }, actor: SYSTEM, now })).added).toBe(true);
  });

  it("refuses what is not a PDF or a picture, whatever it is called", async () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    await expect(addPaperFile(c.db, { clientId: reem(), code: "deed", file: { name: "deed.pdf", bytes: html }, actor: SYSTEM })).rejects.toMatchObject({ code: "FILE_TYPE" });
    await expect(addPaperFile(c.db, { clientId: reem(), code: "deed", file: { name: "deed.pdf", bytes: new Uint8Array() }, actor: SYSTEM })).rejects.toMatchObject({ code: "FILE_TYPE" });
    const big = new Uint8Array(FILE_MAX_BYTES + 1);
    big.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
    await expect(addPaperFile(c.db, { clientId: reem(), code: "deed", file: { name: "deed.pdf", bytes: big }, actor: SYSTEM })).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
    expect(await paper("ريم", "deed")).toMatchObject({ id: null, status: "missing", files: [] });
  });

  it("refuses a paper it does not know, and a client that is not there", async () => {
    const file = { name: "a.pdf", bytes: pdf("a") };
    await expect(addPaperFile(c.db, { clientId: reem(), code: "passport_photo", file, actor: SYSTEM })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(addPaperFile(c.db, { clientId: reem(), code: "custom:nothere", file, actor: SYSTEM })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(addPaperFile(c.db, { clientId: 99999, code: "id", file, actor: SYSTEM })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // The SIMAH report is read, not only kept: it enters through the credit record.
    await expect(addPaperFile(c.db, { clientId: reem(), code: "simah", file, actor: SYSTEM })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("holds so many files and no more", async () => {
    for (let n = 0; n < PAPER_MAX_FILES; n++) {
      await addPaperFile(c.db, { clientId: reem(), code: "bank_3", file: { name: `صفحة ${n + 1}.jpg`, bytes: jpeg(100 + n) }, actor: SYSTEM, now });
    }
    await expect(addPaperFile(c.db, { clientId: reem(), code: "bank_3", file: { name: "زائدة.jpg", bytes: jpeg(999) }, actor: SYSTEM })).rejects.toMatchObject({ code: "FILE_LIMIT" });
    expect((await paper("ريم", "bank_3")).files).toHaveLength(PAPER_MAX_FILES);
  });
});

describe("judging a paper", () => {
  const reem = () => people["ريم"]!;

  it("says it is good, and takes that back when the files change", async () => {
    const id = await paper("ريم", "id");
    await reviewPaper(c.db, { clientId: reem(), paperId: id.id!, review: { verdict: "verified" }, actor: SYSTEM, now });
    expect(await paper("ريم", "id")).toMatchObject({ status: "verified" });
    expect(await lastAudit()).toMatchObject({ action: "doc.review", details: { paper: "id", verdict: "verified" } });
    await addPaperFile(c.db, { clientId: reem(), code: "id", file: { name: "الوجه الآخر.jpg", bytes: jpeg(2) }, actor: SYSTEM, now });
    expect(await paper("ريم", "id")).toMatchObject({ status: "received" });
  });

  it("sends it back with the reason, until a new file arrives", async () => {
    const id = await paper("ريم", "id");
    await expect(reviewPaper(c.db, { clientId: reem(), paperId: id.id!, review: { verdict: "rejected", note: " " }, actor: SYSTEM })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(reviewPaper(c.db, { clientId: reem(), paperId: id.id!, review: { verdict: "maybe" }, actor: SYSTEM })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await reviewPaper(c.db, { clientId: reem(), paperId: id.id!, review: { verdict: "rejected", note: "  الصورة غير واضحة " }, actor: SYSTEM, now });
    expect(await paper("ريم", "id")).toMatchObject({ status: "rejected", note: "الصورة غير واضحة" });
    const owed = (await list("ريم")).missing;

    // Removing the bad files leaves it sent back: the reason still stands.
    expect(id.files).toHaveLength(2);
    await removePaperFile(c.db, { clientId: reem(), fileId: id.files[0]!.id, actor: SYSTEM, now });
    expect(await paper("ريم", "id")).toMatchObject({ status: "rejected", note: "الصورة غير واضحة" });
    await removePaperFile(c.db, { clientId: reem(), fileId: id.files[1]!.id, actor: SYSTEM, now });
    expect(await paper("ريم", "id")).toMatchObject({ status: "rejected", note: "الصورة غير واضحة", files: [] });
    expect((await list("ريم")).missing).toBe(owed);

    await addPaperFile(c.db, { clientId: reem(), code: "id", file: { name: "واضحة.jpg", bytes: jpeg(3) }, actor: SYSTEM, now });
    expect(await paper("ريم", "id")).toMatchObject({ status: "received", note: null });
    expect((await list("ريم")).missing).toBe(owed - 1);
  });

  it("judges only a paper that has files, and never the SIMAH report", async () => {
    const { paperId } = await addPaper(c.db, { clientId: reem(), label: "فحص طبي", actor: SYSTEM, now });
    await expect(reviewPaper(c.db, { clientId: reem(), paperId, review: { verdict: "verified" }, actor: SYSTEM })).rejects.toMatchObject({ code: "PAPER_EMPTY" });
    await expect(reviewPaper(c.db, { clientId: people["سالم"]!, paperId, review: { verdict: "verified" }, actor: SYSTEM })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await removePaper(c.db, { clientId: reem(), paperId, actor: SYSTEM });
  });
});

describe("removing a file", () => {
  it("leaves the paper missing when it was the last, and waiting when others remain", async () => {
    const reem = people["ريم"]!;
    const address = await paper("ريم", "address");
    await removePaperFile(c.db, { clientId: reem, fileId: address.files[0]!.id, actor: SYSTEM, now });
    expect(await paper("ريم", "address")).toMatchObject({ status: "missing", files: [] });
    expect(await lastAudit()).toMatchObject({ action: "doc.remove", details: { paper: "address", fileId: address.files[0]!.id } });
    expect(await c.db.select().from(fileBlobs).where(eq(fileBlobs.fileId, address.files[0]!.id))).toHaveLength(0);

    const bank = await paper("ريم", "bank_3");
    await reviewPaper(c.db, { clientId: reem, paperId: bank.id!, review: { verdict: "verified" }, actor: SYSTEM, now });
    await removePaperFile(c.db, { clientId: reem, fileId: bank.files[0]!.id, actor: SYSTEM, now });
    expect(await paper("ريم", "bank_3")).toMatchObject({ status: "received" });
    expect((await paper("ريم", "bank_3")).files).toHaveLength(PAPER_MAX_FILES - 1);
  });

  it("refuses a file of another client", async () => {
    const file = (await paper("سالم", "deed")).files[0]!;
    await expect(removePaperFile(c.db, { clientId: people["ريم"]!, fileId: file.id, actor: SYSTEM })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await paper("سالم", "deed")).files).toHaveLength(1);
  });
});

describe("a paper a person added", () => {
  it("is owed until it arrives, and goes only when it is empty", async () => {
    const reem = people["ريم"]!;
    const before = await list("ريم");
    await expect(addPaper(c.db, { clientId: reem, label: " ", actor: SYSTEM })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(addPaper(c.db, { clientId: 99999, label: "فحص طبي", actor: SYSTEM })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { paperId, code } = await addPaper(c.db, { clientId: reem, label: "  فحص طبي ", actor: SYSTEM, now });
    expect(code).toMatch(/^custom:[0-9a-f]{12}$/);
    expect(await paper("ريم", code)).toMatchObject({ id: paperId, label: "فحص طبي", required: true, status: "missing", category: "extra" });
    expect((await list("ريم")).missing).toBe(before.missing + 1);

    const { fileId } = await addPaperFile(c.db, { clientId: reem, code, file: { name: "الفحص.pdf", bytes: pdf("exam") }, actor: SYSTEM, now });
    expect((await list("ريم")).missing).toBe(before.missing);
    await expect(removePaper(c.db, { clientId: reem, paperId, actor: SYSTEM })).rejects.toMatchObject({ code: "PAPER_HAS_FILES" });
    await removePaperFile(c.db, { clientId: reem, fileId, actor: SYSTEM, now });
    await removePaper(c.db, { clientId: reem, paperId, actor: SYSTEM });
    expect((await list("ريم")).papers.some((p) => p.code === code)).toBe(false);
    expect(await lastAudit()).toMatchObject({ action: "doc.drop", details: { paper: code } });
  });

  it("never removes a paper the engine knows", async () => {
    const deed = await paper("سالم", "deed");
    await expect(removePaper(c.db, { clientId: people["سالم"]!, paperId: deed.id!, actor: SYSTEM })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("opening a file", () => {
  it("gives back exactly what was kept, and records who opened it", async () => {
    const bytes = pdf("the deed of nobody");
    const { fileId } = await addPaperFile(c.db, { clientId: people["ريم"]!, code: "deed", file: { name: "الصك.pdf", bytes }, actor: SYSTEM, now });
    const opened = (await openPaperFile(c.db, { fileId, actor: { userId: null, ip: "10.0.0.7" } }))!;
    expect(opened).toMatchObject({ clientId: people["ريم"], name: "الصك.pdf", kind: "pdf" });
    expect(opened.bytes).toEqual(bytes);
    expect(await lastAudit()).toMatchObject({ action: "doc.open", entityId: people["ريم"], ip: "10.0.0.7", details: { paper: "deed", fileId } });
    expect(await openPaperFile(c.db, { fileId: 99999, actor: SYSTEM })).toBeNull();
  });

  it("opens the demo's made-up papers as PDFs", async () => {
    const file = (await paper("سالم", "deed")).files[0]!;
    const opened = (await openPaperFile(c.db, { fileId: file.id, actor: SYSTEM }))!;
    const text = new TextDecoder().decode(opened.bytes);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("Made-up data");
    expect(Number(/startxref\n(\d+)/.exec(text)![1])).toBe(text.indexOf("xref\n0 6"));
  });
});

describe("the SIMAH report", () => {
  const reading = { confidence: "high", warnings: [], report: { ...emptyReport(), reportDate: "2026/11/20", reportMonthsAgo: 0 } };

  it("keeps the PDF it was read from with the client's papers", async () => {
    const fahad = people["فهد"]!;
    expect(await paper("فهد", "simah")).toMatchObject({ status: "missing", files: [] });
    const bytes = pdf("simah of nobody");
    const { reportId } = await addCreditReport(c.db, { consent: true, clientId: fahad, reading, file: { name: "SIMAH Report.pdf", bytes }, actor: SYSTEM, now });
    const simah = await paper("فهد", "simah");
    expect(simah).toMatchObject({ status: "verified" });
    expect(simah.files.map((f) => f.name)).toEqual(["SIMAH Report.pdf"]);
    const [row] = await c.db.select().from(creditReports).where(eq(creditReports.id, reportId));
    expect(row!.fileId).toBe(simah.files[0]!.id);
    expect((await list("فهد")).missing).toBe(0);

    // The same PDF read again is one file, and both readings point to it.
    const again = await addCreditReport(c.db, { consent: true, clientId: fahad, reading, file: { name: "again.pdf", bytes }, actor: SYSTEM, now });
    expect((await c.db.select().from(creditReports).where(eq(creditReports.id, again.reportId)))[0]!.fileId).toBe(simah.files[0]!.id);
    expect((await paper("فهد", "simah")).files).toHaveLength(1);
  });

  it("lets the oldest file go when the paper is full, and keeps reading", async () => {
    const fahad = people["فهد"]!;
    const first = (await paper("فهد", "simah")).files[0]!.id;
    for (let n = 0; n < PAPER_MAX_FILES; n++) {
      await addCreditReport(c.db, { consent: true, clientId: fahad, reading, file: { name: `r${n}.pdf`, bytes: pdf(`reading ${n}`) }, actor: SYSTEM, now });
    }
    const files = (await paper("فهد", "simah")).files;
    expect(files).toHaveLength(PAPER_MAX_FILES);
    expect(files.some((f) => f.id === first)).toBe(false);
    // The readings that pointed to the file that went stay, without it.
    const rows = await c.db.select({ fileId: creditReports.fileId }).from(creditReports).where(eq(creditReports.clientId, fahad));
    expect(rows).toHaveLength(PAPER_MAX_FILES + 2);
    expect(rows.filter((r) => r.fileId == null)).toHaveLength(2);
  });

  it("refuses a report whose file is not a PDF or a picture, and stores nothing", async () => {
    const reem = people["ريم"]!;
    const before = await c.db.select({ id: creditReports.id }).from(creditReports).where(eq(creditReports.clientId, reem));
    await expect(addCreditReport(c.db, { consent: true, clientId: reem, reading, file: { name: "x.pdf", bytes: new TextEncoder().encode("not a pdf") }, actor: SYSTEM })).rejects.toMatchObject({ code: "FILE_TYPE" });
    expect(await c.db.select({ id: creditReports.id }).from(creditReports).where(eq(creditReports.clientId, reem))).toHaveLength(before.length);
  });
});

describe("the tables", () => {
  it("keeps one row for a paper of a client", async () => {
    const reem = people["ريم"]!;
    await expect(c.db.insert(documents).values({ clientId: reem, code: "id" })).rejects.toThrow();
  });

  it("removes a client's papers, files and their contents with the client", async () => {
    const [client] = await c.db.insert(clients).values({ fileNo: "C-950", fullName: "عميل تجريبي" }).returning();
    const { fileId } = await addPaperFile(c.db, { clientId: client!.id, code: "id", file: { name: "a.pdf", bytes: pdf("x") }, actor: SYSTEM });
    await c.db.delete(clients).where(eq(clients.id, client!.id));
    expect(await c.db.select().from(documentFiles).where(eq(documentFiles.id, fileId))).toHaveLength(0);
    expect(await c.db.select().from(fileBlobs).where(eq(fileBlobs.fileId, fileId))).toHaveLength(0);
    const orphans = await c.db.execute(sql`select count(*)::int as n from masar.file_blobs b left join masar.document_files f on f.id = b.file_id where f.id is null`);
    const rows = (Array.isArray(orphans) ? orphans : (orphans as { rows: unknown[] }).rows) as { n: number }[];
    expect(rows[0]!.n).toBe(0);
  });
});
