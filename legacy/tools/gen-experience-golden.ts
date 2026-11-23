// Generates tests/golden/experience.json: what the old system said its recorded outcomes add up to.
// The old function reads its rows from a database, so this runs it on an in-memory Postgres that the
// old data layer fills itself. Each book is a set of made-up decisions and one question about them.
// The new `experience` in src/domain/knowledge must reproduce every answer.
// Run with: npm run golden:experience
import fs from "node:fs";
import path from "node:path";
import { all, run } from "../lib/db";
import { lenderExperience } from "../lib/data";

const SEED = 20261126;
const BOOKS = 80;

let state = SEED >>> 0;
const rand = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const chance = (p: number) => rand() < p;
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const money = (lo: number, hi: number, step = 1000) => Math.round((lo + rand() * (hi - lo)) / step) * step;

const KINDS = ["personal", "personal", "mortgage", "auto"] as const;
const SECTORS = ["gov", "gov", "semi_gov", "private_approved", "private", "military", "retired", "self"] as const;
const DECISIONS = ["approved", "approved", "approved_modified", "rejected"] as const;
// The last two are not on the old list: a code nobody knows is still counted.
const CONDITIONS = ["medical", "guarantor", "salary_transfer", "employer_letter", "gosi_match", "extra_statements", "down_payment", "insurance", "buyout", "simah_letter", "lower_amount", "shorter_tenor", "valuation", "employer_classification", "other", "site_visit", "second_valuer"];
const REASONS = ["dbr", "simah", "employer", "service", "age", "nationality", "income_verification", "property", "policy", "documents", "other"];

interface Row {
  lenderId: number;
  financeType: string;
  sector: string;
  salary: number | null;
  decision: string;
  estimatedAmount: number | null;
  approvedAmount: number | null;
  conditions: string[];
  reason: string | null;
}

function row(lenders: number[]): Row {
  const decision = pick(DECISIONS);
  const refused = decision === "rejected";
  const estimated = chance(0.25) ? null : money(40000, 1500000);
  const conditions = Array.from({ length: chance(0.4) ? 0 : int(1, 3) }, () => pick(CONDITIONS));
  return {
    lenderId: pick(lenders),
    financeType: pick(KINDS),
    sector: pick(SECTORS),
    salary: chance(0.15) ? null : money(3000, 40000, 500),
    decision,
    estimatedAmount: estimated,
    // A refusal sometimes carries an amount someone typed anyway, and an approval sometimes carries none.
    approvedAmount: refused ? (chance(0.1) ? money(20000, 900000) : null) : chance(0.15) ? null : estimated ? Math.round((estimated * (0.6 + rand() * 0.7)) / 1000) * 1000 : money(40000, 1500000),
    conditions: [...new Set(conditions)],
    // A reason is read only on a refusal, whatever was typed.
    reason: refused ? (chance(0.8) ? pick(REASONS) : null) : chance(0.1) ? pick(REASONS) : null,
  };
}

(async () => {
  const lenders = (await all<{ id: number }>("SELECT id FROM lenders ORDER BY id")).map((l) => l.id);
  if (lenders.length < 6) throw new Error("the old catalogue did not load");
  const books = [];
  for (let b = 0; b < BOOKS; b++) {
    // A small office and a busy one: few lenders with many decisions each, or many with few.
    const some = chance(0.5) ? lenders.slice(0, int(1, 4)) : lenders;
    const rows = Array.from({ length: b === 0 ? 0 : int(1, 45) }, () => row(some));
    const ask = { financeType: pick(KINDS), sector: chance(0.4) ? null : pick(SECTORS), salary: chance(0.4) ? null : money(3000, 40000, 500) };
    // The old query has no ORDER BY. On an emptied table each lender's rows come back in the order
    // they went in, which is what decides a tie between two conditions asked equally often.
    await run("TRUNCATE outcomes");
    for (const r of rows) {
      await run(
        "INSERT INTO outcomes (lender_id, finance_type, sector, salary, decision, estimated_amount, approved_amount, conditions, reason) VALUES (?,?,?,?,?,?,?,?,?)",
        r.lenderId, r.financeType, r.sector, r.salary, r.decision, r.estimatedAmount, r.approvedAmount, JSON.stringify(r.conditions), r.reason,
      );
    }
    const stored = await all<{ n: number }>("SELECT COUNT(*) n FROM outcomes");
    if (Number(stored[0]?.n) !== rows.length) throw new Error("the rows were not stored");
    const answer = await lenderExperience(ask.financeType, ask.sector ?? undefined, ask.salary);
    // Which lender comes first is the database's choice, so the answers are kept lender by lender.
    books.push({ rows, ask, expected: [...answer.values()].sort((x, y) => x.lenderId - y.lenderId) });
  }
  const out = path.join(import.meta.dirname, "../../tests/golden/experience.json");
  fs.writeFileSync(out, `{"seed":${SEED},"books":[\n${books.map((c) => JSON.stringify(c)).join(",\n")}\n]}\n`);
  const answers = books.flatMap((c) => c.expected);
  console.log(`${books.length} books, ${books.reduce((n, c) => n + c.rows.length, 0)} decisions -> ${out} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
  console.log("lenders answered:", answers.length, "with a ratio:", answers.filter((e) => e.ratio != null).length, "with reasons:", answers.filter((e) => e.reasons.length).length);
  console.log("books with nothing of the kind asked:", books.filter((c) => !c.expected.length).length);
  console.log("ties in conditions:", answers.filter((e) => e.conditions.some(([, n], i) => i > 0 && e.conditions[i - 1][1] === n)).length);
  process.exit(0);
})();
