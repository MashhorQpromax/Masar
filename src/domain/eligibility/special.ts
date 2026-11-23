/**
 * A lender's special conditions: what it asks beyond the terms every product has.
 *
 * A product has a fixed set of terms: a salary, an age, a margin. Lenders ask for more than that, and
 * each asks for something else: no less than an amount, no more than so many credit inquiries, a
 * contract of a certain kind, an employer on their list, a guarantor. The office writes each one
 * down as it learns it, and the list as a whole is one term of the product (`special`): until the
 * lender confirmed it, nobody knows that the list is complete, whatever it holds.
 *
 * Three kinds are measured from what the file and the record say. The others are a question about
 * the client that a person answers, and until they do the condition is not met.
 *
 * Everything in this module is pure: no database, no clock, no text in any language.
 */
import type { CheckStatus } from "./types";

/** How the client is employed. The office picks one; what a lender makes of it is that lender's condition. */
export const CONTRACT_TYPES = ["permanent", "fixed_term", "probation"] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

/** Conditions the engine measures itself. */
export const MEASURED_KINDS = ["min_amount", "inquiries", "contract"] as const;
/** Conditions a person answers for each client. */
export const ASKED_KINDS = ["employer", "guarantor", "collateral", "other"] as const;
export const SPECIAL_KINDS = [...MEASURED_KINDS, ...ASKED_KINDS] as const;
export type AskedKind = (typeof ASKED_KINDS)[number];
export type SpecialKind = (typeof SPECIAL_KINDS)[number];

/** The windows a lender counts credit inquiries in, months. They are the two a SIMAH report gives. */
export const INQUIRY_WINDOWS = [6, 12] as const;
export type InquiryWindow = (typeof INQUIRY_WINDOWS)[number];

/** What it means when the client does not meet a condition a person answers: the lender refuses, or the client has something to do. */
export type Unmet = "block" | "action";

/** What a person answered about one client and one condition. No answer is not an answer. */
export type Answer = "met" | "unmet";

export type SpecialCondition = { id: string } & (
  | { kind: "min_amount"; amount: number }
  | { kind: "inquiries"; count: number; months: InquiryWindow }
  | { kind: "contract"; contracts: ContractType[] }
  | { kind: AskedKind; text: string | null; unmet: Unmet }
);

/** A condition as a person writes it, before it has a place in a list. */
export type NewCondition = SpecialCondition extends infer C ? (C extends unknown ? Omit<C, "id"> : never) : never;

/** The longest a person's words about a condition may be. */
export const CONDITION_TEXT_MAX = 160;
/** The most inquiries a limit can name. */
export const INQUIRIES_MAX = 50;

/** A stored kind of contract, when it is one of the kinds the office picks from. */
export function contractOf(value: string | null | undefined): ContractType | null {
  return (CONTRACT_TYPES as readonly string[]).includes(value ?? "") ? (value as ContractType) : null;
}

/** Why a condition cannot join a list. */
export type ConditionProblem = "TWICE" | "ABOVE_MOST" | "EVERY_CONTRACT" | "NOTHING_SAID";

const said = (text: string | null): string => (text ?? "").replace(/\s+/g, " ").trim();

/**
 * Why a condition cannot be added to a product's list. Null when it can. A list says each thing
 * once: one minimum, one limit of inquiries for each window, one condition on the contract, and no
 * question asked twice in the same words.
 */
export function conditionProblem(list: readonly SpecialCondition[], next: NewCondition, product: { maxAmount: number }): ConditionProblem | null {
  if (next.kind === "min_amount") {
    if (list.some((c) => c.kind === "min_amount")) return "TWICE";
    // A minimum above the most the product lends would leave nothing it could lend.
    return next.amount > product.maxAmount ? "ABOVE_MOST" : null;
  }
  if (next.kind === "inquiries") return list.some((c) => c.kind === "inquiries" && c.months === next.months) ? "TWICE" : null;
  if (next.kind === "contract") {
    if (list.some((c) => c.kind === "contract")) return "TWICE";
    // A lender that takes every kind of contract asks nothing.
    return CONTRACT_TYPES.every((contract) => next.contracts.includes(contract)) || !next.contracts.length ? "EVERY_CONTRACT" : null;
  }
  if (next.kind === "other" && !said(next.text)) return "NOTHING_SAID";
  return list.some((c) => c.kind === next.kind && said(c.text) === said(next.text)) ? "TWICE" : null;
}

