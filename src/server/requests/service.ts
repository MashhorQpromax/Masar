import "server-only";
import { and, desc, eq, gte, inArray, or } from "drizzle-orm";
import { ZodError, z, type ZodType } from "zod";
import { lenderMessage } from "@/copy/requests";
import { dayOf } from "@/domain/eligibility";
import type { FundingRoute } from "@/domain/funding";
import type { Opportunity, Part } from "@/domain/opportunity";
import {
  approveRefusal,
  CONSENT_WAYS,
  consentFor,
  CONTACT_KINDS,
  contactProblem,
  contactState,
  daysBetween,
  followUpDue,
  OPEN_STATUSES,
  partsOf,
  prepareRefusal,
  sendRefusal,
  type Contact,
  type ContactKind,
  type ContactState,
  type ConsentWay,
  type RequestStatus,
  type ShareConsent,
  type SharedFacts,
} from "@/domain/request";
import { approvalsOf } from "../analysis/approval";
import { getAnalysis, type AnalysisView } from "../analysis/service";
import type { Db, Tx } from "../db/client";
import { clients, documents, lenderContacts, lenderRequests, lenders, outcomes, shareConsents, users } from "../db/schema";
import { getDeal, type DealView } from "../deals/service";
import { opportunitiesOf, type OpportunitiesView } from "../opportunities/service";
import { followUpDays } from "../settings/requests";
import type { Actor } from "../shared/actor";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";
import { printOf } from "../shared/print";

const id = z.number().int().positive();
const day = z.iso.date();
/** Text a person typed: trimmed, and empty is nothing. */
const said = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((text) => text || null);

function parsed<T>(schema: ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) throw new DomainError("INVALID_INPUT", error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    throw error;
  }
}

async function lenderNamed(tx: Tx, lenderId: number): Promise<{ id: number; name: string }> {
  const [lender] = await tx.select({ id: lenders.id, name: lenders.name }).from(lenders).where(eq(lenders.id, lenderId));
  if (!lender) throw new DomainError("NOT_FOUND", `lender ${lenderId}`);
  return lender;
}

// ---------- ways of reaching a lender ----------

/** A way of reaching a lender, with its lender's name and whether it can carry a request today. */
export interface ContactLine extends Contact {
  lenderName: string;
  state: ContactState;
}

/** The ways of reaching the lenders, one lender's or all, those in use first. */
export async function contactsOf(db: Tx, args: { lenderId?: number; today: string }): Promise<ContactLine[]> {
  const rows = await db
    .select({ contact: lenderContacts, lenderName: lenders.name })
    .from(lenderContacts)
    .innerJoin(lenders, eq(lenders.id, lenderContacts.lenderId))
    .where(args.lenderId != null ? eq(lenderContacts.lenderId, args.lenderId) : undefined)
    .orderBy(lenders.name, desc(lenderContacts.active), desc(lenderContacts.id));
  return rows.map(({ contact, lenderName }) => {
    const line: Contact = {
      id: contact.id,
      lenderId: contact.lenderId,
      kind: contact.kind,
      value: contact.value,
      person: contact.person,
      source: contact.source,
      checkedOn: contact.checkedOn,
      active: contact.active,
    };
    return { ...line, lenderName, state: contactState(line, args.today) };
  });
}

const contactSchema = z
  .object({
    lenderId: id,
    kind: z.enum(CONTACT_KINDS),
    value: z.string().trim().min(3).max(200),
    person: said(120),
    source: said(200),
    checkedOn: day.nullable(),
  })
  .superRefine((value, context) => {
    // A check says what it was checked against.
    if (value.checkedOn != null && value.source == null)
      context.addIssue({
        code: "custom",
        path: ["source"],
        message: "a check names its source",
      });
  });

function refuseBadValue(kind: ContactKind, value: string): void {
  const problem = contactProblem(kind, value);
  if (problem === "EMAIL") throw new DomainError("BAD_EMAIL");
  if (problem === "PHONE") throw new DomainError("BAD_PHONE");
  if (problem === "LINK") throw new DomainError("BAD_LINK");
}

