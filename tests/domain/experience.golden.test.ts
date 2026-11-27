import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acceptance, experience, type DecisionFact, type Experience, type Like } from "@/domain/knowledge";

/**
 * The old system added its recorded decisions up from a database. The generator ran it on made-up
 * decisions (`npm run golden:experience`); the new pure function must give the same answers.
 */
interface Book {
  rows: DecisionFact[];
  ask: { financeType: string; sector: string | null; salary: number | null };
  expected: Experience[];
}

const { books } = JSON.parse(readFileSync(path.join(import.meta.dirname, "../golden/experience.json"), "utf8")) as { books: Book[] };

describe("what recorded decisions add up to, against the old system", () => {
  it("has books worth testing", () => {
    expect(books.length).toBe(80);
    expect(books.reduce((n, book) => n + book.rows.length, 0)).toBeGreaterThan(1500);
    expect(books.some((book) => !book.expected.length)).toBe(true);
    expect(books.some((book) => book.expected.some((e) => e.ratio != null))).toBe(true);
    expect(books.some((book) => book.expected.some((e) => e.similarN < e.n))).toBe(true);
  });

  it.each(books.map((book, index) => [index, book] as const))("book %i", (_index, book) => {
    const like: Like = { sector: book.ask.sector, salary: book.ask.salary };
    const before = JSON.stringify(book.rows);
    const answer = experience(book.rows, book.ask.financeType, like);
    // The old answers are kept lender by lender. The new ones come in the order lenders first appear.
    expect([...answer.values()].sort((a, b) => a.lenderId - b.lenderId)).toEqual(book.expected);
    expect([...answer.keys()]).toEqual([...new Set(book.rows.filter((row) => row.financeType === book.ask.financeType).map((row) => row.lenderId))]);
    expect(JSON.stringify(book.rows)).toBe(before);
  });

  it("counts every decision of the kind asked exactly once", () => {
    for (const book of books) {
      const answer = [...experience(book.rows, book.ask.financeType).values()];
      const ofKind = book.rows.filter((row) => row.financeType === book.ask.financeType);
      expect(answer.reduce((n, e) => n + e.n, 0)).toBe(ofKind.length);
      for (const e of answer) {
        expect(e.approved + e.rejected).toBe(e.n);
        // With nobody asked about, every decision is a similar one.
        expect(e.similarN).toBe(e.n);
        expect(e.similarApproved).toBe(e.approved);
        const share = acceptance(e);
        expect(share).toBe(Math.round((e.approved / e.n) * 100));
      }
    }
  });
});
