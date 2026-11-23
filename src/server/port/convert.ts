import "server-only";
import { ZodError } from "zod";
import { ROLES } from "@/domain/auth";
import { borrowerIn, defaultDealInput, dealStudy, normalizeFee, STAGES, type DealInput, type Stage } from "@/domain/deal";
import { CUSTOM_PREFIX, INBOX_PAPER, isCustomCode, isFileKind, isPaperCode, type FileKind } from "@/domain/documents";
import { DECISIONS, RULE_KINDS } from "@/domain/knowledge";
import { parseStored } from "../credit/input";
import type * as schema from "../db/schema";
import { parseDealInput } from "../deals/input";
import { dealColumnsOf, itemRowsOf } from "../deals/mapping";
import type { LegacyData, LegacyRow } from "./legacy";

/**
 * Turns the old system's rows into the rows of this one. Nothing here touches a database.
 *
 * Every row keeps its id, so whatever points at it still does. Two things change shape: a deal's
 * JSON becomes columns, items and stage events, and a paper's file moves to a table of its own.
 * Whatever cannot be carried over as it is, is said in a finding and never guessed. A finding names a
 * row by its id and never by a person's name or a file's name, so the report can be read anywhere.
 */

/**
 * - `stop`: the row cannot be carried over as it is. Nothing is written while one stands.
 * - `note`: carried over with a change, or left behind on purpose. Worth reading before the switch.
 */
export interface Finding {
  level: "stop" | "note";
  table: string;
  id: number | null;
  what: string;
}

type Insert<T extends { $inferInsert: unknown }> = T["$inferInsert"];

export interface PortedFile {
  /** `kind` and `size` are what the old row said. The bytes have the last word when they are read. */
  row: Insert<typeof schema.documentFiles> & { id: number };
  /** The old document row whose stored content this file is. */
  from: number;
}

export interface DealCheck {
  dealId: number;
  clientId: number;
  /** The figures the old system stored at its last save. */
  before: { capital: number | null; fee: number | null; clientNet: number | null; verdict: string | null };
  /** The figures this engine gives on the same numbers today. */
  now: { capital: number; fee: number; clientNet: number; verdict: string };
}

export interface Ported {
  users: (Insert<typeof schema.users> & { id: number })[];
  passkeys: Insert<typeof schema.passkeys>[];
  lenders: Insert<typeof schema.lenders>[];
  products: Insert<typeof schema.products>[];
  lenderRules: Insert<typeof schema.lenderRules>[];
  clients: (Insert<typeof schema.clients> & { id: number })[];
  obligations: Insert<typeof schema.obligations>[];
  documents: (Insert<typeof schema.documents> & { id: number })[];
  files: PortedFile[];
  creditReports: Insert<typeof schema.creditReports>[];
  applications: Insert<typeof schema.applications>[];
  outcomes: Insert<typeof schema.outcomes>[];
  notes: Insert<typeof schema.notes>[];
  studies: Insert<typeof schema.studies>[];
  deals: (Insert<typeof schema.deals> & { id: number })[];
  dealItems: Insert<typeof schema.dealItems>[];
  dealStageEvents: Insert<typeof schema.dealStageEvents>[];
  waMessages: Insert<typeof schema.waMessages>[];
  auditLog: Insert<typeof schema.auditLog>[];
  dealChecks: DealCheck[];
  findings: Finding[];
}

// ---------- reading a value as the old system stored it ----------

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);
const num = (value: unknown): number | null => (value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));
const int = (value: unknown): number | null => {
  const n = num(value);
  return n == null ? null : Math.trunc(n);
};
const yes = (value: unknown): boolean => value === true || value === 1 || value === "1" || value === "t" || value === "true";
const yesOrUnknown = (value: unknown): boolean | null => (value == null || value === "" ? null : yes(value));
const idOf = (row: LegacyRow): number => Number(row.id);

/** A time the old system wrote: UTC, as `2026-11-20 14:03:22`, sometimes without seconds, sometimes ISO. */
export function legacyTime(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?(?:Z|\+00(?::?00)?)?$/.exec(value.trim());
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Number((m[7] ?? "0").slice(0, 3).padEnd(3, "0"));
  const date = new Date(Date.UTC(year, month - 1, day, Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0), ms));
  // A day the calendar does not have rolls over into the next month: that is not the day that was written.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