/** Keeps a way of reaching a lender. Without a source and a check it is kept, and carries nothing. */
export async function addContact(db: Db, args: { input: unknown; actor: Actor; now?: Date }): Promise<{ id: number }> {
  const input = parsed(contactSchema, args.input);
  refuseBadValue(input.kind, input.value);
  const now = args.now ?? new Date();
  if (input.checkedOn != null && input.checkedOn > dayOf(now)) throw new DomainError("INVALID_INPUT", "checkedOn: a day still to come");
  return db.transaction(async (tx) => {
    const lender = await lenderNamed(tx, input.lenderId);
    const [row] = await tx
      .insert(lenderContacts)
      .values({
        lenderId: lender.id,
        kind: input.kind,
        value: input.value,
        person: input.person,
        source: input.source,
        checkedOn: input.checkedOn,
        checkedBy: input.checkedOn ? args.actor.userId : null,
        userId: args.actor.userId,
        createdAt: now,
      })
      .returning({ id: lenderContacts.id });
    await audit(tx, args.actor, "lender.contact_add", "lender", lender.id, {
      lender: lender.name,
      kind: input.kind,
      contact: row!.id,
      checked: input.checkedOn != null,
    });
    return { id: row!.id };
  });
}

const checkSchema = z.object({
  source: z.string().trim().min(3).max(200),
  checkedOn: day,
});

/** Says that someone checked a way still reaches the lender, against what. */
export async function checkContact(db: Db, args: { contactId: number; input: unknown; actor: Actor; now?: Date }): Promise<void> {
  const input = parsed(checkSchema, args.input);
  const now = args.now ?? new Date();
  if (input.checkedOn > dayOf(now)) throw new DomainError("INVALID_INPUT", "checkedOn: a day still to come");
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(lenderContacts).where(eq(lenderContacts.id, args.contactId));
    if (!row || !row.active) throw new DomainError("NOT_FOUND", `contact ${args.contactId}`);
    const lender = await lenderNamed(tx, row.lenderId);
    await tx
      .update(lenderContacts)
      .set({
        source: input.source,
        checkedOn: input.checkedOn,
        checkedBy: args.actor.userId,
      })
      .where(eq(lenderContacts.id, row.id));
    await audit(tx, args.actor, "lender.contact_check", "lender", lender.id, {
      lender: lender.name,
      kind: row.kind,
      contact: row.id,
      checkedOn: input.checkedOn,
    });
  });
}

/** Stops a way the office no longer uses. It stays, so what was sent through it still says where. */
export async function stopContact(db: Db, args: { contactId: number; actor: Actor }): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(lenderContacts).where(eq(lenderContacts.id, args.contactId));
    if (!row) throw new DomainError("NOT_FOUND", `contact ${args.contactId}`);
    if (!row.active) return;
    const lender = await lenderNamed(tx, row.lenderId);
    await tx.update(lenderContacts).set({ active: false }).where(eq(lenderContacts.id, row.id));
    await audit(tx, args.actor, "lender.contact_stop", "lender", lender.id, {
      lender: lender.name,
      kind: row.kind,
      contact: row.id,
    });
  });
}

// ---------- the client's consent to sharing with a lender ----------

export interface ConsentLine extends ShareConsent {
  lenderName: string;
  by: string | null;
}

/** A client's consents to sharing with lenders, the newest first. */
export async function shareConsentsOf(db: Tx, clientId: number): Promise<ConsentLine[]> {
  const rows = await db
    .select({
      consent: shareConsents,
      lenderName: lenders.name,
      by: users.name,
    })
    .from(shareConsents)
    .innerJoin(lenders, eq(lenders.id, shareConsents.lenderId))
    .leftJoin(users, eq(users.id, shareConsents.userId))
    .where(eq(shareConsents.clientId, clientId))
    .orderBy(desc(shareConsents.id));
  return rows.map(({ consent, lenderName, by }) => ({
    id: consent.id,
    lenderId: consent.lenderId,
    way: consent.way,
    note: consent.note,
    givenOn: consent.givenOn,
    withdrawn: consent.withdrawnAt != null,
    lenderName,
    by,
  }));
}

const consentSchema = z.object({
  lenderId: id,
  way: z.enum(CONSENT_WAYS),
  note: said(300),
  givenOn: day,
});

/**
 * Records that the client agreed to the office sharing their data with one lender. It comes after
 * their consent to the office processing their data at all, and never on a day still to come.
 */