/** How many credit inquiries the record shows. A count the report does not give is null. */
export interface Inquiries {
  m6: number | null;
  m12: number | null;
}

/** What is known about the client that a special condition is held against. */
export interface SpecialFacts {
  /** What the product would lend the client here. */
  amount: number;
  /** The most it could lend them. */
  most: number;
  contract: ContractType | null | undefined;
  /** The contract does not apply: a pensioner, or someone who works for themselves. */
  noContract: boolean;
  /** Null or absent when no record was read. */
  inquiries: Inquiries | null | undefined;
  /** A person's answers for this client, by the condition's id. */
  answers: Readonly<Record<string, Answer>> | undefined;
}

/** One special condition held against the client. `ref` names the condition, so two of one kind stay two. */
export type SpecialCheck = { key: "special"; status: CheckStatus } & (
  | { code: "SPECIAL_LIST"; params: { count: number } }
  | { code: "AMOUNT_MIN"; ref: string; params: { min: number; amount: number } }
  | { code: "INQUIRIES"; ref: string; params: { count: number; max: number; months: InquiryWindow } }
  | { code: "INQUIRIES_UNKNOWN"; params: Record<string, never> }
  | { code: "CONTRACT"; ref: string; params: { contract: ContractType } }
  | { code: "CONTRACT_MISSING"; params: Record<string, never> }
  | { code: "ASKED"; ref: string; params: { kind: AskedKind; text: string | null } }
  | { code: "ASKED_OPEN"; ref: string; params: { kind: AskedKind; text: string | null } }
);

const isAsked = (condition: SpecialCondition): condition is Extract<SpecialCondition, { kind: AskedKind }> => (ASKED_KINDS as readonly string[]).includes(condition.kind);

/** The conditions of a list that a person answers for each client. */
export function askedOf(conditions: readonly SpecialCondition[] | undefined): Extract<SpecialCondition, { kind: AskedKind }>[] {
  return (conditions ?? []).filter(isAsked);
}

/**
 * The question every product raises whatever its list holds: is the list itself confirmed? It is
 * always met as written, so only the standing of the `special` term decides what it says.
 */
export function listCheck(conditions: readonly SpecialCondition[] | undefined): SpecialCheck {
  return { key: "special", status: "pass", code: "SPECIAL_LIST", params: { count: conditions?.length ?? 0 } };
}

/** Holds each special condition against what is known about the client. A fact that is missing is never a pass. */
export function specialChecks(conditions: readonly SpecialCondition[] | undefined, facts: SpecialFacts): SpecialCheck[] {
  const checks: SpecialCheck[] = [];
  for (const condition of conditions ?? []) {
    const ref = condition.id;
    if (condition.kind === "min_amount") {
      // Asking for more can reach the minimum only when the lender would lend that much.
      const status: CheckStatus = facts.amount >= condition.amount ? "pass" : facts.most >= condition.amount ? "warn" : "fail";
      checks.push({ key: "special", status, code: "AMOUNT_MIN", ref, params: { min: condition.amount, amount: facts.amount } });
    } else if (condition.kind === "inquiries") {
      const count = condition.months === 6 ? facts.inquiries?.m6 : facts.inquiries?.m12;
      if (count == null) {
        if (!checks.some((check) => check.code === "INQUIRIES_UNKNOWN")) checks.push({ key: "special", status: "warn", code: "INQUIRIES_UNKNOWN", params: {} });
      } else checks.push({ key: "special", status: count <= condition.count ? "pass" : "fail", code: "INQUIRIES", ref, params: { count, max: condition.count, months: condition.months } });
    } else if (condition.kind === "contract") {
      if (facts.noContract) continue;
      if (!facts.contract) {
        if (!checks.some((check) => check.code === "CONTRACT_MISSING")) checks.push({ key: "special", status: "warn", code: "CONTRACT_MISSING", params: {} });
      } else checks.push({ key: "special", status: condition.contracts.includes(facts.contract) ? "pass" : "fail", code: "CONTRACT", ref, params: { contract: facts.contract } });
    } else {
      const answer = facts.answers?.[condition.id];
      const params = { kind: condition.kind, text: condition.text };
      if (!answer) checks.push({ key: "special", status: "warn", code: "ASKED_OPEN", ref, params });
      else checks.push({ key: "special", status: answer === "met" ? "pass" : condition.unmet === "action" ? "warn" : "fail", code: "ASKED", ref, params });
    }
  }
  return checks;
}
