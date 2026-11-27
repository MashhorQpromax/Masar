import type { Stated } from "./facts";
import type { FileKind } from "./files";
import { INBOX_PAPER, isCustomCode, isPaperCode, PAPER_CATEGORIES, PAPERS, paperSource, SIMAH_PAPER, type PaperCategory, type PaperNeed, type PaperSource } from "./papers";

/**
 * Where a paper stands. It follows its files: nothing kept is missing, something kept has arrived.
 * A person who may verify then says it is good, or sends it back with the reason.
 */
export const PAPER_STATUSES = ["missing", "received", "verified", "rejected"] as const;
export type PaperStatus = (typeof PAPER_STATUSES)[number];

export interface PaperFile {
  id: number;
  name: string;
  kind: FileKind;
  size: number;
}

/** A paper as it is stored, once anything happened to it. */
export interface KeptPaper {
  id: number;
  code: string;
  /** The name a person gave a paper they added. Null for a paper known by its code. */
  label: string | null;
  status: PaperStatus;
  /** Why it was sent back. */
  note: string | null;
  files: PaperFile[];
  /** The figures a person wrote down from it when they checked it. Empty unless it stands as verified. */
  stated?: Stated;
}

export interface Paper {
  /** The stored row. Null while nothing has happened to the paper yet. */
  id: number | null;
  code: string;
  label: string | null;
  category: PaperCategory;
  /** The file is not complete without it. */
  required: boolean;
  /** The deal asks for it as it stands now. False for a paper kept from before that it no longer asks for. */
  asked: boolean;
  /** Who brings it: the client, or the office itself. */
  by: PaperSource;
  status: PaperStatus;
  note: string | null;
  files: PaperFile[];
  /** The figures a person wrote down from it when they checked it. Empty unless it stands as verified. */
  stated: Stated;
}

export interface Checklist {
  /** Every paper of the file, in the order of the groups. */
  papers: Paper[];
  /** How many papers the file is not complete without. */
  required: number;
  /** Required papers that have not arrived, or were sent back. */
  missing: number;
  /** Required papers that were verified. */
  verified: number;
  /** Papers that arrived and wait for someone to look at them. */
  toCheck: number;
}

const blank = { id: null, label: null, status: "missing", note: null, files: [], stated: {} } satisfies Partial<Paper>;

/**
 * The file of a client against what the deal needs: every needed paper with where it stands, then the
 * papers a person added, then anything kept that the deal no longer asks for, and last what arrived
 * by WhatsApp and is not under a paper yet.
 *
 * The SIMAH report counts as verified once it was read into the credit record: reading it is the check.
 */
export function checklist(needs: readonly PaperNeed[], kept: readonly KeptPaper[], facts: { creditRead: boolean }): Checklist {
  const byCode = new Map(kept.map((paper) => [paper.code, paper]));
  const papers: Paper[] = needs.map((need) => ({ ...blank, ...byCode.get(need.code), ...need, asked: true, by: paperSource(need.code) }));
  const asked = new Set<string>(needs.map((need) => need.code));

  for (const paper of kept) {
    if (asked.has(paper.code)) continue;
    // Added by a person: it is needed until they remove it.
    if (isCustomCode(paper.code)) papers.push({ ...paper, stated: {}, category: "extra", required: true, asked: true, by: "client" });
    else if (isPaperCode(paper.code) && paper.files.length > 0) papers.push({ ...paper, stated: paper.stated ?? {}, category: PAPERS[paper.code], required: false, asked: false, by: paperSource(paper.code) });
    // What arrived by WhatsApp and waits to be put under its paper.
    else if (paper.code === INBOX_PAPER && paper.files.length > 0) papers.push({ ...paper, stated: {}, status: "received", note: null, category: "extra", required: false, asked: false, by: "client" });
  }

  for (const paper of papers) {
    if (paper.code === SIMAH_PAPER && facts.creditRead) Object.assign(paper, { status: "verified", note: null });
  }

  const rank = (paper: Paper) => PAPER_CATEGORIES.indexOf(paper.category);
  const sorted = papers.map((paper, index) => ({ paper, index })).sort((a, b) => rank(a.paper) - rank(b.paper) || a.index - b.index);
  const list = sorted.map((entry) => entry.paper);
  const required = list.filter((paper) => paper.required);
  return {
    papers: list,
    required: required.length,
    missing: required.filter((paper) => paper.status === "missing" || paper.status === "rejected").length,
    verified: required.filter((paper) => paper.status === "verified").length,
    toCheck: list.filter((paper) => paper.status === "received").length,
  };
}