export async function recordShareConsent(db: Db, args: { clientId: number; input: unknown; actor: Actor; now?: Date }): Promise<{ id: number }> {
  const input = parsed(consentSchema, args.input);
  const now = args.now ?? new Date();
  if (input.givenOn > dayOf(now)) throw new DomainError("INVALID_INPUT", "givenOn: a day still to come");
  return db.transaction(async (tx) => {
    const [client] = await tx.select({ id: clients.id, consentAt: clients.consentAt }).from(clients).where(eq(clients.id, args.clientId));
    if (!client) throw new DomainError("NOT_FOUND", `client ${args.clientId}`);
    if (client.consentAt == null) throw new DomainError("CONSENT_NEEDED");
    const lender = await lenderNamed(tx, input.lenderId);
    const standing = consentFor(await shareConsentsOf(tx, client.id), lender.id);
    if (standing) return { id: standing.id };
    const [row] = await tx
      .insert(shareConsents)
      .values({
        clientId: client.id,
        lenderId: lender.id,
        way: input.way as ConsentWay,
        note: input.note,
        givenOn: input.givenOn,
        userId: args.actor.userId,
        createdAt: now,
      })
      .returning({ id: shareConsents.id });
    await audit(tx, args.actor, "client.share_consent", "client", client.id, {
      lender: lender.name,
      way: input.way,
      givenOn: input.givenOn,
    });
    return { id: row!.id };
  });
}

/** The client takes back their consent for one lender. Nothing more is sent to it about them. */
export async function withdrawShareConsent(db: Db, args: { clientId: number; consentId: number; actor: Actor; now?: Date }): Promise<void> {
  const now = args.now ?? new Date();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(shareConsents)
      .where(and(eq(shareConsents.id, args.consentId), eq(shareConsents.clientId, args.clientId)));
    if (!row) throw new DomainError("NOT_FOUND", `consent ${args.consentId}`);
    if (row.withdrawnAt) return;
    const lender = await lenderNamed(tx, row.lenderId);
    await tx.update(shareConsents).set({ withdrawnAt: now }).where(eq(shareConsents.id, row.id));
    await audit(tx, args.actor, "client.share_withdraw", "client", args.clientId, { lender: lender.name });
  });
}

// ---------- what a request tells the lender ----------

/** The parts of a route one lender funds. */
function legsOf(route: FundingRoute, lenderId: number): { part: Part; leg: NonNullable<FundingRoute[Part]> }[] {
  return (["mortgage", "personal"] as const).flatMap((part) => {
    const leg = route[part];
    return leg && leg.product.lenderId === String(lenderId) ? [{ part, leg }] : [];
  });
}

/**
 * What a request tells one lender, read now: the parts it funds on the route, and the client as the
 * approved analysis reads the file. It names no client; the file number is the reference.
 */
function sharedOn(args: { fileNo: string; analysis: AnalysisView; opportunity: Opportunity; lenderId: number; record: OpportunitiesView["funding"]["record"] }): SharedFacts {
  const { file } = args.analysis;
  return {
    ref: args.fileNo,
    legs: legsOf(args.opportunity.route, args.lenderId).map(({ part, leg }) => ({
      part,
      product: leg.product.name,
      amount: Math.round(leg.amount),
      months: leg.months,
    })),
    age: file.age,
    nationality: file.nationality,
    sector: file.sector,
    contractType: file.contractType ?? null,
    serviceMonths: file.serviceMonths,
    basicSalary: file.basicSalary,
    totalSalary: file.totalSalary,
    salaryBank: args.analysis.salaryBank,
    incomeVerified: file.incomeVerified,
    keptMonthly: Math.round(args.opportunity.study.keptMonthly),
    record: {
      known: args.record.known,
      open: args.record.open,
      settledMonthsAgo: args.record.settledMonthsAgo,
      delays: args.record.delays,
    },
  };
}

/** Everything a step of a request reads about its deal, worked out now. */
interface DealNow {
  view: DealView;
  study: OpportunitiesView;
  analysis: AnalysisView | null;
  /** An approval of the client's analysis stands on the file as it reads now. */
  approved: boolean;
  consents: ConsentLine[];
}

async function dealNow(tx: Tx, dealId: number, now: Date): Promise<DealNow> {
  const view = await getDeal(tx as Db, { dealId, now });
  if (!view) throw new DomainError("NOT_FOUND", `deal ${dealId}`);
  const study = await opportunitiesOf(tx, view, now);
  const analysis = await getAnalysis(tx as Db, {
    clientId: view.client.id,
    now,
  });
  const [latest] = analysis?.fingerprint
    ? await approvalsOf(tx as Db, {
        clientId: view.client.id,
        now: analysis.fingerprint,
      })
    : [];
  return {
    view,
    study,
    analysis,
    approved: latest != null && latest.changed.length === 0,
    consents: await shareConsentsOf(tx, view.client.id),
  };
}

