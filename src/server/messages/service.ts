import "server-only";
import { and, asc, desc, eq, isNotNull, max } from "drizzle-orm";
import { z } from "zod";
import { dealTimeline, stationTimeline, type StationKey, type StationState } from "@/domain/deal";
import { FILE_MAX_BYTES, INBOX_PAPER, type Paper } from "@/domain/documents";
import { clientFacts, isClientMessage, isMessageKind, messageGate, windowOpen, type ClientFacts, type Gate, type MessageKind } from "@/domain/messages";
import { normalizePhone } from "@/domain/shared/phone";
import type { Db, Tx } from "../db/client";
import { clients, users, waMessages } from "../db/schema";
import { getDeal, type DealView } from "../deals/service";
import { keepFile, papersOf, whoOf, type PaperWho } from "../documents/service";
import { SYSTEM, type Actor } from "../shared/actor";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";
import type { Cloud } from "./cloud";
import { linkOf, openLink, type ClientLink } from "./links";

const BODY_MAX = 4096;

/** One message of the conversation with a client, either way. */
export interface ThreadMessage {
  id: number;
  direction: "in" | "out";
  /** text, template, image, document, or whatever else WhatsApp calls it. */
  type: string;
  body: string | null;
  /** manual, sent, delivered, read, failed for what went out; received for what came in. */
  status: string | null;
  error: string | null;
  /** The file a picture or a document was kept as. */
  fileId: number | null;
  /** Who of the office sent it. */
  by: string | null;
  at: Date;
  /** When the office said a message that came in needs no answer. */
  seenAt?: Date | null;
}

/** The conversation with a client, oldest first, at most the last `limit` messages. */
export async function threadOf(db: Tx, clientId: number, limit = 40): Promise<ThreadMessage[]> {
  const rows = await db
    .select({
      id: waMessages.id,
      direction: waMessages.direction,
      type: waMessages.type,
      body: waMessages.body,
      status: waMessages.status,
      error: waMessages.error,
      fileId: waMessages.fileId,
      by: users.name,
      at: waMessages.createdAt,
      seenAt: waMessages.seenAt,
    })
    .from(waMessages)
    .leftJoin(users, eq(users.id, waMessages.userId))
    .where(eq(waMessages.clientId, clientId))
    .orderBy(desc(waMessages.id))
    .limit(limit);
  return rows.reverse();
}

/** When the client last wrote. Null when they never did. */
export async function lastInbound(db: Tx, clientId: number): Promise<Date | null> {
  const [row] = await db
    .select({ at: max(waMessages.createdAt) })
    .from(waMessages)
    .where(and(eq(waMessages.clientId, clientId), eq(waMessages.direction, "in")));
  return row?.at ?? null;
}

/** Everything the messages page of a deal shows. */
export interface MessagesView {
  deal: DealView["deal"];
  client: DealView["client"];
  input: DealView["input"];
  study: DealView["study"];
  who: PaperWho;
  gate: Gate;
  /** The client's side of the deal. */
  facts: ClientFacts;
  steps: { key: StationKey; state: StationState }[];
  /** The client's own papers still owed. */
  owed: Paper[];
  link: ClientLink | null;
  thread: ThreadMessage[];
  /** The client's number as WhatsApp takes it. Null when it is missing or not a phone number. */
  phone: string | null;
  /** Free text may be sent from the company number now. */
  windowOpen: boolean;
  /** The last word is the client's, and nobody said it needs no answer. */
  waiting: boolean;
}

const owedByClient = (papers: Paper[]): Paper[] =>
  papers.filter((paper) => paper.by === "client" && paper.required && paper.code !== INBOX_PAPER && (paper.status === "missing" || paper.status === "rejected"));

export async function getMessages(db: Db, args: { dealId: number; secret: string; now?: Date }): Promise<MessagesView | null> {
  const now = args.now ?? new Date();
  const view = await getDeal(db, { dealId: args.dealId, now });
  if (!view) return null;
  const list = await papersOf(db, view);
  const timeline = dealTimeline(view.deal.structure, view.deal.stage, view.stageEnteredAt, now);
  const thread = await threadOf(db, view.client.id);
  const last = thread.at(-1);
  return {
    deal: view.deal,
    client: view.client,
    input: view.input,
    study: view.study,
    who: whoOf(view.client),
    gate: messageGate({ stage: view.deal.stage, verdict: view.study.verdict }),
    facts: clientFacts({ stage: view.deal.stage, input: view.input, study: view.study }),
    steps: stationTimeline(view.deal.structure, timeline, view.history).steps.map((step) => ({ key: step.key, state: step.state })),
    owed: owedByClient(list.papers),
    link: await linkOf(db, { clientId: view.client.id, secret: args.secret, now }),
    thread,
    phone: normalizePhone(view.client.phone),
    windowOpen: windowOpen(await lastInbound(db, view.client.id), now),
    waiting: last?.direction === "in" && last.seenAt == null,
  };
}

