import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, AUDIT_AREAS, isWatched } from "@/domain/audit";
import { auditPeople, readAudit, type AuditLine } from "@/server/audit/log";
import type { Connection } from "@/server/db/client";
import { listUsers } from "@/server/auth/users";
import { seedDemo } from "@/server/demo/seed";
import { testDb } from "../helpers/db";

let c: Connection;
let all: AuditLine[];
const now = new Date("2026-11-22T09:00:00Z");

beforeAll(async () => {
  c = await testDb();
  await seedDemo(c.db, now);
  all = (await readAudit(c.db, { limit: 200 })).lines;
});
afterAll(async () => {
  await c.close();
});

describe("reading the audit log", () => {
  it("reads the newest event first, each with who did it and what it is about", async () => {
    expect(all.length).toBeGreaterThan(80);
    for (let i = 1; i < all.length; i++) expect(all[i]!.id).toBeLessThan(all[i - 1]!.id);

    const rejection = all.find((line) => line.action === "client.reject")!;
    expect(rejection.who?.name).toBe("عبدالله");
    expect(rejection.subject).toMatchObject({ kind: "client", name: "هند", fileNo: "C-011" });
    expect(rejection.details.reason).toEqual(expect.any(String));

    const move = all.find((line) => line.action === "deal.stage" && line.subject?.name === "فهد")!;
    expect(move.subject).toMatchObject({ kind: "deal", id: 1, fileNo: "C-019" });
    expect(move.who?.name).toBe("خالد");

    const stopped = all.find((line) => line.action === "user.update")!;
    expect(stopped.subject).toMatchObject({ kind: "user", name: "فيصل" });
    expect(stopped.details).toMatchObject({ active: false });
  });

  it("keeps an event nobody signed in for, with the address it came from", async () => {
    const failed = all.filter((line) => line.action === "login_failed");
    expect(failed).toHaveLength(2);
    for (const line of failed) {
      expect(line.who).toBeNull();
      expect(line.subject).toBeNull();
      expect(line.ip).toBe("198.51.100.23");
    }
    // A file the client sent by WhatsApp is nobody's doing in the office.
    const sent = all.find((line) => line.action === "doc.upload" && line.details.via === "whatsapp")!;
    expect(sent.who).toBeNull();
    expect(sent.subject).toMatchObject({ kind: "client", name: "سالم" });
  });

  it("reads one part of the office at a time", async () => {
    for (const area of ["signin", "users", "clients", "deals", "papers"] as const) {
      const { lines } = await readAudit(c.db, { area, limit: 200 });
      expect(lines.length, area).toBeGreaterThan(0);
      for (const line of lines) expect(AUDIT_AREAS[area] as readonly string[], area).toContain(line.action);
      expect(lines.length).toBe(all.filter((line) => (AUDIT_AREAS[area] as readonly string[]).includes(line.action)).length);
    }
    // Nothing in the demo changed a lender's terms: the lenders' part holds the notes people wrote down.
    const lenders = (await readAudit(c.db, { area: "lenders" })).lines;
    expect(lenders.map((line) => line.action)).toEqual(["lender.rule_add", "lender.rule_add", "lender.rule_add"]);
    expect(lenders.map((line) => line.who?.name)).toEqual(["منى", "خالد", "منى"]);
    for (const line of lenders) expect(line.subject).toBeNull();
  });

  it("reads only what is worth a second look", async () => {
    const { lines } = await readAudit(c.db, { watched: true, limit: 200 });
    expect(lines.map((line) => line.id)).toEqual(all.filter((line) => isWatched(line.action)).map((line) => line.id));
    expect(new Set(lines.map((line) => line.action))).toEqual(new Set(["login_failed", "user.create", "user.update"]));
    // The two narrow each other.
    const both = await readAudit(c.db, { watched: true, area: "signin" });
    expect(both.lines.map((line) => line.action)).toEqual(["login_failed", "login_failed"]);
  });

  it("reads what one person did", async () => {
    const people = await auditPeople(c.db);
    expect(people.map((person) => person.name).sort()).toEqual(["خالد", "سارة", "عبدالله", "فيصل", "منى"].sort());
    const mona = people.find((person) => person.name === "منى")!;
    const { lines } = await readAudit(c.db, { userId: mona.id, limit: 200 });
    expect(lines.length).toBeGreaterThan(10);
    for (const line of lines) expect(line.who).toEqual({ id: mona.id, name: "منى" });
    expect(new Set(lines.map((line) => line.action))).toEqual(new Set(["login", "doc.review", "credit.report_add", "lender.rule_add"]));
    // A person with nothing to their name has an empty page, not an error.
    const faisal = people.find((person) => person.name === "فيصل")!;
    expect(await readAudit(c.db, { userId: faisal.id })).toEqual({ lines: [], next: null });
  });

  it("goes back a page at a time without losing or repeating a line", async () => {
    const seen: number[] = [];
    let before: number | undefined;
    let pages = 0;
    for (;;) {
      const page = await readAudit(c.db, { limit: 25, before });
      seen.push(...page.lines.map((line) => line.id));
      pages++;
      if (page.next == null) break;
      expect(page.lines).toHaveLength(25);
      expect(page.next).toBe(page.lines.at(-1)!.id);
      before = page.next;
    }
    expect(seen).toEqual(all.map((line) => line.id));
    expect(pages).toBe(Math.ceil(all.length / 25));
    // A page that ends exactly at the oldest line says there is nothing older.
    expect((await readAudit(c.db, { limit: all.length })).next).toBeNull();
    expect((await readAudit(c.db, { limit: all.length - 1 })).next).toBe(all.at(-2)!.id);
  });

  it("keeps the size of a page within bounds", async () => {
    expect((await readAudit(c.db, { limit: 0 })).lines).toHaveLength(1);
    expect((await readAudit(c.db, { limit: -5 })).lines).toHaveLength(1);
    expect((await readAudit(c.db)).lines).toHaveLength(60);
    expect((await readAudit(c.db, { limit: 100_000 })).lines.length).toBe(all.length);
  });

  it("still reads an event about something that is gone", async () => {
    const d = await testDb();
    try {
      const { auditLog } = await import("@/server/db/schema");
      await d.db.insert(auditLog).values([
        { action: "client.note", entity: "client", entityId: 999, details: null },
        { action: "something.new", entity: "planet", entityId: 4, details: { a: 1 } },
      ]);
      const { lines } = await readAudit(d.db);
      expect(lines.map((line) => [line.action, line.subject, line.who, line.details])).toEqual([
        ["something.new", null, null, { a: 1 }],
        ["client.note", null, null, {}],
      ]);
    } finally {
      await d.close();
    }
  });
});

