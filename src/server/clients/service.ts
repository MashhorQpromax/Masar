import "server-only";
import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { ZodError } from "zod";
import { idDigits, idProblem, isEmail } from "@/domain/clients";
import { normalizePhone } from "@/domain/shared/phone";
import type { Db, Tx } from "../db/client";
import { clients, notes, waMessages } from "../db/schema";
import type { Actor } from "../shared/actor";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";
import { borrowerInputSchema, contactInputSchema, type BorrowerInput } from "./input";

export type ClientRow = typeof clients.$inferSelect;

export function parseBorrower(value: unknown): BorrowerInput {
  try {
    return borrowerInputSchema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new DomainError("INVALID_INPUT", error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    throw error;
  }
}

/**
 * The next file number, "C-001" and up. Call inside the transaction that inserts the client:
 * the lock makes two people opening files at the same moment take different numbers.
 */
async function nextFileNo(tx: Tx): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('masar.clients.file_no'))`);
  const [row] = await tx
    .select({ last: sql<number>`coalesce(max(substring(${clients.fileNo} from '^C-([0-9]+)$')::int), 0)` })
    .from(clients);
  return `C-${String(Number(row?.last ?? 0) + 1).padStart(3, "0")}`;
}

/**
 * Opens a file for a new client. Runs inside the caller's transaction. A phone given here is checked
 * like any other, and what that number wrote before it had a file joins the new file.
 */
export async function createClient(
  tx: Tx,
  args: {
    input: BorrowerInput;
    phone?: string | null;
    /** What a file that is not a salary file starts with: its kind, what it asks for, and its own facts. */
    file?: { financeType: string; requestedAmount: number | null; extra: Record<string, unknown> };
    actor: Actor;
    now: Date;
  },
): Promise<ClientRow> {
  const phone = args.phone?.trim() ? await phoneFor(tx, { phone: args.phone, clientId: null }) : null;
  const fileNo = await nextFileNo(tx);
  const [client] = await tx
    .insert(clients)
    .values({ ...args.input, ...args.file, phone, fileNo, ownerId: args.actor.userId, createdAt: args.now, updatedAt: args.now })
    .returning();
  const adopted = phone ? await adoptMessages(tx, { clientId: client!.id, phone }) : 0;
  await audit(tx, args.actor, "client.create", "client", client!.id, { fileNo, ...(adopted ? { adopted } : {}) });
  return client!;
}

/** Changes the facts a deal is computed from. Runs inside the caller's transaction. */
export async function updateBorrower(
  tx: Tx,
  args: { clientId: number; input: BorrowerInput; actor: Actor; now: Date },
): Promise<ClientRow> {
  const [before] = await tx.select().from(clients).where(eq(clients.id, args.clientId));
  if (!before) throw new DomainError("NOT_FOUND", `client ${args.clientId}`);
  // A fact the form did not send stays as it is.
  const changed = (Object.keys(args.input) as (keyof BorrowerInput)[]).filter((key) => args.input[key] !== undefined && before[key] !== args.input[key]);
  if (!changed.length) return before;
  const [client] = await tx
    .update(clients)
    .set({ ...args.input, updatedAt: args.now })
    .where(eq(clients.id, args.clientId))
    .returning();
  await audit(tx, args.actor, "client.update", "client", args.clientId, { changed });
  return client!;
}

/** The last nine digits of a stored phone, however it was written. Two numbers that share them are compared in full. */
const phoneTail = sql<string>`right(regexp_replace(${clients.phone}, '[^0-9]', '', 'g'), 9)`;

/**
 * A mobile number as it is stored, 9665xxxxxxxx, once it is known to be a number and to belong to no
 * other file. One number in two files would leave no telling whose message arrived.
 */
export async function phoneFor(tx: Tx, args: { phone: string; clientId: number | null }): Promise<string> {
  const phone = normalizePhone(args.phone);
  if (!phone) throw new DomainError("BAD_PHONE", args.phone);
  const others = await tx
    .select({ id: clients.id, fileNo: clients.fileNo, phone: clients.phone })
    .from(clients)
    .where(and(isNotNull(clients.phone), eq(phoneTail, phone.slice(-9)), args.clientId == null ? undefined : ne(clients.id, args.clientId)));
  const holder = others.find((other) => normalizePhone(other.phone) === phone);
  if (holder) throw new DomainError("PHONE_TAKEN", `client ${holder.id}`, { fileNo: holder.fileNo });
  return phone;
}

/**
 * Gives a client the messages their number sent before the office knew whose it was. Runs inside the
 * transaction that put the number on the file. Returns how many messages moved.
 */
export async function adoptMessages(tx: Tx, args: { clientId: number; phone: string }): Promise<number> {
  const moved = await tx
    .update(waMessages)
    .set({ clientId: args.clientId })
    .where(and(isNull(waMessages.clientId), eq(waMessages.phone, args.phone)))
    .returning({ id: waMessages.id });
  return moved.length;
}

const CONTACT_FIELDS = ["phone", "nationality", "nationalId", "employer", "city", "email"] as const;

/**
 * Changes how a client is reached and who they are on paper: phone, nationality, identity number,
 * employer, city and email. The audit log names the fields that changed and never their values.
 */
export async function updateContact(db: Db, args: { clientId: number; input: unknown; actor: Actor; now?: Date }): Promise<{ adopted: number }> {
  const parsed = contactInputSchema.safeParse(args.input);
  if (!parsed.success) throw new DomainError("INVALID_INPUT", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const input = parsed.data;
  const now = args.now ?? new Date();

  const nationalId = input.nationalId ? idDigits(input.nationalId) : null;
  if (input.nationalId) {
    const problem = idProblem(nationalId ?? "", input.nationality);
    if (problem) throw new DomainError(problem);
  }
  const email = input.email?.toLowerCase() ?? null;
  if (email && !isEmail(email)) throw new DomainError("BAD_EMAIL");

  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(clients).where(eq(clients.id, args.clientId));
    if (!before) throw new DomainError("NOT_FOUND", `client ${args.clientId}`);
    const phone = input.phone ? await phoneFor(tx, { phone: input.phone, clientId: before.id }) : null;
    if (nationalId) {
      const [holder] = await tx
        .select({ id: clients.id, fileNo: clients.fileNo })
        .from(clients)
        .where(and(eq(clients.nationalId, nationalId), ne(clients.id, before.id)));
      if (holder) throw new DomainError("ID_TAKEN", `client ${holder.id}`, { fileNo: holder.fileNo });
    }

    const next = { phone, nationality: input.nationality, nationalId, employer: input.employer, city: input.city, email };
    // A number written another way is the same number: it is stored in the one form and is no change.
    const same = (key: (typeof CONTACT_FIELDS)[number]) => (key === "phone" ? normalizePhone(before.phone) === next.phone : before[key] === next[key]);
    const changed = CONTACT_FIELDS.filter((key) => !same(key));
    if (changed.length || before.phone !== next.phone) {
      await tx
        .update(clients)
        .set({ ...next, ...(changed.length ? { updatedAt: now } : {}) })
        .where(eq(clients.id, before.id));
    }
    const adopted = phone ? await adoptMessages(tx, { clientId: before.id, phone }) : 0;
    if (changed.length || adopted) await audit(tx, args.actor, "client.contact", "client", before.id, { changed, adopted });
    return { adopted };
  });
}

/**
 * Records that the client agreed to the office keeping and reading their data and their credit
 * report, or that they took it back. The day is kept on the file and the audit log says who recorded it.
 */
export async function setConsent(db: Db, args: { clientId: number; given: boolean; actor: Actor; now?: Date }): Promise<void> {
  const now = args.now ?? new Date();
  await db.transaction(async (tx) => {
    const [client] = await tx.select({ id: clients.id, consentAt: clients.consentAt }).from(clients).where(eq(clients.id, args.clientId));
    if (!client) throw new DomainError("NOT_FOUND", `client ${args.clientId}`);
    if ((client.consentAt != null) === args.given) return;
    await tx.update(clients).set({ consentAt: args.given ? now : null, updatedAt: now }).where(eq(clients.id, client.id));
    await audit(tx, args.actor, "client.consent", "client", client.id, { given: args.given });
  });
}

const NOTE_MAX = 1000;

/** Leaves a note on a client's file, for whoever opens it next. */
export async function addNote(db: Db, args: { clientId: number; body: string; actor: Actor; now?: Date }): Promise<void> {
  const body = args.body.replace(/[ \t]+/g, " ").trim();
  if (!body) throw new DomainError("NOTE_EMPTY");
  if (body.length > NOTE_MAX) throw new DomainError("INVALID_INPUT", "note too long");
  const now = args.now ?? new Date();
  await db.transaction(async (tx) => {
    const [client] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, args.clientId));
    if (!client) throw new DomainError("NOT_FOUND", `client ${args.clientId}`);
    const [note] = await tx.insert(notes).values({ clientId: client.id, kind: "note", body, userId: args.actor.userId, createdAt: now }).returning({ id: notes.id });
    await audit(tx, args.actor, "client.note", "client", client.id, { noteId: note!.id });
  });
}