async function openRequest(tx: Tx, clientId: number, lenderId: number): Promise<{ id: number; dealId: number } | null> {
  const [row] = await tx
    .select({ id: lenderRequests.id, dealId: lenderRequests.dealId })
    .from(lenderRequests)
    .where(and(eq(lenderRequests.clientId, clientId), eq(lenderRequests.lenderId, lenderId), inArray(lenderRequests.status, [...OPEN_STATUSES])));
  return row ?? null;
}

/**
 * Prepares a request to one lender on one opportunity of the deal: the message is written from the
 * file as the approved analysis reads it, and kept as written. Refused, with the reason, for a deal
 * that ended, a client whose consents are not recorded, a file whose analysis is not approved as it
 * reads now, an opportunity that cannot be carried out, and a lender that already has an open
 * request about this client, whose number the refusal carries.
 */
export async function prepareRequest(
  db: Db,
  args: {
    dealId: number;
    routeKey: string;
    lenderId: number;
    actor: Actor;
    now?: Date;
  },
): Promise<{ id: number }> {
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    const { view, study, analysis, approved, consents } = await dealNow(tx, args.dealId, now);
    const opportunity = study.list.find((o) => o.key === args.routeKey);
    if (!opportunity) throw new DomainError("ROUTE_GONE", args.routeKey);
    const legs = legsOf(opportunity.route, args.lenderId);
    if (legs.length === 0) throw new DomainError("INVALID_INPUT", "lenderId: the route has no part from this lender");
    const lender = await lenderNamed(tx, args.lenderId);
    const open = await openRequest(tx, view.client.id, lender.id);
    const refusal = prepareRefusal({
      ended: study.funding.ended,
      consented: view.client.consentAt != null,
      sharing: consentFor(consents, lender.id) != null,
      approved: approved && analysis != null,
      viable: opportunity.class !== "not_viable",
      open: open != null,
    });
    if (refusal)
      throw new DomainError("REQUEST_REFUSED", refusal, {
        reason: refusal,
        ...(open ? { request: String(open.id), deal: String(open.dealId) } : {}),
      });
    const shared = sharedOn({
      fileNo: view.client.fileNo,
      analysis: analysis!,
      opportunity,
      lenderId: lender.id,
      record: study.funding.record,
    });
    const part = (p: Part) => legs.find((l) => l.part === p)?.leg.product.id;
    const [row] = await tx
      .insert(lenderRequests)
      .values({
        dealId: view.deal.id,
        clientId: view.client.id,
        lenderId: lender.id,
        mortgageProductId: part("mortgage") != null ? Number(part("mortgage")) : null,
        personalProductId: part("personal") != null ? Number(part("personal")) : null,
        routeKey: opportunity.key,
        message: lenderMessage(shared),
        shared: shared as unknown as Record<string, unknown>,
        print: printOf(shared),
        preparedBy: args.actor.userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: lenderRequests.id });
    await audit(tx, args.actor, "request.prepare", "deal", view.deal.id, {
      lender: lender.name,
      request: row!.id,
      parts: legs.map((l) => l.part),
      class: opportunity.class,
    });
    return { id: row!.id };
  });
}

async function requestRow(tx: Tx, requestId: number) {
  const [row] = await tx.select().from(lenderRequests).where(eq(lenderRequests.id, requestId));
  if (!row) throw new DomainError("NOT_FOUND", `request ${requestId}`);
  return row;
}

/**
 * Approves a prepared request: the message as it was written, signed. The file is read again here,
 * and the approval is refused when what the lender would be told no longer matches it, when the
 * client's consent was withdrawn, when the analysis approval fell, or when the opportunity can no
 * longer be carried out.
 */
export async function approveRequest(db: Db, args: { requestId: number; actor: Actor; now?: Date }): Promise<void> {
  const now = args.now ?? new Date();
  await db.transaction(async (tx) => {
    const request = await requestRow(tx, args.requestId);
    const { view, study, analysis, approved, consents } = await dealNow(tx, request.dealId, now);
    const opportunity = study.list.find((o) => o.key === request.routeKey) ?? null;
    const shared =
      opportunity && analysis
        ? sharedOn({
            fileNo: view.client.fileNo,
            analysis,
            opportunity,
            lenderId: request.lenderId,
            record: study.funding.record,
          })
        : null;
    const refusal = approveRefusal({
      status: request.status,
      sharing: consentFor(consents, request.lenderId) != null,
      approved: approved && analysis != null,
      viable: opportunity != null && opportunity.class !== "not_viable",
      stale: shared == null || printOf(shared) !== request.print,
    });
    if (refusal) throw new DomainError("APPROVAL_REFUSED", refusal, { reason: refusal });
    const lender = await lenderNamed(tx, request.lenderId);
    await tx
      .update(lenderRequests)
      .set({
        status: "approved",
        approvedBy: args.actor.userId,
        approvedAt: now,
        updatedAt: now,
      })
      .where(eq(lenderRequests.id, request.id));
    await audit(tx, args.actor, "request.approve", "deal", request.dealId, {
      lender: lender.name,
      request: request.id,
    });
  });
}

