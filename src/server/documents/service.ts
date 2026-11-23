import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { ZodError } from "zod";
import {
  checklist,
  cleanFileName,
  CUSTOM_PREFIX,
  dealPapers,
  FILE_MAX_BYTES,
  fileKind,
  isCustomCode,
  isFileKind,
  isPaperCode,
  PAPER_MAX_FILES,
  SIMAH_PAPER,
  type Checklist,
  type FileKind,
  type KeptPaper,
  type PaperStatus,
} from "@/domain/documents";
import type { Nationality } from "@/domain/eligibility";
import { SECTORS, type Sector } from "@/domain/shared/sector";
import type { Db, Tx } from "../db/client";
import { clients, deals, documentFiles, documents, fileBlobs } from "../db/schema";
import { getDeal, type DealView } from "../deals/service";
import type { Actor } from "../shared/actor";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";
import { paperLabelSchema, reviewSchema, type PaperReview } from "./input";

const ENDED = ["closed", "lost"];

/** Who the client is to a lender, as far as its papers go. */
export interface PaperWho {
  sector: Sector;
  nationality: Nationality;
}

const whoOf = (client: { sector: string; nationality: string }): PaperWho => ({
  sector: (SECTORS as readonly string[]).includes(client.sector) ? (client.sector as Sector) : "gov",
  nationality: client.nationality === "non_saudi" ? "non_saudi" : "saudi",
});

function valid<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof ZodError) throw new DomainError("INVALID_INPUT", error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    throw error;
  }
}

/** The papers kept for a client with their files, without the files' contents. */
async function keptPapers(db: Tx, clientId: number): Promise<KeptPaper[]> {
  const rows = await db.select().from(documents).where(eq(documents.clientId, clientId)).orderBy(asc(documents.id));
  if (!rows.length) return [];
  const files = await db
    .select({ id: documentFiles.id, docId: documentFiles.docId, name: documentFiles.name, kind: documentFiles.kind, size: documentFiles.size })
    .from(documentFiles)
    .where(
      inArray(
        documentFiles.docId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(documentFiles.id));
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    label: row.label,
    status: row.status,
    note: row.note,
    files: files.flatMap((file) => (file.docId === row.id && isFileKind(file.kind) ? [{ id: file.id, name: file.name, kind: file.kind, size: file.size }] : [])),
  }));
}

/** The file of a deal's client held against what the deal needs today. */
export async function papersOf(db: Tx, view: Pick<DealView, "deal" | "client" | "input" | "history" | "credit">): Promise<Checklist> {
  const needs = dealPapers(
    { structure: view.deal.structure, stage: view.deal.stage, history: view.history.map((event) => event.stage), items: view.input.items },
    whoOf(view.client),
  );
  return checklist(needs, await keptPapers(db, view.client.id), { creditRead: view.credit != null });
}

/** Everything the documents page of a deal shows. */
export interface PapersView {
  deal: DealView["deal"];
  client: DealView["client"];
  who: PaperWho;
  list: Checklist;
  ended: boolean;
}

export async function getPapers(db: Db, args: { dealId: number; now?: Date }): Promise<PapersView | null> {
  const view = await getDeal(db, args);
  if (!view) return null;
  return { deal: view.deal, client: view.client, who: whoOf(view.client), list: await papersOf(db, view), ended: ENDED.includes(view.deal.stage) };
}

async function clientExists(tx: Tx, clientId: number): Promise<void> {
  const [client] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId));
  if (!client) throw new DomainError("NOT_FOUND", `client ${clientId}`);
}

/**
 * The stored row of a paper, locked for the rest of the transaction so two uploads to one paper take
 * their turns. A paper the engine knows gets its row here the first time; one a person added has it already.
 */
async function paperRow(tx: Tx, clientId: number, code: string, now: Date) {
  if (isPaperCode(code)) {
    const [row] = await tx
      .insert(documents)
      .values({ clientId, code, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: [documents.clientId, documents.code], set: { updatedAt: now } })
      .returning();
    return row!;
  }
  if (!isCustomCode(code)) throw new DomainError("INVALID_INPUT", `paper ${code}`);
  const [row] = await tx
    .select()
    .from(documents)
    .where(and(eq(documents.clientId, clientId), eq(documents.code, code)))
    .for("update");
  if (!row) throw new DomainError("NOT_FOUND", `paper ${code}`);
  return row;
}