/** A calendar day the old system wrote, as `2026-11-20`. */
export function legacyDay(value: unknown): string | null {
  const date = typeof value === "string" ? legacyTime(value.trim().slice(0, 10)) : null;
  return date ? date.toISOString().slice(0, 10) : null;
}

function json(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const stringList = (value: unknown): string[] | null => (Array.isArray(value) && value.every((item) => typeof item === "string") ? (value as string[]) : null);

// ---------- the audit log ----------

/** What each event of the old log is called here. An event with no like keeps a name of its own. */
const AUDIT_NAME: Record<string, string> = {
  login: "login",
  login_failed: "login_failed",
  logout: "logout",
  user_create: "user.create",
  user_update: "user.update",
  phone_update: "user.update",
  password_change: "user.password",
  totp_enable: "user.authenticator_on",
  totp_disable: "user.authenticator_off",
  passkey_add: "user.passkey_add",
  passkey_delete: "user.passkey_remove",
  sudo: "user.confirm",
  client_create: "client.create",
  client_update: "client.update",
  note_add: "client.note",
  simah_upload: "credit.report_add",
  simah_confirm: "credit.report_review",
  deal_save: "deal.save",
  deal_stage: "deal.stage",
  doc_upload: "doc.upload",
  doc_status: "doc.review",
  doc_download: "doc.open",
  wa_send: "wa.send",
  share_link: "link.open",
  share_revoke: "link.close",
  product_create: "lender.product_add",
  product_update: "lender.product_update",
  rule_add: "lender.rule_add",
  rule_archive: "lender.rule_archive",
  outcome_record: "lender.decision",
  client_view_pii: "old.view",
  client_delete: "old.delete",
  export: "old.export",
  study_save: "old.study",
  obligation_add: "old.obligation_add",
  obligation_delete: "old.obligation_remove",
  app_create: "old.application_add",
  app_update: "old.application_update",
};

const SIGNIN_METHODS = new Set(["password", "passkey", "totp", "code", "whatsapp"]);

/** One event of the old log under the name this system gives it, with what the old one kept beside it. */
export function auditEvent(action: string, details: unknown): { action: string; details: Record<string, unknown> } {
  const read = json(details);
  const kept: Record<string, unknown> = isRecord(read) ? { ...read } : typeof details === "string" && details.trim() ? { said: details.trim() } : {};
  const said = typeof kept.said === "string" ? kept.said : null;

  if (action === "client_status") {
    const name = kept.to === "rejected" ? "client.reject" : kept.from === "rejected" && kept.to === "study" ? "client.reopen" : "old.status";
    return { action: name, details: { ...kept, was: action } };
  }
  if (action === "login" && said) return { action, details: SIGNIN_METHODS.has(said) ? { method: said } : kept };
  if (action === "login_failed" && said) {
    if (said.includes("@")) return { action, details: { email: said } };
    if (said === "code-locked") return { action, details: { method: "code", stopped: true } };
    return { action, details: SIGNIN_METHODS.has(said) ? { method: said } : kept };
  }
  const name = AUDIT_NAME[action];
  return name ? { action: name, details: name === action ? kept : { ...kept, was: action } } : { action: "old.other", details: { ...kept, was: action } };
}

// ---------- papers and their files ----------

const STATUS_RANK = { missing: 0, rejected: 1, received: 2, verified: 3 } as const;
type PaperStatus = keyof typeof STATUS_RANK;
const isStatus = (value: unknown): value is PaperStatus => typeof value === "string" && Object.hasOwn(STATUS_RANK, value);

const KIND_OF_MIME: Record<string, FileKind> = { "application/pdf": "pdf", "image/jpeg": "jpeg", "image/jpg": "jpeg", "image/png": "png", "image/webp": "webp" };
const KIND_OF_ENDING: Record<string, FileKind> = { pdf: "pdf", jpg: "jpeg", jpeg: "jpeg", png: "png", webp: "webp" };

/** The paper an old document row belongs under: its own code, the inbox for a file from WhatsApp, or a paper added by name. */
function paperCode(code: string): string {
  if (isPaperCode(code) || isCustomCode(code)) return code;
  if (code.startsWith("wa:")) return INBOX_PAPER;
  return `${CUSTOM_PREFIX}${code.replace(/[^A-Za-z0-9_-]/g, "") || "old"}`;
}

// ---------- everything ----------

export function convert(legacy: LegacyData, args: { now: Date }): Ported {
  const { tables } = legacy;
  const { now } = args;
  const findings: Finding[] = [];
  const stop = (table: string, id: number | null, what: string) => findings.push({ level: "stop", table, id, what });
  const note = (table: string, id: number | null, what: string) => findings.push({ level: "note", table, id, what });

  /** A time that has to be there. When the old row holds none that can be read, the day of the move stands in and is said. */
  const timeOr = (table: string, row: LegacyRow, column: string): Date => {
    const read = legacyTime(row[column]);
    if (!read) note(table, idOf(row), `${column} could not be read as a time (${JSON.stringify(row[column] ?? null)}); the time of the move is written instead`);
    return read ?? now;
  };
  /** A time that may be absent. One that is written and cannot be read is said. */
  const timeMaybe = (table: string, row: LegacyRow, column: string): Date | null => {
    if (row[column] == null || row[column] === "") return null;
    const read = legacyTime(row[column]);
    if (!read) note(table, idOf(row), `${column} could not be read as a time (${JSON.stringify(row[column])}); it is left empty`);
    return read;
  };

  const userIds = new Set(tables.users.map(idOf));
  const clientIds = new Set(tables.clients.map(idOf));
  const lenderIds = new Set(tables.lenders.map(idOf));
  /** A reference to a person. One that points at nobody is emptied, as the old schema allowed it to dangle. */
  const person = (value: unknown): number | null => {
    const id = int(value);
    return id != null && userIds.has(id) ? id : null;
  };

  // People.
  const emails = new Map<string, number>();
  const users = tables.users.map((row) => {
    const id = idOf(row);
    const email = String(row.email ?? "").trim();
    const key = email.toLowerCase();
    if (!email) stop("users", id, "the account has no email");
    else if (emails.has(key)) stop("users", id, `the email is the same as account ${emails.get(key)}'s when capitals are ignored, and this system tells accounts apart that way`);
    else emails.set(key, id);
    if (!(ROLES as readonly string[]).includes(String(row.role))) stop("users", id, `role ${JSON.stringify(row.role)} is not one this system has`);
    const createdAt = timeOr("users", row, "created_at");
    return {
      id,
      name: String(row.name ?? ""),
      email,
      passwordHash: String(row.password_hash ?? ""),
      role: row.role as (typeof ROLES)[number],
      active: yes(row.active),
      phone: text(row.phone),
      failedLogins: int(row.failed_logins) ?? 0,
      lockedUntil: timeMaybe("users", row, "locked_until"),
      lastLoginAt: timeMaybe("users", row, "last_login_at"),
      totpSecret: text(row.totp_secret),
      totpEnabled: yes(row.totp_enabled),
      totpLastStep: int(row.totp_last_step) ?? 0,
      otpFails: int(row.otp_fails) ?? 0,
      createdAt,
      updatedAt: createdAt,
    };
  });

  const passkeys = tables.passkeys.flatMap((row) => {
    const userId = person(row.user_id);
    if (userId == null) {
      note("passkeys", idOf(row), "the passkey belongs to an account that no longer exists; it is left behind");
      return [];
    }
    const transports = row.transports == null || row.transports === "" ? null : stringList(json(row.transports));
    if (row.transports && !transports) note("passkeys", idOf(row), "the list of transports could not be read; it is left empty, and the passkey still works");
    return [
      {
        id: idOf(row),
        userId,
        credentialId: String(row.credential_id),
        publicKey: String(row.public_key),
        counter: int(row.counter) ?? 0,
        transports,
        name: text(row.name),
        createdAt: timeOr("passkeys", row, "created_at"),
        lastUsedAt: timeMaybe("passkeys", row, "last_used_at"),
      },
    ];
  });

  // The catalogue.
  const lenders = tables.lenders.map((row) => {
    if (row.type !== "bank" && row.type !== "finance_company") stop("lenders", idOf(row), `type ${JSON.stringify(row.type)} is neither a bank nor a finance company`);
    return { id: idOf(row), name: String(row.name ?? ""), type: row.type as "bank" | "finance_company", bankCode: text(row.bank_code), contact: text(row.contact), active: yes(row.active) };
  });

  const products = tables.products.flatMap((row) => {
    const id = idOf(row);
    const lenderId = int(row.lender_id);
    const sectors = stringList(json(row.sectors));
    const nationalities = stringList(json(row.nationalities));
    const rate = num(row.rate);
    if (lenderId == null || !lenderIds.has(lenderId)) stop("products", id, "the product belongs to no lender");
    if (!sectors) stop("products", id, "the list of sectors could not be read");
    if (!nationalities) stop("products", id, "the list of nationalities could not be read");
    if (rate == null) stop("products", id, "the product has no rate");
    if (lenderId == null || !sectors || !nationalities || rate == null) return [];
    return [
      {
        id,
        lenderId,
        financeType: String(row.finance_type),
        name: String(row.name ?? ""),
        minSalary: num(row.min_salary) ?? 4000,
        minAge: int(row.min_age) ?? 20,
        maxAgeAtMaturity: int(row.max_age_at_maturity) ?? 60,
        minServiceMonths: int(row.min_service_months) ?? 3,
        sectors,
        nationalities,
        maxTenor: int(row.max_tenor) ?? 60,
        maxAmount: num(row.max_amount) ?? 500000,
        rate,
        rateType: text(row.rate_type) ?? "flat",
        requiresSalaryTransfer: yes(row.requires_salary_transfer),
        acceptsLateSimah: yes(row.accepts_late_simah),
        // The old system had no such term. Nobody has confirmed it with any lender yet.
        settledDefaultWaitMonths: null,
        maxLtv: num(row.max_ltv),
        notes: text(row.notes),
        verifiedAt: timeMaybe("products", row, "verified_at"),
        active: yes(row.active),
      },
    ];
  });

  const marked = products.filter((product) => product.verifiedAt != null).length;
  if (marked) note("products", null, `${marked} products were marked as confirmed in the old system, with no source kept for any term; here a term counts as confirmed only with its source, so their terms come over unconfirmed and are confirmed again on the lenders page`);

  const lenderRules = tables.lender_rules.flatMap((row) => {
    const id = idOf(row);
    const lenderId = int(row.lender_id);
    if (!(RULE_KINDS as readonly unknown[]).includes(row.kind)) {
      stop("lender_rules", id, `kind ${JSON.stringify(row.kind)} is not one this system has`);
      return [];
    }
    return [
      {
        id,
        lenderId: lenderId != null && lenderIds.has(lenderId) ? lenderId : null,
        financeType: text(row.finance_type),
        kind: row.kind as (typeof RULE_KINDS)[number],
        title: String(row.title ?? ""),
        body: text(row.body),
        userId: person(row.user_id),
        active: yes(row.active),
        createdAt: timeOr("lender_rules", row, "created_at"),
      },
    ];
  });

  // Clients and what hangs on them.
  const clients = tables.clients.map((row) => {
    const id = idOf(row);
    const extra = row.extra == null || row.extra === "" ? null : json(row.extra);
    if (row.extra && !isRecord(extra)) note("clients", id, "the extra details could not be read; they are left empty");
    if (row.consent_at == null || row.consent_at === "") note("clients", id, "no consent is on this file; the analysis will ask for it before anyone relies on it");
    return {
      id,
      fileNo: String(row.file_no),
      fullName: String(row.full_name ?? ""),
      nationalId: text(row.national_id),
      phone: text(row.phone),
      email: text(row.email),
      birthYear: int(row.birth_year),
      nationality: text(row.nationality) ?? "saudi",
      maritalStatus: text(row.marital_status),
      dependents: int(row.dependents),
      city: text(row.city),
      employer: text(row.employer),
      sector: text(row.sector) ?? "gov",
      jobTitle: text(row.job_title),
      serviceMonths: int(row.service_months),
      basicSalary: num(row.basic_salary),
      totalSalary: num(row.total_salary),
      otherIncome: num(row.other_income),
      salaryBank: text(row.salary_bank),
      simah: text(row.simah) ?? "unknown",
      ownsHome: yesOrUnknown(row.owns_home),
      housingSupport: yes(row.housing_support),
      propertyValue: num(row.property_value),
      coIncome: num(row.co_income),
      extra: isRecord(extra) ? extra : null,
      financeType: text(row.finance_type) ?? "personal",
      requestedAmount: num(row.requested_amount),
      requestedTenor: int(row.requested_tenor),
      purpose: text(row.purpose),
      priority: text(row.priority),
      status: text(row.status) ?? "study",
      eligibility: text(row.eligibility) ?? "pending",
      nextStep: text(row.next_step),
      nextStepDue: legacyDay(row.next_step_due),
      ownerId: person(row.owner_id),
      source: text(row.source),
      consentAt: timeMaybe("clients", row, "consent_at"),
      createdAt: timeOr("clients", row, "created_at"),
      updatedAt: timeOr("clients", row, "updated_at"),
    };
  });
  const clientById = new Map(clients.map((client) => [client.id, client]));

  /** Whether a row hangs on a client that exists. The old schema removed such rows with the client, so one left over is an orphan. */
  const ofClient = (table: string, row: LegacyRow): number | null => {
    const clientId = int(row.client_id);
    if (clientId != null && clientIds.has(clientId)) return clientId;
    note(table, idOf(row), "the row belongs to a client that no longer exists; it is left behind");
    return null;
  };

  const obligationRows = tables.obligations.flatMap((row) => {
    const clientId = ofClient("obligations", row);
    return clientId == null ? [] : [{ id: idOf(row), clientId, kind: String(row.kind), lender: text(row.lender), monthly: num(row.monthly) ?? 0, remaining: num(row.remaining), endDate: legacyDay(row.end_date) }];
  });

  // Papers. One row per paper of a client; each stored file becomes a row of its own under it.
  const documents: Ported["documents"] = [];
  const files: PortedFile[] = [];
  const paperOf = new Map<string, Ported["documents"][number]>();
  /** The file each old document row became. A credit report and a message point at files through it. */
  const fileOfDoc = new Map<number, number>();
  let waiting = 0;

  for (const row of tables.documents) {
    const id = idOf(row);
    const clientId = ofClient("documents", row);
    if (clientId == null) continue;
    const oldCode = String(row.code ?? "");
    const code = paperCode(oldCode);
    const status: PaperStatus = isStatus(row.status) ? row.status : "missing";
    const size = legacy.blobSizes.get(id) ?? null;
    const named = text(row.file_name) != null || text(row.sha256) != null;
    const custom = isCustomCode(code);

    // A paper nothing happened to is no longer stored: what a file needs is worked out when it is shown.
    if (!custom && status === "missing" && size == null && !named) {
      waiting += 1;
      continue;
    }
    if (!isPaperCode(oldCode) && !isCustomCode(oldCode) && !oldCode.startsWith("wa:")) note("documents", id, `code ${JSON.stringify(oldCode)} is not a paper this system knows; it is kept as a paper added by name`);

    const uploadedAt = timeMaybe("documents", row, "uploaded_at");
    const client = clientById.get(clientId)!;
    const key = `${clientId}:${code}`;
    let paper = paperOf.get(key);
    if (!paper) {
      paper = { id: documents.length + 1, clientId, code, label: custom ? (text(row.label) ?? oldCode) : null, status: "missing", note: null, createdAt: uploadedAt ?? client.createdAt, updatedAt: uploadedAt ?? client.updatedAt };
      paperOf.set(key, paper);
      documents.push(paper);
    } else if (!oldCode.startsWith("wa:")) {
      note("documents", id, `the old file held paper ${JSON.stringify(code)} twice; both are kept as one paper`);
    }
    const said: PaperStatus = code === INBOX_PAPER ? "received" : status;
    if (STATUS_RANK[said] >= STATUS_RANK[paper.status as PaperStatus]) {
      paper.status = said;
      // A note is kept only as the reason a paper was sent back, which is what this system keeps one for.
      paper.note = said === "rejected" ? text(row.note) : null;
    }
    if (uploadedAt && uploadedAt > (paper.updatedAt as Date)) paper.updatedAt = uploadedAt;

    if (size == null) {
      if (named) note("documents", id, "the old row names a file and holds no content for it; the paper comes over without a file");
      continue;
    }
    const sha256 = text(row.sha256);
    if (!sha256) {
      stop("documents", id, "the stored file has no fingerprint to check its content against");
      continue;
    }
    const name = text(row.file_name) ?? "file";
    const ending = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
    const kind = KIND_OF_MIME[String(row.mime ?? "").split(";")[0]!.trim().toLowerCase()] ?? KIND_OF_ENDING[ending] ?? null;
    if (!kind || !isFileKind(kind)) {
      note("documents", id, `the file is of a type this system does not open (${JSON.stringify(row.mime ?? null)}); it is left behind`);
      continue;
    }
    const same = files.find((file) => file.row.docId === paper.id && file.row.sha256 === sha256);
    if (same) {
      fileOfDoc.set(id, same.row.id);
      note("documents", id, "the file is the same as one already under this paper; it is kept once");
      continue;
    }
    const fileId = files.length + 1;
    fileOfDoc.set(id, fileId);
    files.push({
      row: { id: fileId, docId: paper.id, name: name.slice(0, 200), kind, size, sha256, uploadedBy: person(row.uploaded_by), uploadedAt: uploadedAt ?? (paper.createdAt as Date) },
      from: id,
    });
  }
  if (waiting) note("documents", null, `${waiting} papers that were only asked for and never arrived are not carried over: this system works out what a file needs when it shows it`);

  const creditReports = tables.credit_reports.flatMap((row) => {
    const id = idOf(row);
    const clientId = ofClient("credit_reports", row);
    if (clientId == null) return [];
    const report = json(row.report);
    try {
      parseStored(report);
    } catch (error) {
      const why = error instanceof ZodError ? error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") : String(error);
      stop("credit_reports", id, `the stored report does not read as a credit record here (${why})`);
      return [];
    }
    const docId = int(row.doc_id);
    return [
      {
        id,
        clientId,
        // Kept as it was stored. It is read through the same check every time it is shown.
        report: report as Record<string, unknown>,
        grade: text(row.grade),
        derivedSimah: text(row.derived_simah),
        fileId: docId == null ? null : (fileOfDoc.get(docId) ?? null),
        userId: person(row.user_id),
        createdAt: timeOr("credit_reports", row, "created_at"),
      },
    ];
  });

  const applicationIds = new Set<number>();
  const applications = tables.applications.flatMap((row) => {
    const clientId = ofClient("applications", row);
    if (clientId == null) return [];
    const lenderId = int(row.lender_id);
    applicationIds.add(idOf(row));
    return [
      {
        id: idOf(row),
        clientId,
        lenderId: lenderId != null && lenderIds.has(lenderId) ? lenderId : null,
        productName: text(row.product_name),
        amount: num(row.amount),
        tenor: int(row.tenor),
        installment: num(row.installment),
        refNo: text(row.ref_no),
        status: text(row.status) ?? "draft",
        submittedAt: timeMaybe("applications", row, "submitted_at"),
        decidedAt: timeMaybe("applications", row, "decided_at"),
        note: text(row.note),
        createdBy: person(row.created_by),
        createdAt: timeOr("applications", row, "created_at"),
        updatedAt: timeOr("applications", row, "updated_at"),
      },
    ];
  });

  const outcomes = tables.outcomes.flatMap((row) => {
    const id = idOf(row);
    const lenderId = int(row.lender_id);
    if (lenderId == null || !lenderIds.has(lenderId)) {
      note("outcomes", id, "the decision is of a lender that no longer exists; it is left behind");
      return [];
    }
    if (!(DECISIONS as readonly unknown[]).includes(row.decision)) {
      stop("outcomes", id, `decision ${JSON.stringify(row.decision)} is not one this system has`);
      return [];
    }
    const conditions = stringList(json(row.conditions));
    if (!conditions) note("outcomes", id, "the list of what the lender asked for could not be read; it is left empty");
    const applicationId = int(row.application_id);
    const clientId = int(row.client_id);
    return [
      {
        id,
        applicationId: applicationId != null && applicationIds.has(applicationId) ? applicationId : null,
        clientId: clientId != null && clientIds.has(clientId) ? clientId : null,
        lenderId,
        financeType: String(row.finance_type),
        sector: String(row.sector),
        salary: num(row.salary),
        age: int(row.age),
        simah: text(row.simah),
        decision: row.decision as (typeof DECISIONS)[number],
        requestedAmount: num(row.requested_amount),
        estimatedAmount: num(row.estimated_amount),
        approvedAmount: num(row.approved_amount),
        approvedRate: num(row.approved_rate),
        approvedTenor: int(row.approved_tenor),
        conditions: conditions ?? [],
        reason: text(row.reason),
        note: text(row.note),
        userId: person(row.user_id),
        createdAt: timeOr("outcomes", row, "created_at"),
      },
    ];
  });

  const notes = tables.notes.flatMap((row) => {
    const clientId = ofClient("notes", row);
    return clientId == null ? [] : [{ id: idOf(row), clientId, kind: text(row.kind) ?? "note", body: String(row.body ?? ""), userId: person(row.user_id), createdAt: timeOr("notes", row, "created_at") }];
  });

  const studies = tables.studies.flatMap((row) => {
    const clientId = ofClient("studies", row);
    if (clientId == null) return [];
    const snapshot = json(row.snapshot);
    if (snapshot === undefined) note("studies", idOf(row), "the saved study could not be read; it is kept as the text it was");
    return [
      {
        id: idOf(row),
        clientId,
        verdict: String(row.verdict),
        snapshot: snapshot === undefined ? { text: String(row.snapshot) } : (snapshot ?? {}),
        analystOpinion: text(row.analyst_opinion),
        userId: person(row.user_id),
        createdAt: timeOr("studies", row, "created_at"),
      },
    ];
  });

  // Deals. The old system kept one per client, with its numbers as JSON and its road as a list.
  const deals: Ported["deals"] = [];
  const dealItems: Ported["dealItems"] = [];
  const dealStageEvents: Ported["dealStageEvents"] = [];
  const dealChecks: DealCheck[] = [];
  const stageNames = new Set<string>(STAGES.map(([stage]) => stage));
  const userByName = new Map<string, number | null>();
  for (const user of users) userByName.set(user.name, userByName.has(user.name) ? null : user.id);

  for (const row of tables.deals) {
    const id = idOf(row);
    const clientId = ofClient("deals", row);
    if (clientId == null) continue;
    const client = clientById.get(clientId)!;
    const raw = json(row.data);
    if (!isRecord(raw)) {
      stop("deals", id, "the deal's numbers could not be read");
      continue;
    }
    if (!stageNames.has(String(row.stage))) {
      stop("deals", id, `stage ${JSON.stringify(row.stage)} is not on the road`);
      continue;
    }
    const stage = row.stage as Stage;

    // The old screen filled a payoff's missing installment from the client's recorded obligations every
    // time it showed the deal. The same is done once here, so the deal's numbers stay the ones the office saw.
    const owed = obligationRows.filter((o) => o.clientId === clientId);
    const items = Array.isArray(raw.items) ? raw.items : [];
    const filled = items.map((item: unknown) => {
      if (!isRecord(item) || item.monthly != null) return item;
      const kind = item.kind === "mortgage_payoff" ? "mortgage" : item.kind === "personal_payoff" ? "personal" : null;
      if (!kind) return item;
      const label = typeof item.label === "string" ? item.label : "";
      const match = owed.find((o) => o.kind === kind && (!o.lender || label.includes(o.lender))) ?? owed.find((o) => o.kind === kind);
      if (!match) return item;
      note("deals", id, `a ${kind} payoff had no installment; ${match.monthly} is taken from the client's recorded obligation, as the old screen did`);
      return { ...item, monthly: match.monthly };
    });

    let input: DealInput;
    try {
      input = parseDealInput({ ...defaultDealInput(), ...raw, items: filled, fee: normalizeFee(raw.fee) });
    } catch (error) {
      const why = error instanceof ZodError ? error.issues.slice(0, 4).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") : String(error);
      stop("deals", id, `the deal's numbers do not pass this system's checks (${why})`);
      continue;
    }

    const study = dealStudy(input, borrowerIn(client, now.getFullYear()));
    const createdAt = timeOr("deals", row, "created_at");
    const updatedAt = timeOr("deals", row, "updated_at");
    deals.push({
      id,
      clientId,
      stage,
      ...dealColumnsOf(input),
      capital: study.capital,
      fee: study.fee,
      clientNet: study.clientNet,
      verdict: study.verdict,
      computedAt: now,
      ownerId: person(row.user_id),
      createdAt,
      updatedAt,
    });
    dealItems.push(...itemRowsOf(id, input.items));
    dealChecks.push({
      dealId: id,
      clientId,
      before: { capital: num(row.capital), fee: num(row.fee), clientNet: num(row.client_net), verdict: text(row.verdict) },
      now: { capital: study.capital, fee: study.fee, clientNet: study.clientNet, verdict: study.verdict },
    });

    // The road so far.
    const log = json(row.stage_log);
    const steps = (Array.isArray(log) ? log : []).flatMap((entry: unknown) => {
      if (!isRecord(entry) || !stageNames.has(String(entry.stage))) return [];
      const at = legacyTime(entry.at);
      const by = typeof entry.by === "string" ? entry.by : null;
      return [{ dealId: id, stage: entry.stage as Stage, note: text(entry.note), userId: by ? (userByName.get(by) ?? null) : null, createdAt: at ?? createdAt }];
    });
    if (Array.isArray(log) && steps.length !== log.length) note("deals", id, `${log.length - steps.length} entries of the deal's road could not be read and are left out`);
    if (!steps.length) steps.push({ dealId: id, stage: "study", note: null, userId: person(row.user_id), createdAt });
    if (steps[steps.length - 1]!.stage !== stage) {
      note("deals", id, `the deal stands at ${stage} and its road ends at ${steps[steps.length - 1]!.stage}; the stage it stands at is added to the road`);
      steps.push({ dealId: id, stage, note: null, userId: null, createdAt: updatedAt });
    }
    dealStageEvents.push(...steps);
  }

  // Messages.
  const waIds = new Set<string>();
  const waMessages = tables.wa_messages.flatMap((row) => {
    const id = idOf(row);
    if (row.direction !== "in" && row.direction !== "out") {
      stop("wa_messages", id, `direction ${JSON.stringify(row.direction)} is neither in nor out`);
      return [];
    }
    const waId = text(row.wa_id);
    if (waId && waIds.has(waId)) {
      note("wa_messages", id, "the message is stored twice; it is kept once");
      return [];
    }
    if (waId) waIds.add(waId);
    const clientId = int(row.client_id);
    const docId = int(row.doc_id);
    return [
      {
        id,
        clientId: clientId != null && clientIds.has(clientId) ? clientId : null,
        direction: row.direction as "in" | "out",
        waId,
        phone: String(row.phone ?? ""),
        name: text(row.name),
        type: text(row.type) ?? "text",
        body: text(row.body),
        fileId: docId == null ? null : (fileOfDoc.get(docId) ?? null),
        status: text(row.status),
        error: text(row.error),
        userId: person(row.user_id),
        // The old system did not record that a message was dealt with. The inbox shows what still waits.
        seenAt: null,
        createdAt: timeOr("wa_messages", row, "created_at"),
        updatedAt: timeOr("wa_messages", row, "updated_at"),
      },
    ];
  });

  // The old links are 24 characters and were stored as they are. This system keeps a hash and a seed and
  // hands out 32. A link in a client's hands stops opening at the switch; the office sends a new one.
  const openLinks = tables.share_links.filter((row) => !yes(row.revoked) && (legacyTime(row.expires_at)?.getTime() ?? 0) > now.getTime());
  if (openLinks.length) {
    const who = [...new Set(openLinks.map((row) => clientById.get(int(row.client_id) ?? -1)?.fileNo ?? "?"))].join(", ");
    note("share_links", null, `${openLinks.length} client links are open and will stop opening at the switch (files ${who}); send each client a new one from the messages page`);
  }

  const auditLog = tables.audit_log.map((row) => {
    const event = auditEvent(String(row.action ?? ""), row.details);
    return {
      id: idOf(row),
      userId: person(row.user_id),
      action: event.action,
      entity: text(row.entity),
      entityId: int(row.entity_id),
      details: Object.keys(event.details).length ? event.details : null,
      ip: text(row.ip),
      createdAt: timeOr("audit_log", row, "created_at"),
    };
  });
  const unknown = auditLog.filter((line) => line.action === "old.other").length;
  if (unknown) note("audit_log", null, `${unknown} events of the old log have a name this system does not know; they are kept and shown as events of the old system`);

  return {
    users,
    passkeys,
    lenders,
    products,
    lenderRules,
    clients,
    obligations: obligationRows,
    documents,
    files,
    creditReports,
    applications,
    outcomes,
    notes,
    studies,
    deals,
    dealItems,
    dealStageEvents,
    waMessages,
    auditLog,
    dealChecks,
    findings,
  };
}
