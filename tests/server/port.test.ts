import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditAction } from "@/copy/audit";
import { emptyReport } from "@/domain/credit";
import { getAnalysis } from "@/server/analysis/service";
import { readAudit } from "@/server/audit/log";
import { seal, unseal } from "@/server/auth/secret";
import { latestCredit } from "@/server/credit/service";
import { connect, type Connection } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { getDeal } from "@/server/deals/service";
import { getPapers, openPaperFile } from "@/server/documents/service";
import { auditEvent, legacyDay, legacyTime } from "@/server/port/convert";
import { rehearse } from "@/server/port/rehearse";
import { planRelease } from "@/server/port/release";
import { mayGoLive, portData, queryOn, reportLines, safeError, type PortResult } from "@/server/port/run";
import { SYSTEM } from "@/server/shared/actor";
import { pgSchema } from "../../legacy/lib/schema";
import { testDb } from "../helpers/db";

/**
 * The move from the old system's tables to this one's, on a database that holds both, as the live one
 * does: the old tables in `public`, written by the old system's own schema, and this system's in `masar`.
 * Every person and number here is made up.
 */
const now = new Date("2026-11-23T09:00:00Z");
let c: Connection;

const pdf = new TextEncoder().encode("%PDF-1.4\nan identity card, made up\n%%EOF");
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);
const report = new TextEncoder().encode("%PDF-1.4\na credit report, made up\n%%EOF");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function oldSchema(connection: Connection): Promise<void> {
  for (const statement of pgSchema(false).split(/;\s*\n/)) {
    if (statement.trim()) await connection.db.execute(sql.raw(statement));
  }
}

async function put(connection: Connection, table: string, row: Record<string, unknown>): Promise<void> {
  const columns = Object.keys(row);
  const values = sql.join(
    columns.map((column) => sql`${row[column]}`),
    sql`, `,
  );
  await connection.db.execute(sql`INSERT INTO ${sql.raw(`public.${table}`)} (${sql.raw(columns.join(", "))}) VALUES (${values})`);
}

const count = async (connection: Connection, table: string): Promise<number> => Number((await queryOn(connection.db)(`SELECT count(*) AS n FROM ${table}`))[0]!.n);

