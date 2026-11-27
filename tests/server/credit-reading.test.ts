import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSimahPages } from "@/domain/credit";
import { parseReading } from "@/server/credit/input";

/**
 * The reader and the storage must agree: whatever the reader makes of a report, the storage takes.
 * Otherwise a real report would be read and then refused at the last step.
 */
const file = path.join(import.meta.dirname, "../golden/simah.json");
const { today, cases } = JSON.parse(readFileSync(file, "utf8")) as { today: string; cases: { pages: string[] }[] };

type Plain = { report: { inquiries?: { amount: number | null }[] } };

describe("what the reader hands over", () => {
  it("is taken by the storage for every stored text", () => {
    let blanked = 0;
    for (const c of cases) {
      const reading = JSON.parse(JSON.stringify(parseSimahPages(c.pages, today))) as Plain;
      const kept = parseReading(reading);
      // Only one thing may differ: an inquiry amount glued to its neighbour, which nothing counts, is left blank.
      for (const inquiry of reading.report.inquiries ?? []) {
        if (inquiry.amount != null && inquiry.amount > 10_000_000_000) {
          inquiry.amount = null;
          blanked++;
        }
      }
      expect(kept).toEqual(reading);
    }
    expect(blanked).toBeGreaterThan(0);
  });
});