describe("the log of the demo office", () => {
  it("holds only events the list knows, in the order of time", () => {
    for (const line of all) expect(AUDIT_ACTIONS as readonly string[], line.action).toContain(line.action);
    for (let i = 1; i < all.length; i++) expect(all[i]!.at.getTime(), `${all[i]!.id}`).toBeLessThanOrEqual(all[i - 1]!.at.getTime());
    expect(all[0]!.at.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it("puts older work in the hours of a working day", () => {
    const riyadhHour = (at: Date) => (at.getUTCHours() + 3) % 24;
    // All but the two tries at the door in the night, which is when such tries come.
    const older = all.filter((line) => now.getTime() - line.at.getTime() >= 24 * 3_600_000 && line.action !== "login_failed");
    expect(older.length).toBeGreaterThan(60);
    for (const line of older) {
      expect(riyadhHour(line.at), `${line.action} ${line.at.toISOString()}`).toBeGreaterThanOrEqual(9);
      expect(riyadhHour(line.at), `${line.action} ${line.at.toISOString()}`).toBeLessThan(18);
    }
  });

  it("names who did the work, and nobody acted before their account existed", async () => {
    const created = new Map(all.filter((line) => line.action === "user.create").map((line) => [line.subject!.id, line.at.getTime()]));
    expect(created.size).toBe(5);
    for (const line of all) {
      if (!line.who) continue;
      expect(created.get(line.who.id)!, `${line.who.name} ${line.action}`).toBeLessThanOrEqual(line.at.getTime());
    }
    const byOffice = all.filter((line) => line.who).length;
    expect(byOffice).toBeGreaterThan(all.length - 6);
  });

  it("has an office of five, each last seen when the log says they came in", async () => {
    const people = await listUsers(c.db, now);
    expect(people.map((person) => [person.name, person.role, person.active])).toEqual([
      ["خالد", "officer", true],
      ["سارة", "viewer", true],
      ["عبدالله", "admin", true],
      ["منى", "analyst", true],
      ["فيصل", "officer", false],
    ]);
    const admin = people.find((person) => person.name === "عبدالله")!;
    expect(admin).toMatchObject({ authenticator: true, passkeys: 1, sessions: 0, phone: "966500000101" });
    for (const person of people.filter((line) => line.active)) {
      const cameIn = all.find((line) => line.action === "login" && line.who?.id === person.id)!;
      expect(cameIn.at.getTime(), person.name).toBe(person.lastLoginAt!.getTime());
    }
    // Every address is one that reaches nobody.
    for (const person of people) expect(person.email.endsWith("@masar.example"), person.email).toBe(true);
  });

  it("moves a deal through its stages in the order they were entered", () => {
    const stages = all.filter((line) => line.action === "deal.stage" && line.subject?.name === "ماجد").map((line) => line.details.to).reverse();
    expect(stages).toEqual(["agreement", "settlement", "clearance", "simah_update", "payoff", "transfer", "bank_submit", "approval", "disbursement", "recovered", "closed"]);
  });
});