const filesOf = async (tx: Tx, paperId: number): Promise<number> =>
  (await tx.select({ n: count() }).from(documentFiles).where(eq(documentFiles.docId, paperId)))[0]?.n ?? 0;

/**
 * Keeps a file under a paper of a client. Runs inside the caller's transaction.
 *
 * The file is checked by its own bytes. The same file sent twice to one paper is kept once. A paper
 * that gets a new file has arrived and waits to be looked at, whatever was said about it before.
 */
export async function keepFile(
  tx: Tx,
  args: { clientId: number; code: string; name: string; bytes: Uint8Array; actor: Actor; now: Date; makeRoom?: boolean },
): Promise<{ paperId: number; fileId: number; added: boolean }> {
  const { bytes, now } = args;
  if (bytes.length > FILE_MAX_BYTES) throw new DomainError("FILE_TOO_LARGE", `${bytes.length} bytes`);
  const kind = fileKind(bytes);
  if (!kind) throw new DomainError("FILE_TYPE");

  const paper = await paperRow(tx, args.clientId, args.code, now);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const [same] = await tx
    .select({ id: documentFiles.id })
    .from(documentFiles)
    .where(and(eq(documentFiles.docId, paper.id), eq(documentFiles.sha256, sha256)));
  if (same) return { paperId: paper.id, fileId: same.id, added: false };

  if ((await filesOf(tx, paper.id)) >= PAPER_MAX_FILES) {
    if (!args.makeRoom) throw new DomainError("FILE_LIMIT", `paper ${paper.code}`);
    const [oldest] = await tx.select({ id: documentFiles.id }).from(documentFiles).where(eq(documentFiles.docId, paper.id)).orderBy(asc(documentFiles.id)).limit(1);
    await tx.delete(documentFiles).where(eq(documentFiles.id, oldest!.id));
  }

  const [file] = await tx
    .insert(documentFiles)
    .values({ docId: paper.id, name: cleanFileName(args.name, kind), kind, size: bytes.length, sha256, uploadedBy: args.actor.userId, uploadedAt: now })
    .returning({ id: documentFiles.id });
  await tx.insert(fileBlobs).values({ fileId: file!.id, data: bytes });
  await tx.update(documents).set({ status: "received", note: null, updatedAt: now }).where(eq(documents.id, paper.id));
  await audit(tx, args.actor, "doc.upload", "client", args.clientId, { paper: paper.code, fileId: file!.id, kind, size: bytes.length });
  return { paperId: paper.id, fileId: file!.id, added: true };
}

/** Keeps a file a person uploaded for a paper. The SIMAH report is the exception: it is read, on the credit page. */
export async function addPaperFile(
  db: Db,
  args: { clientId: number; code: string; file: { name: string; bytes: Uint8Array }; actor: Actor; now?: Date },
): Promise<{ fileId: number; added: boolean }> {
  if (args.code === SIMAH_PAPER) throw new DomainError("INVALID_INPUT", "the SIMAH report enters through the credit record");
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    await clientExists(tx, args.clientId);
    const { fileId, added } = await keepFile(tx, { clientId: args.clientId, code: args.code, ...args.file, actor: args.actor, now });
    return { fileId, added };
  });
}

/**
 * Removes a file. What is left decides where the paper stands: with files it waits to be looked at
 * again, with none it is missing. A paper that was sent back stays sent back, with its reason, until a
 * new file arrives: taking the bad pages out is not sending the good ones.
 */
export async function removePaperFile(db: Db, args: { clientId: number; fileId: number; actor: Actor; now?: Date }): Promise<void> {
  const now = args.now ?? new Date();
  await db.transaction(async (tx) => {
    const [file] = await tx.select({ paperId: documentFiles.docId }).from(documentFiles).where(eq(documentFiles.id, args.fileId));
    const [paper] = file
      ? await tx
          .select()
          .from(documents)
          .where(and(eq(documents.id, file.paperId), eq(documents.clientId, args.clientId)))
          .for("update")
      : [];
    if (!paper) throw new DomainError("NOT_FOUND", `file ${args.fileId}`);
    await tx.delete(documentFiles).where(eq(documentFiles.id, args.fileId));
    const left = await filesOf(tx, paper.id);
    const status: PaperStatus = paper.status === "rejected" ? "rejected" : left > 0 ? "received" : "missing";
    await tx
      .update(documents)
      .set({ status, note: status === "rejected" ? paper.note : null, updatedAt: now })
      .where(eq(documents.id, paper.id));
    await audit(tx, args.actor, "doc.remove", "client", args.clientId, { paper: paper.code, fileId: args.fileId });
  });
}

