import "server-only";
import { and, count, eq, gt, sql } from "drizzle-orm";
import { dealTimeline, stationTimeline, type Stage, type StationKey, type StationState } from "@/domain/deal";
import { INBOX_PAPER, type Paper, type PaperStatus } from "@/domain/documents";
import { clientFacts, messageGate, type ClientFacts, type ClientOffer } from "@/domain/messages";
import type { Db, Tx } from "../db/client";
import { auditLog } from "../db/schema";
import { getDeal } from "../deals/service";
import { keepFile, papersOf, whoOf, type PaperWho } from "../documents/service";
import { DomainError } from "../shared/errors";
import { countView, dealOfClient, reachable, readLink } from "./links";
import { offerOf } from "./service";

/** Files one client may send through their link in a day. A client's file has some fifteen papers. */
export const PORTAL_DAILY_FILES = 60;

/** A paper as the client sees it: what it is and whether it reached the office. Never its files. */
export interface PortalPaper {
  code: string;
  label: string | null;
  status: PaperStatus;
  /** Why it was sent back. */
  note: string | null;
  files: number;
}

/** Everything the client's own page shows. It is built from what a client may know and nothing else. */
export interface PortalView {
  clientName: string;
  fileNo: string;
  who: PaperWho;
  expiresAt: Date;
  stage: Stage;
  steps: { key: StationKey; state: StationState }[];
  /** The plan and its amounts. Null while the study has nothing firm to say. */
  facts: ClientFacts | null;
  /** The final offer, with the office's fee in detail. Null until the deal's fee plan stands approved. */
  offer: ClientOffer | null;
  /** The client's own papers still owed. */
  owed: PortalPaper[];
  /** The client's own papers that reached the office. */
  arrived: PortalPaper[];
}

const portalPaper = (paper: Paper): PortalPaper => ({ code: paper.code, label: paper.label, status: paper.status, note: paper.note, files: paper.files.length });

/** The client's side of a file: the papers they bring, without the tray of unsorted files. */
const theirs = (paper: Paper): boolean => paper.by === "client" && paper.asked && paper.code !== INBOX_PAPER;

async function open(db: Tx, token: string, now: Date) {
  const link = await readLink(db, { token, now });
  if (!link) return null;
  const dealId = await dealOfClient(db, link.clientId);
  const view = dealId ? await getDeal(db, { dealId, now }) : null;
  // A client the office does not write to finds the link shut, whatever its date says.
  if (!view || !reachable(view)) return null;
  return { link, view, list: await papersOf(db, view) };
}

/** The page a link opens. Null when the link is unknown, expired, closed, or its deal fell through. */
export async function portalView(db: Db, args: { token: string; now?: Date; count?: boolean }): Promise<PortalView | null> {
  const now = args.now ?? new Date();
  const found = await open(db, args.token, now);
  if (!found) return null;
  const { link, view, list } = found;
  if (args.count) await countView(db, link.id, now);
  const gate = messageGate({ stage: view.deal.stage, verdict: view.study.verdict });
  const timeline = dealTimeline(view.deal.structure, view.deal.stage, view.stageEnteredAt, now);
  const papers = list.papers.filter(theirs);
  return {
    clientName: view.client.fullName,
    fileNo: view.client.fileNo,
    who: whoOf(view.client),
    expiresAt: link.expiresAt,
    stage: view.deal.stage,
    steps: stationTimeline(view.deal.structure, timeline, view.history).steps.map((step) => ({ key: step.key, state: step.state })),
    facts: gate.allowed.includes("study") ? clientFacts({ stage: view.deal.stage, input: view.input, study: view.study }) : null,
    offer: gate.allowed.includes("study") ? await offerOf(db, view, now) : null,
    owed: papers.filter((paper) => paper.required && (paper.status === "missing" || paper.status === "rejected")).map(portalPaper),
    arrived: papers.filter((paper) => paper.status === "received" || paper.status === "verified").map(portalPaper),
  };
}

/**
 * Keeps a file the client sent through their link. The link is the only key, so the door is narrow:
 * the paper must be one of the client's own that the deal asks for and nobody verified yet, the file
 * passes the same checks as any other, and a link sends only so many files a day.
 */
export async function portalUpload(
  db: Db,
  args: { token: string; code: string; file: { name: string; bytes: Uint8Array }; ip?: string | null; now?: Date },
): Promise<{ added: boolean }> {
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    const found = await open(tx, args.token, now);
    if (!found) throw new DomainError("LINK_CLOSED");
    const clientId = found.view.client.id;
    const paper = found.list.papers.find((entry) => entry.code === args.code && theirs(entry));
    if (!paper || paper.status === "verified") throw new DomainError("INVALID_INPUT", `paper ${args.code}`);

    const [sent] = await tx
      .select({ n: count() })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "doc.upload"),
          eq(auditLog.entity, "client"),
          eq(auditLog.entityId, clientId),
          gt(auditLog.createdAt, new Date(now.getTime() - 86_400_000)),
          sql`${auditLog.details}->>'via' = 'portal'`,
        ),
      );
    if (Number(sent?.n ?? 0) >= PORTAL_DAILY_FILES) throw new DomainError("UPLOAD_LIMIT", `client ${clientId}`);

    const { added } = await keepFile(tx, { clientId, code: args.code, ...args.file, actor: { userId: null, ip: args.ip ?? null }, now, via: "portal" });
    return { added };
  });
}