/** An old office of two people, two clients, one deal on the road and the papers around it. */
async function fill(connection: Connection): Promise<void> {
  const o = (table: string, row: Record<string, unknown>) => put(connection, table, row);

  await o("users", { id: 1, name: "مدير المكتب", email: "Admin@example.com", password_hash: "$2a$12$abcdefghijklmnopqrstuuJ8Zq0u1mC0b9r7m1bq3n5d7f9h1j3l5", role: "admin", totp_secret: seal("JBSWY3DPEHPK3PXP"), totp_enabled: 1, totp_last_step: 58000000, phone: "0500000001", last_login_at: "2026-11-20 08:15:00", created_at: "2026-01-05 10:00:00" });
  await o("users", { id: 2, name: "موظف", email: "officer@example.com", password_hash: "$2a$12$abcdefghijklmnopqrstuuJ8Zq0u1mC0b9r7m1bq3n5d7f9h1j3l5", role: "officer", active: 0, created_at: "2026-02-01 10:00:00" });
  await o("passkeys", { id: 4, user_id: 1, credential_id: "cred-1", public_key: "a2V5", counter: 7, transports: '["internal","hybrid"]', name: "جوال", created_at: "2026-03-01 09:00:00", last_used_at: "2026-11-19 07:00:00" });
  await o("sessions", { token_hash: "h1", user_id: 1, expires_at: "2026-12-01 00:00:00" });
  await o("login_codes", { id: 1, user_id: 1, code_hash: "x", expires_at: "2026-11-20 08:20:00" });

  await o("lenders", { id: 3, name: "مصرف الراجحي", type: "bank", bank_code: "rajhi" });
  await o("lenders", { id: 9, name: "شركة تمويل مختلقة", type: "finance_company", active: 1 });
  await o("products", { id: 5, lender_id: 3, finance_type: "mortgage", name: "عقاري", sectors: '["gov","military"]', nationalities: '["saudi"]', max_tenor: 300, max_amount: 5000000, rate: 4.2, rate_type: "reducing", max_ltv: 90, verified_at: "2026-10-01 00:00:00" });
  await o("products", { id: 6, lender_id: 9, finance_type: "personal", name: "شخصي", sectors: '["gov","private"]', rate: 9.5, requires_salary_transfer: 0, accepts_late_simah: 1, active: 0 });
  await o("lender_rules", { id: 2, lender_id: 9, finance_type: "personal", kind: "tip", title: "تقبل بخطاب تسوية", user_id: 1, created_at: "2026-06-01 12:00:00" });
  await o("lender_rules", { id: 3, lender_id: null, kind: "warning", title: "تحذير عام", created_at: "2026-06-02 12:00:00" });

  await o("clients", { id: 11, file_no: "C-011", full_name: "عميل مختلق", national_id: "1000000008", phone: "0550000011", birth_year: 1988, sector: "gov", service_months: 140, basic_salary: 11000, total_salary: 15000, salary_bank: "rajhi", housing_support: 1, owns_home: 1, property_value: 760000, finance_type: "mortgage", requested_amount: 700000, status: "study", owner_id: 1, consent_at: "2026-05-02 09:30:00", created_at: "2026-05-02 09:30:00", updated_at: "2026-11-18 16:45:10" });
  await o("clients", { id: 12, file_no: "C-012", full_name: "مالك مشروع مختلق", sector: "self", finance_type: "project", requested_amount: 4000000, extra: '{"landValue":"9000000","kind":"hotel"}', status: "rejected", owner_id: 2, created_at: "2026-07-01 08:00:00", updated_at: "2026-07-03 08:00:00" });
  await o("obligations", { id: 1, client_id: 11, kind: "mortgage", lender: "بنك", monthly: 3100, remaining: 331000, end_date: "2041-06-01" });

  // Papers of the first client: an identity card stored twice, a paper only asked for, one added by name,
  // a picture that came over WhatsApp, and the credit report.
  await o("documents", { id: 20, client_id: 11, code: "id", label: "الهوية", category: "identity", status: "verified", file_name: "id.pdf", stored_name: "db:a.pdf", mime: "application/pdf", size: pdf.length, sha256: sha(pdf), uploaded_by: 1, uploaded_at: "2026-05-03 10:00:00" });
  await o("documents", { id: 21, client_id: 11, code: "id", label: "الهوية", category: "identity", status: "received", file_name: "id-back.jpg", stored_name: "db:b.jpg", mime: "image/jpeg", size: jpeg.length, sha256: sha(jpeg), uploaded_at: "2026-05-04 10:00:00" });
  await o("documents", { id: 22, client_id: 11, code: "salary_cert", label: "تعريف راتب", category: "income", status: "missing" });
  await o("documents", { id: 23, client_id: 11, code: "custom:ab12cd34", label: "خطاب من جهة العمل", category: "income", required: 0, status: "missing" });
  await o("documents", { id: 24, client_id: 11, code: "wa:9f8e7d6c", label: "صورة", category: "identity", required: 0, status: "received", file_name: "whatsapp.png", stored_name: "db:c.png", mime: "image/png", size: png.length, sha256: sha(png), uploaded_at: "2026-11-10 18:00:00", note: "وصل من العميل عبر واتساب" });
  await o("documents", { id: 25, client_id: 11, code: "simah", label: "تقرير سمة حديث", category: "obligations", status: "received", file_name: "simah.pdf", stored_name: "db:d.pdf", mime: "application/pdf", size: report.length, sha256: sha(report), uploaded_by: 1, uploaded_at: "2026-11-12 11:00:00" });
  await o("documents", { id: 26, client_id: 11, code: "payslip", label: "مسير راتب", category: "income", status: "rejected", note: "الصورة غير واضحة" });
  for (const [docId, data] of [[20, pdf], [21, jpeg], [24, png], [25, report]] as const) await o("file_blobs", { doc_id: docId, data });

  const stored = { ...emptyReport(), reportDate: "2026/11/10", score: 655, facilities: [{ lender: "بنك", creditorType: "bank", product: "تمويل عقاري", status: "current", balance: 331000, installment: 3100 }], warnings: [], confidence: "high" };
  await o("credit_reports", { id: 7, client_id: 11, report: JSON.stringify(stored), grade: "B", derived_simah: "clean", doc_id: 25, user_id: 1, created_at: "2026-11-12 11:00:05" });

  await o("applications", { id: 2, client_id: 11, lender_id: 3, product_name: "عقاري", amount: 700000, tenor: 300, status: "submitted", submitted_at: "2026-11-15 09:00:00", created_by: 1, created_at: "2026-11-14 09:00:00", updated_at: "2026-11-15 09:00:00" });
  await o("outcomes", { id: 3, application_id: 2, client_id: 11, lender_id: 3, finance_type: "mortgage", sector: "gov", salary: 15000, age: 38, simah: "clean", decision: "approved_modified", requested_amount: 700000, estimated_amount: 690000, approved_amount: 650000, approved_rate: 4.5, approved_tenor: 300, conditions: '["salary_transfer","valuation"]', user_id: 1, created_at: "2026-11-17 13:00:00" });
  await o("notes", { id: 5, client_id: 11, kind: "call", body: "اتصل وسأل عن الموعد", user_id: 2, created_at: "2026-11-16 10:10:00" });
  await o("studies", { id: 1, client_id: 11, verdict: "conditional", snapshot: '{"dbr":34.5}', analyst_opinion: "يصلح", user_id: 1, created_at: "2026-05-05 12:00:00" });

  // A deal as the old system kept it: no structure, a short fee, a payoff with no installment.
  const data = {
    items: [
      { id: "i1", kind: "execution", label: "قرار تنفيذ 1", original: 38000, pay: 31000, by: "company" },
      { id: "i2", kind: "mortgage_payoff", label: "مخالصة العقاري — بنك", original: 331000, pay: 318000, by: "company", confirmed: true },
    ],
    propertyValue: 760000,
    transferTaxPct: 5,
    saleTaxPct: 0,
    fixedCosts: 8000,
    fee: { settlePct: 12, financePct: "10" },
    targetBank: "rajhi",
    mortgageApr: 5.5,
    personalFlat: 3,
    personalMonths: 60,
    mortgageMaxAge: 70,
    mortgageMaxMonths: 300,
    ltvPct: 90,
    bankMortgage: null,
    bankPersonal: null,
    notes: "",
  };
  const log = [
    { stage: "study", at: "2026-11-01 09:00", by: "مدير المكتب" },
    { stage: "agreement", at: "2026-11-05 12:30", by: "مدير المكتب", note: "وقّع العميل" },
    { stage: "settlement", at: "2026-11-09 14:00", by: "شخص غادر" },
  ];
  await o("deals", { id: 4, client_id: 11, stage: "clearance", data: JSON.stringify(data), stage_log: JSON.stringify(log), capital: 400000, fee: 100000, client_net: 50000, verdict: "go", user_id: 1, created_at: "2026-11-01 09:00:00", updated_at: "2026-11-18 16:45:10" });

  await o("wa_messages", { id: 1, client_id: 11, direction: "out", wa_id: "wamid.1", phone: "966550000011", type: "text", body: "تحديث على ملفك", status: "read", user_id: 1, created_at: "2026-11-10 17:00:00", updated_at: "2026-11-10 17:05:00" });
  await o("wa_messages", { id: 2, client_id: 11, direction: "in", wa_id: "wamid.2", phone: "966550000011", name: "عميل", type: "image", doc_id: 24, created_at: "2026-11-10 18:00:00", updated_at: "2026-11-10 18:00:00" });
  await o("wa_messages", { id: 3, client_id: null, direction: "in", wa_id: "wamid.3", phone: "966590000000", type: "text", body: "السلام عليكم", created_at: "2026-11-11 08:00:00", updated_at: "2026-11-11 08:00:00" });
  await o("share_links", { id: 1, token: "abcdefghijklmnopqrstuvwx", client_id: 11, user_id: 1, expires_at: "2026-12-20 00:00:00" });
  await o("share_links", { id: 2, token: "zzzzzzzzzzzzzzzzzzzzzzzz", client_id: 11, user_id: 1, expires_at: "2026-06-01 00:00:00" });

  await o("audit_log", { id: 1, user_id: 1, action: "login", details: "passkey", ip: "10.0.0.1", created_at: "2026-11-20 08:15:00" });
  await o("audit_log", { id: 2, action: "login_failed", details: "nobody@example.com", ip: "10.0.0.9", created_at: "2026-11-20 08:16:00" });
  await o("audit_log", { id: 3, user_id: 1, action: "deal_save", entity: "client", entity_id: 11, details: '{"capital":400000,"fee":100000,"verdict":"go"}', created_at: "2026-11-18 16:45:10" });
  await o("audit_log", { id: 4, user_id: 1, action: "client_status", entity: "client", entity_id: 12, details: '{"from":"study","to":"rejected","reason":"لا تقفل"}', created_at: "2026-07-03 08:00:00" });
  await o("audit_log", { id: 5, user_id: 2, action: "export", entity: "client", entity_id: 11, created_at: "2026-08-01 08:00:00" });
  await o("audit_log", { id: 6, user_id: 2, action: "something_else", created_at: "2026-08-02 08:00:00" });
}