/** Says a paper is good, or sends it back with the reason. Only a paper that has files can be judged. */
export async function reviewPaper(db: Db, args: { clientId: number; paperId: number; review: unknown; actor: Actor; now?: Date }): Promise<void> {
  const review: PaperReview = valid(() => reviewSchema.parse(args.review));
  const now = args.now ?? new Date();
  await db.transaction(async (tx) => {
    const [paper] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, args.paperId), eq(documents.clientId, args.clientId)))
      .for("update");
    if (!paper) throw new DomainError("NOT_FOUND", `paper ${args.paperId}`);
    // The SIMAH report is checked by reading it. Its place is the credit record.
    if (paper.code === SIMAH_PAPER) throw new DomainError("INVALID_INPUT", "the SIMAH report is checked by reading it");
    if ((await filesOf(tx, paper.id)) === 0) throw new DomainError("PAPER_EMPTY", `paper ${paper.code}`);
    await tx
      .update(documents)
      .set({ status: review.verdict, note: review.verdict === "rejected" ? review.note : null, updatedAt: now })
      .where(eq(documents.id, paper.id));
    await audit(tx, args.actor, "doc.review", "client", args.clientId, { paper: paper.code, verdict: review.verdict });
  });
}

/** Adds a paper by name to a client's file: something this deal or one lender asks for beyond the usual. */
export async function addPaper(db: Db, args: { clientId: number; label: unknown; actor: Actor; now?: Date }): Promise<{ paperId: number; code: string }> {
  const label = valid(() => paperLabelSchema.parse(args.label));
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    await clientExists(tx, args.clientId);
    const code = `${CUSTOM_PREFIX}${randomBytes(6).toString("hex")}`;
    const [row] = await tx.insert(documents).values({ clientId: args.clientId, code, label, createdAt: now, updatedAt: now }).returning({ id: documents.id });
    await audit(tx, args.actor, "doc.add", "client", args.clientId, { paper: code });
    return { paperId: row!.id, code };
  });
}

/** Takes back a paper a person added. One that holds files is not removed: the files go first. */
export async function removePaper(db: Db, args: { clientId: number; paperId: number; actor: Actor }): Promise<void> {
  await db.transaction(async (tx) => {
    const [paper] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, args.paperId), eq(documents.clientId, args.clientId)))
      .for("update");
    if (!paper) throw new DomainError("NOT_FOUND", `paper ${args.paperId}`);
    if (!isCustomCode(paper.code)) throw new DomainError("INVALID_INPUT", `paper ${paper.code} is not one a person added`);
    if ((await filesOf(tx, paper.id)) > 0) throw new DomainError("PAPER_HAS_FILES", `paper ${paper.code}`);
    await tx.delete(documents).where(eq(documents.id, paper.id));
    await audit(tx, args.actor, "doc.drop", "client", args.clientId, { paper: paper.code });
  });
}

export interface OpenedFile {
  clientId: number;
  name: string;
  kind: FileKind;
  bytes: Uint8Array;
}

/** A kept file with its contents, for a person to look at. Every opening is recorded. Null when there is no such file. */
export async function openPaperFile(db: Db, args: { fileId: number; actor: Actor }): Promise<OpenedFile | null> {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({ name: documentFiles.name, kind: documentFiles.kind, data: fileBlobs.data, code: documents.code, clientId: documents.clientId })
      .from(documentFiles)
      .innerJoin(documents, eq(documents.id, documentFiles.docId))
      .innerJoin(fileBlobs, eq(fileBlobs.fileId, documentFiles.id))
      .where(eq(documentFiles.id, args.fileId));
    if (!found || !isFileKind(found.kind)) return null;
    await audit(tx, args.actor, "doc.open", "client", found.clientId, { paper: found.code, fileId: args.fileId });
    return { clientId: found.clientId, name: found.name, kind: found.kind, bytes: new Uint8Array(found.data) };
  });
}

/** The client a deal belongs to. Null when there is no such deal. */
export async function clientOfDeal(db: Tx, dealId: number): Promise<number | null> {
  const [deal] = await db.select({ clientId: deals.clientId }).from(deals).where(eq(deals.id, dealId));
  return deal?.clientId ?? null;
}