/** A message for the client of a deal, checked against what may be said to them now. */
async function clientMessage(db: Db, args: { dealId: number; kind: string; body: string; now: Date }) {
  const body = args.body.trim();
  if (!body) throw new DomainError("MESSAGE_EMPTY");
  if (body.length > BODY_MAX) throw new DomainError("INVALID_INPUT", "message too long");
  // The internal summary carries the company's numbers. It is never recorded as said to the client.
  if (!isMessageKind(args.kind) || !isClientMessage(args.kind)) throw new DomainError("INVALID_INPUT", `message ${args.kind}`);
  const view = await getDeal(db, { dealId: args.dealId, now: args.now });
  if (!view) throw new DomainError("NOT_FOUND", `deal ${args.dealId}`);
  const gate = messageGate({ stage: view.deal.stage, verdict: view.study.verdict });
  if (!gate.allowed.includes(args.kind)) throw new DomainError("GATE_CLOSED", `${args.kind} for deal ${args.dealId}`);
  const phone = normalizePhone(view.client.phone);
  if (!phone) throw new DomainError("NO_PHONE", `client ${view.client.id}`);
  return { body, kind: args.kind as MessageKind, client: view.client, phone };
}

/**
 * Sends a message to the client from the company's number.
 *
 * WhatsApp takes free text only while the client wrote within the last day. Outside that window the
 * approved template goes instead: it greets the client by name, carries their link and invites a
 * reply, and the full message follows once they answer.
 */
export async function sendMessage(
  db: Db,
  args: { dealId: number; kind: string; body: string; actor: Actor; cloud: Cloud | null; secret: string; linkUrl: (token: string) => string; now?: Date },
): Promise<{ via: "text" | "template" }> {
  const now = args.now ?? new Date();
  const message = await clientMessage(db, { ...args, now });
  if (!args.cloud) throw new DomainError("WA_OFF");
  const open = windowOpen(await lastInbound(db, message.client.id), now);

  let via: "text" | "template" = "text";
  let said = message.body;
  let sent;
  if (open) {
    sent = await args.cloud.sendText(message.phone, message.body);
  } else {
    const link = await openLink(db, { dealId: args.dealId, secret: args.secret, actor: args.actor, now });
    const url = args.linkUrl(link.token);
    const first = message.client.fullName.trim().split(/\s+/)[0] ?? "";
    via = "template";
    said = `[${args.cloud.template}] ${first} ${url}`;
    sent = await args.cloud.sendTemplate(message.phone, [first, url]);
  }

  await db.transaction(async (tx) => {
    await tx.insert(waMessages).values({
      clientId: message.client.id,
      direction: "out",
      waId: sent.ok ? sent.id : null,
      phone: message.phone,
      type: via,
      body: said,
      status: sent.ok ? "sent" : "failed",
      error: sent.ok ? null : sent.error,
      userId: args.actor.userId,
      createdAt: now,
      updatedAt: now,
    });
    await audit(tx, args.actor, "wa.send", "client", message.client.id, { kind: message.kind, via, ok: sent.ok });
  });
  if (!sent.ok) throw new DomainError("SEND_FAILED", sent.error);
  return { via };
}

/** Records a message a person sent the client from their own WhatsApp, so the file shows what was said. */
export async function noteSent(db: Db, args: { dealId: number; kind: string; body: string; actor: Actor; now?: Date }): Promise<void> {
  const now = args.now ?? new Date();
  const message = await clientMessage(db, { ...args, now });
  await db.transaction(async (tx) => {
    await tx.insert(waMessages).values({
      clientId: message.client.id,
      direction: "out",
      phone: message.phone,
      type: "text",
      body: message.body,
      status: "manual",
      userId: args.actor.userId,
      createdAt: now,
      updatedAt: now,
    });
    await audit(tx, args.actor, "wa.send", "client", message.client.id, { kind: message.kind, via: "manual" });
  });
}

const mediaSchema = z.object({ id: z.string().min(1).max(200), caption: z.string().optional(), filename: z.string().optional() });

const inboundSchema = z.object({
  from: z.string().min(5).max(20),
  id: z.string().min(1).max(200),
  type: z.string().max(40).default("text"),
  text: z.object({ body: z.string() }).optional(),
  image: mediaSchema.optional(),
  document: mediaSchema.optional(),
  button: z.object({ text: z.string() }).optional(),
  interactive: z.object({ button_reply: z.object({ title: z.string() }).optional() }).optional(),
});