const sendSchema = z.object({ contactId: id, sentOn: day });

/**
 * Records that a person sent an approved request, the day they sent it and the way they used. The
 * system sent nothing itself. The way must be the lender's own, with a source and a check that holds.
 */
export async function recordSent(db: Db, args: { requestId: number; input: unknown; actor: Actor; now?: Date }): Promise<void> {
  const input = parsed(sendSchema, args.input);
  const now = args.now ?? new Date();
  const today = dayOf(now);
  await db.transaction(async (tx) => {
    const request = await requestRow(tx, args.requestId);
    const [contact] = await tx.select().from(lenderContacts).where(eq(lenderContacts.id, input.contactId));
    const consents = await shareConsentsOf(tx, request.clientId);
    const refusal = sendRefusal({
      status: request.status,
      sharing: consentFor(consents, request.lenderId) != null,
      contact: contact ? contactState(contact, today) : null,
      sameLender: contact?.lenderId === request.lenderId,
      sentOn: input.sentOn,
      approvedOn: request.approvedAt ? dayOf(request.approvedAt) : null,
      today,
    });
    if (refusal) throw new DomainError("SEND_REFUSED", refusal, { reason: refusal });
    const lender = await lenderNamed(tx, request.lenderId);
    await tx
      .update(lenderRequests)
      .set({
        status: "sent",
        sentBy: args.actor.userId,
        sentOn: input.sentOn,
        contactId: contact!.id,
        sentTo: {
          kind: contact!.kind,
          value: contact!.value,
          person: contact!.person,
        },
        updatedAt: now,
      })
      .where(eq(lenderRequests.id, request.id));
    await audit(tx, args.actor, "request.send", "deal", request.dealId, {
      lender: lender.name,
      request: request.id,
      kind: contact!.kind,
      sentOn: input.sentOn,
    });
  });
}

/** Closes a request that is still open, with why. One that was answered or closed stays as it ended. */
export async function closeRequest(db: Db, args: { requestId: number; reason: string | null; actor: Actor; now?: Date }): Promise<void> {
  const now = args.now ?? new Date();
  const reason = args.reason?.replace(/\s+/g, " ").trim().slice(0, 200) || null;
  await db.transaction(async (tx) => {
    const request = await requestRow(tx, args.requestId);
    if (!OPEN_STATUSES.includes(request.status)) throw new DomainError("INVALID_STAGE", `request ${request.id} is ${request.status}`);
    const lender = await lenderNamed(tx, request.lenderId);
    await tx
      .update(lenderRequests)
      .set({
        status: "closed",
        closedAt: now,
        closeReason: reason,
        updatedAt: now,
      })
      .where(eq(lenderRequests.id, request.id));
    await audit(tx, args.actor, "request.close", "deal", request.dealId, {
      lender: lender.name,
      request: request.id,
      reason,
    });
  });
}

// ---------- reading requests ----------

/** One answer recorded on a request. */
export interface RequestAnswer {
  part: Part;
  decision: string;
  amount: number | null;
  on: string;
  written: boolean;
  replyText: string | null;
}

/** A request as its screens read it. */
export interface RequestView {
  id: number;
  dealId: number;
  clientId: number;
  fileNo: string;
  clientName: string;
  lenderId: number;
  lenderName: string;
  parts: Part[];
  /** What the request asked for each part, as the message said it. */
  asked: SharedFacts["legs"];
  status: RequestStatus;
  message: string;
  preparedAt: Date;
  preparedBy: string | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  sentOn: string | null;
  sentBy: string | null;
  sentTo: { kind: ContactKind; value: string; person: string | null } | null;
  answeredAt: Date | null;
  closedAt: Date | null;
  closeReason: string | null;
  answers: RequestAnswer[];
  /** Days since it was sent. Null until it is. */
  waited: number | null;
  /** Sent, unanswered, and past the office's wait. */
  due: boolean;
}