const stops = (result: PortResult) => result.findings.filter((finding) => finding.level === "stop").map((finding) => `${finding.table} ${finding.id ?? ""}: ${finding.what}`);
const moved = (result: PortResult, table: string) => result.counts.find((entry) => entry.table === table)!;
const opens = (sealed: string) => unseal(sealed) != null;

beforeAll(() => {
  process.env.MASAR_SECRET = "a-secret-for-these-tests";
});

beforeEach(async () => {
  c = await testDb();
  await oldSchema(c);
  await fill(c);
});
afterEach(async () => {
  await c.close();
});

describe("reading what the old system wrote", () => {
  it("reads its times as UTC, with or without seconds", () => {
    expect(legacyTime("2026-11-20 14:03:22")?.toISOString()).toBe("2026-11-20T14:03:22.000Z");
    expect(legacyTime("2026-11-20 14:03")?.toISOString()).toBe("2026-11-20T14:03:00.000Z");
    expect(legacyTime("2026-11-20T14:03:22.125Z")?.toISOString()).toBe("2026-11-20T14:03:22.125Z");
    expect(legacyTime("2026-11-20")?.toISOString()).toBe("2026-11-20T00:00:00.000Z");
    // Not a time, and a day the calendar does not have.
    expect(legacyTime("yesterday")).toBeNull();
    expect(legacyTime("2026-02-31 10:00:00")).toBeNull();
    expect(legacyTime("")).toBeNull();
    expect(legacyTime(null)).toBeNull();
    expect(legacyDay("2041-06-01")).toBe("2041-06-01");
    expect(legacyDay("2041-06-01 00:00:00")).toBe("2041-06-01");
    expect(legacyDay("soon")).toBeNull();
  });

  it("gives each event of the old log the name this system has for it", () => {
    expect(auditEvent("login", "passkey")).toEqual({ action: "login", details: { method: "passkey" } });
    expect(auditEvent("login_failed", "nobody@example.com")).toEqual({ action: "login_failed", details: { email: "nobody@example.com" } });
    expect(auditEvent("login_failed", "code-locked")).toEqual({ action: "login_failed", details: { method: "code", stopped: true } });
    expect(auditEvent("deal_save", '{"capital":1}')).toEqual({ action: "deal.save", details: { capital: 1, was: "deal_save" } });
    expect(auditEvent("client_status", '{"from":"study","to":"rejected"}').action).toBe("client.reject");
    expect(auditEvent("client_status", '{"from":"rejected","to":"study"}').action).toBe("client.reopen");
    expect(auditEvent("client_status", '{"from":"study","to":"submitted"}').action).toBe("old.status");
    expect(auditEvent("export", null)).toEqual({ action: "old.export", details: { was: "export" } });
    expect(auditEvent("never_heard_of", "a word")).toEqual({ action: "old.other", details: { said: "a word", was: "never_heard_of" } });
  });
});

