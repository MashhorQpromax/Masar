import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeCredit, parseSimahPages } from "@/domain/credit";
import { parseReading } from "@/server/credit/input";
import { looksLikePdf, pdfPages } from "@/server/credit/pdf";

/**
 * The whole way from a file to a graded record.
 *
 * tests/fixtures/simah-made-up.pdf is the first made-up report of tests/golden/simah.json printed as a
 * real PDF (scripts/make-simah-pdf.cjs). No real person's report is in the repository. Read with the
 * PDF reader the upload uses, it must give the reading production gave for that text. The reader leans
 * on how this version of the PDF library lays text out, so this is the test that fails when it changes.
 */
const here = import.meta.dirname;
const pdf = new Uint8Array(readFileSync(path.join(here, "../fixtures/simah-made-up.pdf")));
const { today, cases } = JSON.parse(readFileSync(path.join(here, "../golden/simah.json"), "utf8")) as {
  today: string;
  cases: { pages: string[]; expected: { report: { facilities: unknown[]; judgments: unknown[] } } }[];
};
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("a report from its PDF", () => {
  it("is read page by page and gives the production reading", async () => {
    expect(looksLikePdf(pdf)).toBe(true);
    const pages = await pdfPages(pdf);
    expect(pages).toHaveLength(cases[0]!.pages.length);

    const reading = parseSimahPages(pages, today);
    expect(plain(reading)).toEqual(cases[0]!.expected);
    expect(reading.report.facilities.length).toBeGreaterThan(0);

    // And the storage takes it and the engine grades it.
    const kept = parseReading(plain(reading));
    expect(analyzeCredit(kept.report).grade).toBe("E");
  });

  it("tells a PDF from anything else by its first bytes", () => {
    expect(looksLikePdf(new TextEncoder().encode("%PDF-1.7\n"))).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode("PK\u0003\u0004 a zip"))).toBe(false);
    expect(looksLikePdf(new Uint8Array())).toBe(false);
  });

  it("fails on a file that only claims to be a PDF", async () => {
    await expect(pdfPages(new TextEncoder().encode("%PDF-1.4\nnot a real file\n"))).rejects.toBeDefined();
  });
});
