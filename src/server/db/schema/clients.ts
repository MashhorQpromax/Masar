import { boolean, date, index, integer, jsonb, text, uniqueIndex } from "drizzle-orm/pg-core";
import { at, bytea, createdAt, id, masar, money, percent } from "./_shared";
import { users } from "./identity";
import { lenders, productConditions } from "./lenders";

export const documentStatus = masar.enum("document_status", ["missing", "received", "verified", "rejected"]);
export const outcomeDecision = masar.enum("outcome_decision", ["approved", "approved_modified", "rejected"]);

export const clients = masar.table(
  "clients",
  {
    id: id(),
    fileNo: text().notNull().unique(),
    fullName: text().notNull(),
    nationalId: text(),
    phone: text(),
    email: text(),
    birthYear: integer(),
    nationality: text().notNull().default("saudi"),
    maritalStatus: text(),
    dependents: integer(),
    city: text(),
    employer: text(),
    sector: text().notNull().default("gov"),
    jobTitle: text(),
    /** How the client is employed: permanent, for a fixed term, or on probation. Null: nobody wrote it down. */
    contractType: text(),
    serviceMonths: integer(),
    basicSalary: money(),
    totalSalary: money(),
    otherIncome: money(),
    salaryBank: text(),
    simah: text().notNull().default("unknown"),
    ownsHome: boolean(),
    housingSupport: boolean().notNull().default(false),
    propertyValue: money(),
    coIncome: money(),
    /** Fields that only some finance types need, such as project finance details. */
    extra: jsonb().$type<Record<string, unknown>>(),
    financeType: text().notNull().default("personal"),
    requestedAmount: money(),
    requestedTenor: integer(),
    purpose: text(),
    priority: text(),
    status: text().notNull().default("study"),
    eligibility: text().notNull().default("pending"),
    nextStep: text(),
    nextStepDue: date(),
    ownerId: integer().references(() => users.id, { onDelete: "set null" }),
    source: text(),
    /** When the client consented to processing their personal data (PDPL). */
    consentAt: at(),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [index("clients_status_idx").on(t.status), index("clients_owner_idx").on(t.ownerId)],
);

export const obligations = masar.table(
  "obligations",
  {
    id: id(),
    clientId: integer()
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    lender: text(),
    monthly: money().notNull(),
    remaining: money(),
    endDate: date(),
  },
  (t) => [index("obligations_client_idx").on(t.clientId)],
);

/**
 * What a person answered about one client and one of a lender's special conditions. One row per
 * condition and client: answering again replaces it, and the audit log keeps what stood before. No
 * row means nobody answered, which is never read as the condition being met.
 */
export const conditionAnswers = masar.table(
  "condition_answers",
  {
    id: id(),
    conditionId: integer()
      .notNull()
      .references(() => productConditions.id, { onDelete: "cascade" }),
    clientId: integer()
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    answer: text().notNull(),
    userId: integer().references(() => users.id, { onDelete: "set null" }),
    answeredAt: createdAt(),
  },
  (t) => [uniqueIndex("condition_answers_condition_client_idx").on(t.conditionId, t.clientId), index("condition_answers_client_idx").on(t.clientId)],
);

/**
 * A paper of a client's file: one the engine knows by its code, or one a person added by name.
 * A row appears once something happens to the paper. What a deal needs is worked out, not stored.
 */
export const documents = masar.table(
  "documents",
  {
    id: id(),
    clientId: integer()
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    code: text().notNull(),
    /** The name a person gave a paper they added. Null for a paper known by its code. */
    label: text(),
    status: documentStatus().notNull().default("missing"),
    /** Why the paper was sent back. */
    note: text(),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [uniqueIndex("documents_client_code_idx").on(t.clientId, t.code)],
);

/** A file kept for a paper. A paper holds several: a statement photographed page by page is one paper. */
export const documentFiles = masar.table(
  "document_files",
  {
    id: id(),
    docId: integer()
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    name: text().notNull(),
    /** What the file really is, read from its bytes: pdf, jpeg, png or webp. */
    kind: text().notNull(),
    size: integer().notNull(),
    sha256: text().notNull(),
    uploadedBy: integer().references(() => users.id, { onDelete: "set null" }),
    uploadedAt: createdAt(),
  },
  (t) => [uniqueIndex("document_files_doc_sha_idx").on(t.docId, t.sha256)],
);

/** File contents, kept apart from the file row so listing files never loads them. */
export const fileBlobs = masar.table("file_blobs", {
  fileId: integer()
    .primaryKey()
    .references(() => documentFiles.id, { onDelete: "cascade" }),
  data: bytea().notNull(),
});

export const notes = masar.table(
  "notes",
  {
    id: id(),
    clientId: integer()
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    kind: text().notNull().default("note"),
    body: text().notNull(),
    userId: integer().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("notes_client_idx").on(t.clientId)],
);

/** A saved eligibility study: the verdict and the full snapshot it was based on. */
export const studies = masar.table(
  "studies",
  {
    id: id(),
    clientId: integer()
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    verdict: text().notNull(),
    snapshot: jsonb().notNull(),
    analystOpinion: text(),
    userId: integer().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("studies_client_idx").on(t.clientId)],
);

export const creditReports = masar.table(
  "credit_reports",
  {
    id: id(),
    clientId: integer()
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /** The parsed SIMAH report. */
    report: jsonb().notNull(),
    grade: text(),
    derivedSimah: text(),
    /** The PDF the report was read from, kept with the client's papers. */
    fileId: integer().references(() => documentFiles.id, { onDelete: "set null" }),
    userId: integer().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("credit_reports_client_idx").on(t.clientId)],
);

export const applications = masar.table(
  "applications",
  {
    id: id(),
    clientId: integer()
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    lenderId: integer().references(() => lenders.id, { onDelete: "set null" }),
    productName: text(),
    amount: money(),
    tenor: integer(),
    installment: money(),
    refNo: text(),
    status: text().notNull().default("draft"),
    submittedAt: at(),
    decidedAt: at(),
    note: text(),
    createdBy: integer().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [index("applications_client_idx").on(t.clientId)],
);

/** What a lender actually decided. The matching engine learns from these. */
export const outcomes = masar.table(
  "outcomes",
  {
    id: id(),
    applicationId: integer().references(() => applications.id, { onDelete: "set null" }),
    clientId: integer().references(() => clients.id, { onDelete: "set null" }),
    lenderId: integer()
      .notNull()
      .references(() => lenders.id, { onDelete: "cascade" }),
    financeType: text().notNull(),
    sector: text().notNull(),
    salary: money(),
    age: integer(),
    simah: text(),
    decision: outcomeDecision().notNull(),
    requestedAmount: money(),
    estimatedAmount: money(),
    approvedAmount: money(),
    approvedRate: percent(),
    approvedTenor: integer(),
    conditions: jsonb().$type<string[]>().notNull().default([]),
    reason: text(),
    note: text(),
    userId: integer().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("outcomes_lender_idx").on(t.lenderId, t.financeType)],
);