describe("a dry run", () => {
  it("reports and writes nothing", async () => {
    const result = await portData({ legacy: c.db, target: c.db, write: false, now, opens });
    expect(stops(result)).toEqual([]);
    expect(result.wrote).toBe(false);
    for (const table of ["users", "clients", "deals", "documents", "document_files", "file_blobs", "audit_log"]) expect(await count(c, `masar.${table}`), table).toBe(0);
    expect(result.secrets).toEqual({ held: 1, opened: 1 });
    expect(reportLines(result)[0]).toBe("READY. Nothing was written: this was a dry run.");

    // What comes over, table by table.
    expect(moved(result, "users")).toEqual({ table: "users", old: 2, moved: 2 });
    expect(moved(result, "clients")).toEqual({ table: "clients", old: 2, moved: 2 });
    // Seven old rows: one identity card stored twice, one paper nothing happened to.
    expect(moved(result, "documents")).toEqual({ table: "documents", old: 7, moved: 5 });
    expect(moved(result, "document_files")).toEqual({ table: "document_files", old: 4, moved: 4 });
    expect(moved(result, "deals").moved).toBe(1);
    expect(moved(result, "deal_items").moved).toBe(2);
    expect(moved(result, "deal_stage_events").moved).toBe(4);
    expect(moved(result, "share_links")).toEqual({ table: "share_links", old: 2, moved: 0 });
    expect(moved(result, "sessions")).toEqual({ table: "sessions", old: 1, moved: 0 });
    expect(result.fileBytes).toBe(pdf.length + jpeg.length + png.length + report.length);
  });

  it("says what changes on the way and names nobody", async () => {
    const result = await portData({ legacy: c.db, target: c.db, write: false, now, opens });
    const said = result.findings.map((finding) => `${finding.table} ${finding.id ?? ""}: ${finding.what}`).join("\n");
    expect(said).toContain("clients 12: no consent is on this file");
    expect(said).toContain("deals 4: a mortgage payoff had no installment; 3100 is taken from the client's recorded obligation");
    expect(said).toContain("deals 4: the deal stands at clearance and its road ends at settlement");
    expect(said).toContain('documents 21: the old file held paper "id" twice');
    expect(said).toContain("1 papers that were only asked for and never arrived are not carried over");
    expect(said).toContain("products : 1 products were marked as confirmed in the old system, with no source kept for any term");
    expect(said).toContain("1 client links are open and will stop opening at the switch (files C-011)");
    expect(said).toContain("1 events of the old log have a name this system does not know");
    expect(said).toContain("lenders the office has that this build's starting list does not: شركة تمويل مختلقة");
    // Nothing in the report is a person's name, a phone, an identity number or a file's name.
    const lines = reportLines(result).join("\n");
    for (const secret of ["عميل مختلق", "مالك مشروع", "0550000011", "1000000008", "id-back.jpg", "example.com"]) expect(lines).not.toContain(secret);
  });

  it("shows each deal's stored figures beside this engine's", async () => {
    const result = await portData({ legacy: c.db, target: c.db, write: false, now, opens });
    expect(result.dealChecks).toHaveLength(1);
    const check = result.dealChecks[0]!;
    expect(check.before).toEqual({ capital: 400000, fee: 100000, clientNet: 50000, verdict: "go" });
    expect(check.now.capital).toBeGreaterThan(0);
    expect(reportLines(result).join("\n")).toContain("deal 4 (client 11): DIFFERS");
  });
});

describe("a database the new tables were never made in", () => {
  let bare: Connection;
  beforeEach(async () => {
    bare = await connect("pglite:");
    await oldSchema(bare);
    await fill(bare);
  });
  afterEach(async () => {
    await bare.close();
  });

  it("is enough for a dry run, which asks nothing of the new database", async () => {
    const result = await portData({ legacy: bare.db, target: bare.db, write: false, now, opens });
    expect(stops(result)).toEqual([]);
    expect(moved(result, "clients")).toEqual({ table: "clients", old: 2, moved: 2 });
    expect(result.findings).toContainEqual({ level: "note", table: "masar", id: null, what: "the new tables are not there yet; `npm run db:migrate` makes them before the move" });
    expect(await count(bare, "information_schema.schemata WHERE schema_name = 'masar'")).toBe(0);
  });

  it("is not enough for the move", async () => {
    const result = await portData({ legacy: bare.db, target: bare.db, write: true, now, opens });
    expect(result.wrote).toBe(false);
    expect(stops(result)).toEqual(["masar : the new tables are not there yet; run `npm run db:migrate` first"]);
  });
});

describe("what stands in the way", () => {
  it("refuses a file whose content is not what was uploaded, and writes nothing", async () => {
    await c.db.execute(sql`UPDATE public.file_blobs SET data = ${new TextEncoder().encode("%PDF-1.4 something else")} WHERE doc_id = 20`);
    const result = await portData({ legacy: c.db, target: c.db, write: true, now, opens });
    expect(stops(result)).toEqual(["documents 20: the file does not match the fingerprint stored with it"]);
    expect(result.wrote).toBe(false);
    expect(await count(c, "masar.clients")).toBe(0);
    expect(reportLines(result)[0]).toBe("NOT READY. Nothing was written.");
  });

  it("refuses a deal off the road, a report that does not read, and two accounts with one email", async () => {
    await c.db.execute(sql`UPDATE public.deals SET stage = 'somewhere' WHERE id = 4`);
    await c.db.execute(sql`UPDATE public.credit_reports SET report = '{"score":"high"}' WHERE id = 7`);
    await c.db.execute(sql`UPDATE public.users SET email = 'ADMIN@example.com' WHERE id = 2`);
    const found = stops(await portData({ legacy: c.db, target: c.db, write: true, now, opens }));
    expect(found.some((line) => line.startsWith('deals 4: stage "somewhere" is not on the road'))).toBe(true);
    expect(found.some((line) => line.startsWith("credit_reports 7: the stored report does not read as a credit record here"))).toBe(true);
    expect(found.some((line) => line.startsWith("users 2: the email is the same as account 1's"))).toBe(true);
    expect(await count(c, "masar.users")).toBe(0);
  });

  it("refuses deal numbers this system would not take", async () => {
    await c.db.execute(sql`UPDATE public.deals SET data = '{"items":[{"id":"i1","kind":"gift","label":"x","original":1,"pay":1,"by":"company"}]}' WHERE id = 4`);
    const found = stops(await portData({ legacy: c.db, target: c.db, write: false, now, opens }));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("deals 4: the deal's numbers do not pass this system's checks (items.0.kind");
  });

  it("refuses the wrong application secret, because it would lock people out of their authenticator", async () => {
    const result = await portData({ legacy: c.db, target: c.db, write: true, now, opens: () => false });
    expect(stops(result)).toEqual(["users : 1 of 1 authenticator secrets do not open with MASAR_SECRET: it is not the secret the old system runs on"]);
    expect(result.wrote).toBe(false);
  });

  it("only fills an empty database", async () => {
    await c.db.insert(t.lenders).values({ name: "جهة", type: "bank" });
    const result = await portData({ legacy: c.db, target: c.db, write: true, now, opens });
    expect(stops(result)).toEqual(["lenders : the new table already holds 1 row; the move only fills an empty database"]);
    expect(await count(c, "masar.clients")).toBe(0);
  });
});