async function viewsOf(db: Tx, where: ReturnType<typeof and>, now: Date): Promise<RequestView[]> {
  const rows = await db
    .select({
      request: lenderRequests,
      lenderName: lenders.name,
      fileNo: clients.fileNo,
      clientName: clients.fullName,
    })
    .from(lenderRequests)
    .innerJoin(lenders, eq(lenders.id, lenderRequests.lenderId))
    .innerJoin(clients, eq(clients.id, lenderRequests.clientId))
    .where(where)
    .orderBy(desc(lenderRequests.id));
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.request.id);
  const people = new Map((await db.select({ id: users.id, name: users.name }).from(users)).map((user) => [user.id, user.name]));
  const answers = await db
    .select({
      requestId: outcomes.requestId,
      part: outcomes.financeType,
      decision: outcomes.decision,
      amount: outcomes.approvedAmount,
      on: outcomes.answeredOn,
      at: outcomes.createdAt,
      paper: outcomes.replyPaperId,
      paperStatus: documents.status,
      replyText: outcomes.replyText,
    })
    .from(outcomes)
    .leftJoin(documents, eq(documents.id, outcomes.replyPaperId))
    .where(inArray(outcomes.requestId, ids))
    .orderBy(outcomes.id);
  const today = dayOf(now);
  const wait = await followUpDays(db);
  const name = (userId: number | null) => (userId != null ? (people.get(userId) ?? null) : null);
  return rows.map(({ request, lenderName, fileNo, clientName }) => ({
    id: request.id,
    dealId: request.dealId,
    clientId: request.clientId,
    fileNo,
    clientName,
    lenderId: request.lenderId,
    lenderName,
    parts: partsOf(request),
    asked: (request.shared as unknown as SharedFacts).legs ?? [],
    status: request.status,
    message: request.message,
    preparedAt: request.createdAt,
    preparedBy: name(request.preparedBy),
    approvedAt: request.approvedAt,
    approvedBy: name(request.approvedBy),
    sentOn: request.sentOn,
    sentBy: name(request.sentBy),
    sentTo: request.sentTo
      ? {
          kind: request.sentTo.kind as ContactKind,
          value: request.sentTo.value,
          person: request.sentTo.person,
        }
      : null,
    answeredAt: request.answeredAt,
    closedAt: request.closedAt,
    closeReason: request.closeReason,
    answers: answers
      .filter((answer) => answer.requestId === request.id)
      .map((answer) => ({
        part: answer.part as Part,
        decision: answer.decision,
        amount: answer.amount,
        on: answer.on ?? dayOf(answer.at),
        written: answer.paper != null && (answer.paperStatus === "received" || answer.paperStatus === "verified"),
        replyText: answer.replyText,
      })),
    waited: request.sentOn ? daysBetween(request.sentOn, today) : null,
    due: followUpDue(request, today, wait),
  }));
}

/** A deal's requests, the newest first. */
export async function requestsOf(db: Tx, args: { dealId: number; now?: Date }): Promise<RequestView[]> {
  return viewsOf(db, and(eq(lenderRequests.dealId, args.dealId)), args.now ?? new Date());
}

/** One request of a deal. Null when the deal has none of that number. */
export async function requestById(db: Tx, args: { dealId: number; requestId: number; now?: Date }): Promise<RequestView | null> {
  const [found] = await viewsOf(db, and(eq(lenderRequests.dealId, args.dealId), eq(lenderRequests.id, args.requestId)), args.now ?? new Date());
  return found ?? null;
}

/** What the office's requests screen shows: every open request, and those that ended in the last month. */
export async function requestsBoard(db: Tx, args: { now?: Date } = {}): Promise<{ list: RequestView[]; followUpDays: number }> {
  const now = args.now ?? new Date();
  const month = new Date(now.getTime() - 30 * 86_400_000);
  const list = await viewsOf(db, and(or(inArray(lenderRequests.status, [...OPEN_STATUSES]), gte(lenderRequests.updatedAt, month))), now);
  return { list, followUpDays: await followUpDays(db) };
}

/** The lenders a deal's client consented to, and whether each has an open request, for the deal's requests page. */
export async function requestPlaces(db: Tx, args: { dealId: number; now?: Date }): Promise<DealNow & { requests: RequestView[] }> {
  const now = args.now ?? new Date();
  const found = await dealNow(db, args.dealId, now);
  return {
    ...found,
    requests: await requestsOf(db, { dealId: args.dealId, now }),
  };
}