const statusSchema = z.object({
  id: z.string().min(1).max(200),
  status: z.string().min(1).max(40),
  errors: z.array(z.object({ title: z.string().optional(), message: z.string().optional() })).optional(),
});

const webhookSchema = z.object({
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              value: z
                .object({
                  messages: z.array(z.unknown()).optional(),
                  statuses: z.array(z.unknown()).optional(),
                  contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string().optional() }).optional() })).optional(),
                })
                .optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

/** The client a WhatsApp number belongs to. Null for a number the office does not know. */
async function clientByPhone(db: Tx, phone: string): Promise<number | null> {
  const rows = await db.select({ id: clients.id, phone: clients.phone }).from(clients).where(isNotNull(clients.phone)).orderBy(asc(clients.id));
  return rows.find((row) => normalizePhone(row.phone) === phone)?.id ?? null;
}

const MEDIA_NAME: Record<string, string> = { "application/pdf": "whatsapp.pdf", "image/jpeg": "whatsapp.jpg", "image/png": "whatsapp.png", "image/webp": "whatsapp.webp" };

/**
 * Takes in what Meta reports: how the messages the office sent are doing, and what clients wrote.
 * The caller has already checked Meta's signature. A message Meta repeats is kept once. A picture or
 * a document from a known client is kept in their file, in the tray of what arrived by WhatsApp, where
 * a person puts it under the right paper.
 */
export async function receive(db: Db, args: { payload: unknown; cloud: Cloud | null; now?: Date }): Promise<{ messages: number; statuses: number }> {
  const now = args.now ?? new Date();
  const parsed = webhookSchema.safeParse(args.payload);
  if (!parsed.success) throw new DomainError("INVALID_INPUT", "webhook payload");
  let messages = 0;
  let statuses = 0;

  for (const entry of parsed.data.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};

      for (const raw of value.statuses ?? []) {
        const status = statusSchema.safeParse(raw);
        if (!status.success) continue;
        const failure = status.data.errors?.[0];
        const error = failure?.message ?? failure?.title ?? null;
        const updated = await db
          .update(waMessages)
          .set({ status: status.data.status, ...(error ? { error: error.slice(0, 300) } : {}), updatedAt: now })
          .where(and(eq(waMessages.waId, status.data.id), eq(waMessages.direction, "out")))
          .returning({ id: waMessages.id });
        statuses += updated.length;
      }

      for (const raw of value.messages ?? []) {
        const inbound = inboundSchema.safeParse(raw);
        if (!inbound.success) continue;
        const message = inbound.data;
        const phone = normalizePhone(message.from);
        if (!phone) continue;
        const [known] = await db.select({ id: waMessages.id }).from(waMessages).where(eq(waMessages.waId, message.id));
        if (known) continue;

        const clientId = await clientByPhone(db, phone);
        const media = message.image ?? message.document;
        const body =
          message.text?.body ?? media?.caption ?? message.button?.text ?? message.interactive?.button_reply?.title ?? null;

        // The file is fetched before the transaction opens: a slow download holds no lock.
        const fetched = media && clientId && args.cloud ? await args.cloud.media(media.id, FILE_MAX_BYTES) : null;

        await db.transaction(async (tx) => {
          let fileId: number | null = null;
          let error: string | null = null;
          if (media && clientId) {
            if (!fetched) error = "MEDIA_NOT_KEPT";
            else {
              try {
                const name = message.document?.filename ?? MEDIA_NAME[fetched.mime] ?? "whatsapp";
                // A savepoint, so a file that is refused does not take the message down with it.
                fileId = await tx.transaction(
                  async (inner) => (await keepFile(inner, { clientId, code: INBOX_PAPER, name, bytes: fetched.bytes, actor: SYSTEM, now, makeRoom: true, via: "whatsapp" })).fileId,
                );
              } catch (failure) {
                if (!(failure instanceof DomainError)) throw failure;
                error = failure.code;
              }
            }
          }
          const kept = await tx
            .insert(waMessages)
            .values({
              clientId,
              direction: "in",
              waId: message.id,
              phone,
              name: value.contacts?.find((contact) => contact.wa_id === message.from)?.profile?.name?.slice(0, 120) ?? null,
              type: message.type,
              body: body?.slice(0, BODY_MAX) ?? null,
              fileId,
              status: "received",
              error,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing({ target: waMessages.waId })
            .returning({ id: waMessages.id });
          messages += kept.length;
        });
      }
    }
  }
  return { messages, statuses };
}
