/**
 * What the office has learned about lenders, beyond their published terms.
 *
 * Two things are kept. A rule is something a person wrote down: a condition no brochure mentions, an
 * exception that worked, a way through, a warning. A decision is what a lender actually answered for
 * one client. Rules are read as written; decisions are added up into what a lender is like.
 *
 * Everything in this module is pure: no database, no clock, no text in any language.
 */
import type { FinanceType } from "../eligibility";
import type { Sector } from "../shared/sector";

export const RULE_KINDS = ["condition", "exception", "tip", "warning"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

/** One thing the office knows about a lender, or about every lender when it names none. */
export interface Rule {
  id: number;
  /** Null: it holds for every lender. */
  lenderId: number | null;
  lenderName: string | null;
  /** Null: it holds for every kind of finance. */
  financeType: FinanceType | null;
  kind: RuleKind;
  title: string;
  body: string | null;
  /** Who wrote it. Null for what the catalogue started with. */
  author: string | null;
  createdAt: Date;
}

/** The rules that bear on one lender for one kind of finance: its own first, then the ones written for every lender. */
export function rulesFor<R extends Pick<Rule, "lenderId" | "financeType">>(rules: readonly R[], on: { lenderId: number; financeType: FinanceType }): R[] {
  const bearing = rules.filter((rule) => (rule.lenderId == null || rule.lenderId === on.lenderId) && (rule.financeType == null || rule.financeType === on.financeType));
  return [...bearing.filter((rule) => rule.lenderId != null), ...bearing.filter((rule) => rule.lenderId == null)];
}

/** The rules of one lender, or the ones that name no lender. */
export interface RuleGroup<R> {
  lenderId: number | null;
  lenderName: string | null;
  rules: R[];
}

/** Rules lender by lender, in the order they are given. The ones that hold for every lender come first. */
export function rulesByLender<R extends Pick<Rule, "lenderId" | "lenderName">>(rules: readonly R[]): RuleGroup<R>[] {
  const groups = new Map<number | null, RuleGroup<R>>();
  for (const rule of rules) {
    const group = groups.get(rule.lenderId) ?? { lenderId: rule.lenderId, lenderName: rule.lenderName, rules: [] };
    group.rules.push(rule);
    groups.set(rule.lenderId, group);
  }
  const all = [...groups.values()];
  return [...all.filter((group) => group.lenderId == null), ...all.filter((group) => group.lenderId != null)];
}

export const DECISIONS = ["approved", "approved_modified", "rejected"] as const;
/** What a lender answered: yes as asked, yes on other terms, or no. */
export type Decision = (typeof DECISIONS)[number];

/** What a lender asked for before it said yes. */
export const ASKS = [
  "medical",
  "guarantor",
  "salary_transfer",
  "employer_letter",
  "gosi_match",
  "extra_statements",
  "down_payment",
  "insurance",
  "buyout",
  "simah_letter",
  "lower_amount",
  "shorter_tenor",
  "valuation",
  "employer_classification",
  "other",
] as const;
export type Ask = (typeof ASKS)[number];

/** Why a lender said no. */
export const REFUSALS = ["dbr", "simah", "employer", "service", "age", "nationality", "income_verification", "property", "policy", "documents", "other"] as const;
export type Refusal = (typeof REFUSALS)[number];

/** One recorded decision, as far as adding them up needs it. */
export interface DecisionFact {
  lenderId: number;
  financeType: string;
  sector: string;
  salary: number | null;
  decision: Decision;
  /** What the engine expected the lender to give. */
  estimatedAmount: number | null;
  approvedAmount: number | null;
  /** What the lender asked for. A code this build does not know is still counted. */
  conditions: readonly string[];
  reason: string | null;
}

/** What a lender's recorded decisions add up to for one kind of finance. */
export interface Experience {
  lenderId: number;
  /** Decisions recorded. */
  n: number;
  approved: number;
  rejected: number;
  /** Decisions for clients like the one asked about, and how many of those were a yes. */
  similarN: number;
  similarApproved: number;
  /** What the lender gave over what the engine expected, on average. Null when no yes carries both. */
  ratio: number | null;
  /** What it asked for, most often first. */
  conditions: [string, number][];
  /** Why it refused, most often first. */
  reasons: [string, number][];
}

/** A client is like another when their salaries are within this share of each other. */
export const SIMILAR_SALARY_BAND = 0.35;

/** Who the question is about. Left out, every decision counts as similar. */
export interface Like {
  sector?: Sector | string | null;
  salary?: number | null;
}

/**
 * Adds up the decisions recorded for one kind of finance, lender by lender, in the order each lender
 * first appears. Ties in what was asked and why it was refused keep the order they were first seen.
 */
export function experience(rows: readonly DecisionFact[], financeType: string, like: Like = {}): Map<number, Experience> {
  type Tally = Experience & { ratios: number[]; asked: Map<string, number>; refused: Map<string, number> };
  const tallies = new Map<number, Tally>();
  for (const row of rows) {
    if (row.financeType !== financeType) continue;
    let t = tallies.get(row.lenderId);
    if (!t) {
      t = { lenderId: row.lenderId, n: 0, approved: 0, rejected: 0, similarN: 0, similarApproved: 0, ratio: null, conditions: [], reasons: [], ratios: [], asked: new Map(), refused: new Map() };
      tallies.set(row.lenderId, t);
    }
    const yes = row.decision !== "rejected";
    t.n++;
    if (yes) t.approved++;
    else t.rejected++;
    const similar = (!like.sector || row.sector === like.sector) && (!like.salary || !row.salary || Math.abs(row.salary - like.salary) / like.salary <= SIMILAR_SALARY_BAND);
    if (similar) {
      t.similarN++;
      if (yes) t.similarApproved++;
    }
    if (yes && row.estimatedAmount && row.approvedAmount) t.ratios.push(row.approvedAmount / row.estimatedAmount);
    for (const code of row.conditions) t.asked.set(code, (t.asked.get(code) ?? 0) + 1);
    if (!yes && row.reason) t.refused.set(row.reason, (t.refused.get(row.reason) ?? 0) + 1);
  }
  const ranked = (counts: Map<string, number>): [string, number][] => [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const out = new Map<number, Experience>();
  for (const [lenderId, { ratios, asked, refused, ...rest }] of tallies) {
    out.set(lenderId, {
      ...rest,
      ratio: ratios.length ? Math.round((ratios.reduce((sum, r) => sum + r, 0) / ratios.length) * 100) / 100 : null,
      conditions: ranked(asked),
      reasons: ranked(refused),
    });
  }
  return out;
}

/** The share of decisions that were a yes, in whole percent. Null when nothing was recorded. */
export function acceptance(e: Pick<Experience, "n" | "approved">): number | null {
  return e.n ? Math.round((e.approved / e.n) * 100) : null;
}

/** Fewer decisions than this say little about a lender. */
export const FEW_DECISIONS = 3;

/** One part of a way to fund a deal, and the lender that gives it. */
export interface RoutePart {
  part: "mortgage" | "personal";
  lenderId: number;
}

/** What is known about the lender of one part: how it answered before, and what people wrote down about it. */
export interface Bearing<R> extends RoutePart {
  record: Experience | null;
  notes: R[];
}

/**
 * What the office knows about the lenders of one route, part by part. Only a lender's own notes count
 * here: the ones written for every lender say nothing about this route. A note that bears on both
 * parts is listed once, under the first. A part nothing is known about is left out.
 */
export function knownFor<R extends Pick<Rule, "id" | "lenderId" | "financeType">>(
  parts: readonly RoutePart[],
  rules: readonly R[],
  records: Record<RoutePart["part"], ReadonlyMap<number, Experience>>,
): Bearing<R>[] {
  const listed = new Set<number>();
  const out: Bearing<R>[] = [];
  for (const { part, lenderId } of parts) {
    const record = records[part].get(lenderId) ?? null;
    const notes = rulesFor(rules, { lenderId, financeType: part }).filter((rule) => rule.lenderId != null && !listed.has(rule.id));
    for (const rule of notes) listed.add(rule.id);
    if (record || notes.length) out.push({ part, lenderId, record, notes });
  }
  return out;
}