describe("the move", () => {
  let result: PortResult;
  beforeEach(async () => {
    result = await portData({ legacy: c.db, target: c.db, write: true, now, opens });
  });

  it("writes everything and leaves the old tables as they were", async () => {
    expect(stops(result)).toEqual([]);
    expect(result.wrote).toBe(true);
    expect(reportLines(result)[0]).toBe("MOVED. Everything below was written.");
    for (const entry of result.counts) {
      if (["share_links", "sessions", "login_codes"].includes(entry.table)) continue;
      // The log gains one line: the move itself.
      expect(await count(c, `masar.${entry.table}`), entry.table).toBe(entry.moved + (entry.table === "audit_log" ? 1 : 0));
    }
    expect(await count(c, "masar.file_blobs")).toBe(4);
    for (const [table, rows] of [["users", 2], ["clients", 2], ["documents", 7], ["file_blobs", 4], ["deals", 1], ["audit_log", 6], ["share_links", 2]] as const) expect(await count(c, `public.${table}`), table).toBe(rows);
  });

  it("is not made a second time, and says the old tables stood still since", async () => {
    const again = await portData({ legacy: c.db, target: c.db, write: true, now: new Date("2026-11-23T10:00:00Z"), opens });
    expect(again.wrote).toBe(false);
    expect(again.moved).toEqual({ at: now, changed: [], usedSince: false });
    expect(mayGoLive(again)).toBe(true);
    expect(reportLines(again)).toEqual(["ALREADY MOVED on 2026-11-23 09:00 UTC. Nothing was written.", "", "Since the move, the old tables are as they were."]);
    expect(await count(c, "masar.clients")).toBe(2);
    expect(await count(c, "masar.audit_log")).toBe(7);
  });

  it("says what the old system was given after the move, because it is not here", async () => {
    await put(c, "notes", { id: 6, client_id: 11, kind: "call", body: "ملاحظة بعد النقل", user_id: 1, created_at: "2026-11-23 09:30:00" });
    await c.db.execute(sql`UPDATE public.clients SET phone = '0550000099' WHERE id = 11`);
    await c.db.execute(sql`DELETE FROM public.file_blobs WHERE doc_id = 21`);
    const again = await portData({ legacy: c.db, target: c.db, write: false, now, opens });
    expect(again.moved!.changed).toEqual(["clients: rows were edited", "notes: 1 row then, 2 now", "file_blobs: 4 rows then, 3 now"]);
    const lines = reportLines(again);
    expect(lines[2]).toBe("Since the move, the old tables changed. What changed there is NOT in the new system:");
    expect(lines.slice(3, 6)).toEqual(["  clients: rows were edited", "  notes: 1 row then, 2 now", "  file_blobs: 4 rows then, 3 now"]);
    // The report still names nobody.
    expect(lines.join("\n")).not.toMatch(/0550000099|ملاحظة/);

    // Before anyone works in the new system, that is data the move left behind: the site must not go live on it.
    expect(again.moved!.usedSince).toBe(false);
    expect(mayGoLive(again)).toBe(false);
    expect(lines.at(-1)).toBe("Nobody has worked in the new system since the move. Empty its tables and move again before anyone does.");

    // Once people work in the new system, it is someone still using the old one.
    await c.db.insert(t.auditLog).values({ userId: 1, action: "login", details: { method: "password" } });
    const later = await portData({ legacy: c.db, target: c.db, write: true, now, opens });
    expect(later.moved!.usedSince).toBe(true);
    expect(mayGoLive(later)).toBe(true);
    expect(reportLines(later).at(-1)).toBe("People have worked in the new system since the move, so this is someone still using the old one.");
  });

  it("keeps the accounts as they were, so everyone signs in with what they have", async () => {
    const [admin] = await c.db.select().from(t.users).where(eq(t.users.id, 1));
    expect(admin).toMatchObject({ name: "مدير المكتب", email: "Admin@example.com", role: "admin", active: true, totpEnabled: true, totpLastStep: 58000000, phone: "0500000001" });
    expect(admin!.passwordHash).toBe("$2a$12$abcdefghijklmnopqrstuuJ8Zq0u1mC0b9r7m1bq3n5d7f9h1j3l5");
    expect(unseal(admin!.totpSecret)).toBe("JBSWY3DPEHPK3PXP");
    expect(admin!.lastLoginAt?.toISOString()).toBe("2026-11-20T08:15:00.000Z");
    const [officer] = await c.db.select().from(t.users).where(eq(t.users.id, 2));
    expect(officer!.active).toBe(false);
    const [key] = await c.db.select().from(t.passkeys);
    expect(key).toMatchObject({ id: 4, userId: 1, credentialId: "cred-1", publicKey: "a2V5", counter: 7, transports: ["internal", "hybrid"], name: "جوال" });
    // Nobody is signed in: sessions and one-time codes stay behind.
    expect(await count(c, "masar.sessions")).toBe(0);
    expect(await count(c, "masar.login_codes")).toBe(0);
  });

  it("keeps a client's file, with the consent the old system recorded", async () => {
    const [client] = await c.db.select().from(t.clients).where(eq(t.clients.id, 11));
    expect(client).toMatchObject({ fileNo: "C-011", fullName: "عميل مختلق", nationalId: "1000000008", birthYear: 1988, sector: "gov", basicSalary: 11000, totalSalary: 15000, salaryBank: "rajhi", housingSupport: true, ownsHome: true, ownerId: 1, status: "study" });
    expect(client!.consentAt?.toISOString()).toBe("2026-05-02T09:30:00.000Z");
    expect(client!.updatedAt.toISOString()).toBe("2026-11-18T16:45:10.000Z");
    const [project] = await c.db.select().from(t.clients).where(eq(t.clients.id, 12));
    // The project's facts stay as the old system kept them, and no consent is made up for it.
    expect(project).toMatchObject({ financeType: "project", status: "rejected", ownerId: 2, consentAt: null, ownsHome: null, extra: { landValue: "9000000", kind: "hotel" } });
    const [owed] = await c.db.select().from(t.obligations);
    expect(owed).toMatchObject({ clientId: 11, kind: "mortgage", monthly: 3100, remaining: 331000, endDate: "2041-06-01" });
  });

  it("turns a deal's numbers into a deal this system reads", async () => {
    const view = (await getDeal(c.db, { dealId: 4, now }))!;
    expect(view.deal.stage).toBe("clearance");
    expect(view.input.structure).toBe("settle_refi_personal");
    expect(view.input.fee).toEqual({ settlePct: 12, settleIncludesPayoff: false, financePct: 10, financeBase: "total", fixed: 0 });
    expect(view.input.items).toEqual([
      { id: "i1", kind: "execution", label: "قرار تنفيذ 1", original: 38000, pay: 31000, by: "company", monthly: null },
      { id: "i2", kind: "mortgage_payoff", label: "مخالصة العقاري — بنك", original: 331000, pay: 318000, by: "company", confirmed: true, monthly: 3100 },
    ]);
    // The stored result is this engine's, the one the deal's page shows.
    expect(view.deal.capital).toBe(view.study.capital);
    expect(view.deal.fee).toBe(view.study.fee);
    expect(view.deal.createdAt.toISOString()).toBe("2026-11-01T09:00:00.000Z");

    const road = await c.db.select().from(t.dealStageEvents).where(eq(t.dealStageEvents.dealId, 4)).orderBy(t.dealStageEvents.id);
    expect(road.map((step) => [step.stage, step.userId, step.note, step.createdAt.toISOString()])).toEqual([
      ["study", 1, null, "2026-11-01T09:00:00.000Z"],
      ["agreement", 1, "وقّع العميل", "2026-11-05T12:30:00.000Z"],
      // Someone who has no account any more.
      ["settlement", null, null, "2026-11-09T14:00:00.000Z"],
      // The stage the deal stands at, which the old list had lost.
      ["clearance", null, null, "2026-11-18T16:45:10.000Z"],
    ]);
  });

  it("files each stored file under its paper", async () => {
    const papers = await c.db.select().from(t.documents).where(eq(t.documents.clientId, 11)).orderBy(t.documents.id);
    expect(papers.map((paper) => [paper.code, paper.label, paper.status, paper.note])).toEqual([
      ["id", null, "verified", null],
      ["custom:ab12cd34", "خطاب من جهة العمل", "missing", null],
      ["inbox", null, "received", null],
      ["simah", null, "received", null],
      ["payslip", null, "rejected", "الصورة غير واضحة"],
    ]);
    const files = await c.db.select().from(t.documentFiles).orderBy(t.documentFiles.id);
    expect(files.map((file) => [file.docId, file.name, file.kind, file.size, file.sha256, file.uploadedBy])).toEqual([
      [papers[0]!.id, "id.pdf", "pdf", pdf.length, sha(pdf), 1],
      [papers[0]!.id, "id-back.jpg", "jpeg", jpeg.length, sha(jpeg), null],
      [papers[2]!.id, "whatsapp.png", "png", png.length, sha(png), null],
      [papers[3]!.id, "simah.pdf", "pdf", report.length, sha(report), 1],
    ]);
    // The content opens through the same door every file opens through.
    const opened = (await openPaperFile(c.db, { fileId: files[0]!.id, actor: SYSTEM }))!;
    expect(opened).toMatchObject({ clientId: 11, name: "id.pdf", kind: "pdf" });
    expect(sha(opened.bytes)).toBe(sha(pdf));
    // And the deal's list of papers reads them.
    const list = (await getPapers(c.db, { dealId: 4, now }))!;
    expect(JSON.stringify(list.list)).toContain("id-back.jpg");
  });

  it("keeps the credit record with the file it was read from, and the analysis stands on it", async () => {
    const record = (await latestCredit(c.db, 11))!;
    expect(record.id).toBe(7);
    expect(record.report.score).toBe(655);
    expect(record.confidence).toBe("high");
    expect(record.createdAt.toISOString()).toBe("2026-11-12T11:00:05.000Z");
    const [row] = await c.db.select().from(t.creditReports);
    const [file] = await c.db.select().from(t.documentFiles).where(eq(t.documentFiles.id, row!.fileId!));
    expect(file!.name).toBe("simah.pdf");

    const view = (await getAnalysis(c.db, { clientId: 11, now }))!;
    expect(view.file.consent).toBe(true);
    expect(view.analysis!.burden.monthly).toBe(3100);
    expect(view.analysis!.gaps.some((gap) => gap.code === "CONSENT")).toBe(false);
  });

  it("keeps what the office learned about lenders", async () => {
    const lenders = await c.db.select().from(t.lenders).orderBy(t.lenders.id);
    expect(lenders.map((lender) => [lender.id, lender.name, lender.type, lender.bankCode, lender.active])).toEqual([
      [3, "مصرف الراجحي", "bank", "rajhi", true],
      [9, "شركة تمويل مختلقة", "finance_company", null, true],
    ]);
    const products = await c.db.select().from(t.products).orderBy(t.products.id);
    expect(products[0]).toMatchObject({ id: 5, lenderId: 3, sectors: ["gov", "military"], nationalities: ["saudi"], rate: 4.2, rateType: "reducing", maxLtv: 90, requiresSalaryTransfer: true, settledDefaultWaitMonths: null, active: true });
    expect(products[0]!.verifiedAt?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(products[1]).toMatchObject({ id: 6, lenderId: 9, requiresSalaryTransfer: false, acceptsLateSimah: true, active: false, verifiedAt: null });
    // The old system's mark came with no source, so it confirms nothing here: every term is asked again.
    expect(await c.db.select().from(t.termSources)).toEqual([]);
    const { listCatalogue } = await import("@/server/lenders/service");
    const read = (await listCatalogue(c.db, { stopped: true, now })).flatMap((lender) => lender.products);
    expect(read.map((product) => [product.id, product.verified, Object.values(product.terms!).every((standing) => standing.state === "unconfirmed")])).toEqual([
      ["5", false, true],
      ["6", false, true],
    ]);
    const rules = await c.db.select().from(t.lenderRules).orderBy(t.lenderRules.id);
    expect(rules.map((rule) => [rule.lenderId, rule.kind, rule.title, rule.userId])).toEqual([
      [9, "tip", "تقبل بخطاب تسوية", 1],
      [null, "warning", "تحذير عام", null],
    ]);
    const [decision] = await c.db.select().from(t.outcomes);
    expect(decision).toMatchObject({ applicationId: 2, clientId: 11, lenderId: 3, decision: "approved_modified", approvedAmount: 650000, approvedRate: 4.5, conditions: ["salary_transfer", "valuation"] });
    const [study] = await c.db.select().from(t.studies);
    expect(study).toMatchObject({ verdict: "conditional", snapshot: { dbr: 34.5 }, analystOpinion: "يصلح" });
  });

  it("keeps the conversation, and the file a message brought", async () => {
    const messages = await c.db.select().from(t.waMessages).orderBy(t.waMessages.id);
    expect(messages.map((message) => [message.id, message.clientId, message.direction, message.waId, message.seenAt])).toEqual([
      [1, 11, "out", "wamid.1", null],
      [2, 11, "in", "wamid.2", null],
      [3, null, "in", "wamid.3", null],
    ]);
    const [file] = await c.db.select().from(t.documentFiles).where(eq(t.documentFiles.id, messages[1]!.fileId!));
    expect(file!.name).toBe("whatsapp.png");
    // The old links do not come over: they are of another shape.
    expect(await count(c, "masar.share_links")).toBe(0);
  });

  it("keeps the log readable, and adds the move to it", async () => {
    const { lines } = await readAudit(c.db);
    // Newest first, in the order the old log was written.
    expect(lines.map((line) => line.action)).toEqual(["old.moved", "old.other", "old.export", "client.reject", "deal.save", "login_failed", "login"]);
    for (const line of lines) expect(auditAction(line.action), line.action).not.toBe("حدث آخر");
    const save = lines.find((line) => line.action === "deal.save")!;
    expect(save.subject).toMatchObject({ kind: "client", id: 11 });
    expect(save.details).toEqual({ capital: 400000, fee: 100000, verdict: "go", was: "deal_save" });
    expect(save.at.toISOString()).toBe("2026-11-18T16:45:10.000Z");
    expect(lines[0]!.details).toMatchObject({ clients: 2, deals: 1, files: 4, events: 6 });
    // The move leaves a mark of every old table it read, and of the stored files: counts and fingerprints, nobody's data.
    const marks = lines[0]!.details!.marks as Record<string, { rows: number; print: string }>;
    expect(Object.keys(marks)).toHaveLength(18);
    expect(marks.clients).toEqual({ rows: 2, print: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(marks.file_blobs!.rows).toBe(4);
    expect(lines.find((line) => line.action === "login")!.details).toEqual({ method: "passkey" });
  });

  it("hands out the next number after the ones that came over", async () => {
    const [client] = await c.db.insert(t.clients).values({ fileNo: "C-013", fullName: "عميل جديد" }).returning({ id: t.clients.id });
    expect(client!.id).toBe(13);
    const [lender] = await c.db.insert(t.lenders).values({ name: "جهة جديدة", type: "bank" }).returning({ id: t.lenders.id });
    expect(lender!.id).toBe(10);
    const [paper] = await c.db.insert(t.documents).values({ clientId: 12, code: "id" }).returning({ id: t.documents.id });
    expect(paper!.id).toBe(6);
    const [event] = await c.db.insert(t.dealStageEvents).values({ dealId: 4, stage: "simah_update" }).returning({ id: t.dealStageEvents.id });
    expect(event!.id).toBe(5);
  });
});

describe("an old database of its own", () => {
  it("is read from one connection and written to another", async () => {
    const target = await testDb();
    try {
      const result = await portData({ legacy: c.db, target: target.db, write: true, now, opens });
      expect(stops(result)).toEqual([]);
      expect(result.wrote).toBe(true);
      expect(await count(target, "masar.clients")).toBe(2);
      expect(await count(target, "masar.file_blobs")).toBe(4);
      const [blob] = await target.db.select().from(t.fileBlobs).where(eq(t.fileBlobs.fileId, 1));
      expect(sha(new Uint8Array(blob!.data))).toBe(sha(pdf));
      // Nothing was written beside the old tables.
      expect(await count(c, "masar.clients")).toBe(0);
    } finally {
      await target.close();
    }
  });

  it("undoes a move whose source changed while it ran", async () => {
    const target = await testDb();
    // Someone at the old system saves a note just after it was looked at, before the move reads it again.
    let saved = false;
    const busy = {
      transaction: async (...args: Parameters<typeof c.db.transaction>) => {
        const read = await c.db.transaction(...args);
        if (!saved) await put(c, "notes", { id: 6, client_id: 11, kind: "call", body: "ملاحظة في أثناء النقل", user_id: 1, created_at: "2026-11-23 09:00:01" });
        saved = true;
        return read;
      },
    } as unknown as typeof c.db;
    try {
      await expect(portData({ legacy: busy, target: target.db, write: true, now, opens })).rejects.toThrow("the old data changed while the move was running, so nothing was written: notes: 1 row then, 2 now");
      for (const table of ["users", "clients", "deals", "file_blobs", "audit_log"]) expect(await count(target, `masar.${table}`), table).toBe(0);
      // Run again once the old system is quiet, it goes through.
      const result = await portData({ legacy: c.db, target: target.db, write: true, now, opens });
      expect(result.wrote).toBe(true);
      expect(await count(target, "masar.notes")).toBe(2);
    } finally {
      await target.close();
    }
  });
});

describe("a rehearsal", () => {
  it("runs the whole move into a database that is thrown away, and writes to no other", async () => {
    const result = await rehearse({ legacy: c.db, now, opens });
    expect(stops(result)).toEqual([]);
    expect(result.wrote).toBe(true);
    expect(reportLines(result, { rehearsal: true })[0]).toBe("REHEARSED. The whole move ran into a throwaway database. Nothing was written to a real one.");
    expect(moved(result, "document_files")).toEqual({ table: "document_files", old: 4, moved: 4 });
    // The database it read from holds what it held: the old rows, and nothing in the new tables.
    for (const table of ["masar.users", "masar.clients", "masar.file_blobs", "masar.audit_log"]) expect(await count(c, table), table).toBe(0);
    expect(await count(c, "public.clients")).toBe(2);
  });

  it("stops where the move would stop", async () => {
    await c.db.execute(sql`UPDATE public.deals SET stage = 'nowhere' WHERE id = 4`);
    const result = await rehearse({ legacy: c.db, now, opens });
    expect(result.wrote).toBe(false);
    expect(reportLines(result, { rehearsal: true })[0]).toBe("REHEARSAL STOPPED. Nothing was written anywhere.");
    expect(stops(result)).toEqual(['deals 4: stage "nowhere" is not on the road']);
  });
});

describe("an error on its way to a log", () => {
  it("loses the statement and its values, and keeps what the database said", async () => {
    // Two clients with one file number: the old tables allow it only by accident, the new ones refuse it.
    let thrown: unknown;
    try {
      await c.db.insert(t.clients).values([
        { fileNo: "C-900", fullName: "اسم لا يجوز أن يظهر", phone: "0551234567" },
        { fileNo: "C-900", fullName: "اسم آخر", phone: "0557654321" },
      ]);
    } catch (error) {
      thrown = error;
    }
    expect(String((thrown as Error).message)).toContain("0551234567");
    const said = safeError(thrown);
    expect(said).toMatch(/^the database refused a statement on masar\.clients: /);
    expect(said).not.toMatch(/0551234567|0557654321|اسم|C-900/);
    expect(safeError(new Error("the old data changed while the move was running"))).toBe("the old data changed while the move was running");
  });
});

describe("what a deployment does", () => {
  const live = { VERCEL_ENV: "production", MASAR_DATABASE_URL: "postgres://new", MASAR_SECRET: "a-secret-for-these-tests", MASAR_ORIGINS: "https://masarfin.com" };

  it("does nothing for a preview, whatever database names it can see", () => {
    for (const phase of ["before", "after"] as const) {
      expect(planRelease(phase, { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "revamp", DATABASE_URL: "postgres://old", POSTGRES_URL: "postgres://old" })).toEqual({ steps: [], refuse: null, legacyUrl: null });
    }
    // Not even with the word that asks for the move: only a production build moves anything.
    expect(planRelease("after", { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "rehearsal", MASAR_MOVE_OLD_DATA: "yes", MASAR_DATABASE_URL: "postgres://new", DATABASE_URL: "postgres://old" }).steps).toEqual([]);
  });

  it("rehearses on the branch named for it, reading the old database by the names the old system uses", () => {
    expect(planRelease("before", { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "rehearsal", POSTGRES_URL: "postgres://old" })).toEqual({ steps: ["rehearse"], refuse: null, legacyUrl: "postgres://old" });
    expect(planRelease("before", { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "rehearsal", DATABASE_URL: "postgres://a", POSTGRES_URL: "postgres://b", LEGACY_DATABASE_URL: "postgres://c" }).legacyUrl).toBe("postgres://c");
    expect(planRelease("before", { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "rehearsal" }).refuse).toMatch(/no database to read/);
  });

  it("holds a production build back until the settings a live site needs are there", () => {
    expect(planRelease("before", { VERCEL_ENV: "production" }).refuse).toMatch(/MASAR_DATABASE_URL.*MASAR_SECRET.*MASAR_ORIGINS/);
    expect(planRelease("after", { ...live, MASAR_SECRET: "short" }).refuse).toMatch(/^production is missing MASAR_SECRET/);
    expect(planRelease("before", { ...live, MASAR_ORIGINS: "" }).refuse).toMatch(/^production is missing MASAR_ORIGINS/);
    expect(planRelease("before", live)).toEqual({ steps: ["migrate"], refuse: null, legacyUrl: null });
  });

  it("moves the old data only when told to, and never lets a site with no account go live", () => {
    expect(planRelease("after", live)).toEqual({ steps: ["accounts"], refuse: null, legacyUrl: null });
    expect(planRelease("after", { ...live, MASAR_MOVE_OLD_DATA: "true" }).steps).toEqual(["accounts"]);
    expect(planRelease("after", { ...live, MASAR_MOVE_OLD_DATA: "yes" })).toEqual({ steps: ["move", "accounts"], refuse: null, legacyUrl: "postgres://new" });
    expect(planRelease("after", { ...live, MASAR_MOVE_OLD_DATA: "yes", LEGACY_DATABASE_URL: "postgres://elsewhere" }).legacyUrl).toBe("postgres://elsewhere");
  });

  it("goes live on a move that was made, and not on one that was not", async () => {
    const dry = await portData({ legacy: c.db, target: c.db, write: false, now, opens });
    expect(mayGoLive(dry)).toBe(false);
    const made = await portData({ legacy: c.db, target: c.db, write: true, now, opens });
    expect(mayGoLive(made)).toBe(true);
  });
});
