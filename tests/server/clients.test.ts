import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultDealInput } from "@/domain/deal";
import { getClientCard, listClients } from "@/server/clients/directory";
import { addNote, updateContact } from "@/server/clients/service";
import type { Connection } from "@/server/db/client";
import { auditLog, clients, waMessages } from "@/server/db/schema";
import { deals, notes } from "@/server/db/schema";
import { reopenDeal, rejectDeal, startDeal, startDealFor } from "@/server/deals/service";
import { seedDemo } from "@/server/demo/seed";
import { testDb } from "../helpers/db";

let c: Connection;
const now = new Date("2026-11-22T09:00:00Z");
const actor = { userId: null, ip: "10.0.0.7" };
const people: Record<string, number> = {};

beforeAll(async () => {
  c = await testDb();
  await seedDemo(c.db, now);
  for (const row of await c.db.select({ id: clients.id, name: clients.fullName }).from(clients)) people[row.name] = row.id;
});
afterAll(async () => {
  await c.close();
});

const code = async (run: () => Promise<unknown>) => run().then(() => "ok", (error) => error.code ?? String(error));
const params = async (run: () => Promise<unknown>) => run().then(() => null, (error) => error.params);
const lastAudit = async () => (await c.db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(1))[0]!;
const row = async (name: string) => (await c.db.select().from(clients).where(eq(clients.id, people[name]!)))[0]!;
const names = async (q: string, byPhone = true) => (await listClients(c.db, { q, byPhone })).rows.map((found) => found.name);
const contact = (over: Record<string, unknown> = {}) => ({ phone: "", nationality: "saudi", nationalId: "", employer: "", city: "", email: "", ...over });

describe("the list of everyone", () => {
  it("shows every file with its newest deal, the last moved first", async () => {
    const { rows, total } = await listClients(c.db);
    expect(total).toBe(6);
    expect(rows.map((found) => found.name)).toEqual(["ريم", "نورة", "سالم", "فهد", "هند", "ماجد"]);
    const by = Object.fromEntries(rows.map((found) => [found.name, found]));
    expect(by["سالم"]).toMatchObject({ fileNo: "C-014", city: "جدة", deal: { stage: "payoff", verdict: "go" } });
    expect(by["هند"]!.deal).toMatchObject({ stage: "lost" });
    expect(by["ماجد"]!.deal).toMatchObject({ stage: "closed" });
    expect((await listClients(c.db, { limit: 2 })).rows).toHaveLength(2);
    expect((await listClients(c.db, { limit: 2 })).total).toBe(6);
  });

  it("finds a person by name, file number, employer or city of work", async () => {
    expect(await names("سالم")).toEqual(["سالم"]);
    expect(await names("c-014")).toEqual(["سالم"]);
    expect(await names("014")).toEqual(["سالم"]);
    expect(await names("الصحة")).toEqual(["سالم"]);
    expect(await names("وزارة")).toEqual(["ريم", "سالم", "فهد", "ماجد"]);
    expect(await names("وزارة العدل")).toEqual(["ريم"]);
    expect(await names("لا أحد بهذا الاسم")).toEqual([]);
  });

  it("takes look-alike letters as one, and reads a pattern sign as a plain character", async () => {
    await c.db.update(clients).set({ fullName: "أحمد مصطفى آل سارة" }).where(eq(clients.id, people["ماجد"]!));
    expect(await names("احمد")).toEqual(["أحمد مصطفى آل سارة"]);
    expect(await names("مصطفي ساره")).toEqual(["أحمد مصطفى آل سارة"]);
    expect(await names("ال")).toContain("أحمد مصطفى آل سارة");
    expect(await names("%")).toEqual([]);
    expect(await names("_")).toEqual([]);
    await c.db.update(clients).set({ fullName: "ماجد" }).where(eq(clients.id, people["ماجد"]!));
  });

  it("finds a person by part of their number, only for those who may see numbers", async () => {
    expect(await names("0500000014")).toEqual(["سالم"]);
    expect(await names("966500000014")).toEqual(["سالم"]);
    expect(await names("٠٥٠٠٠٠٠٠١٤")).toEqual(["سالم"]);
    expect(await names("0014")).toEqual(["سالم"]);
    expect(await names("0500000014", false)).toEqual([]);
  });
});

describe("a person's file", () => {
  it("lists their deals and what was noted, newest first", async () => {
    const card = (await getClientCard(c.db, people["هند"]!))!;
    expect(card.client.fileNo).toBe("C-011");
    expect(card.deals).toHaveLength(1);
    expect(card.deals[0]).toMatchObject({ stage: "lost", verdict: "short" });
    expect(card.notes.map((note) => [note.kind, note.body])).toEqual([["status", "الصفقة لا تُغلق: قيمة العقار لا تغطي السداد، والعميلة لا تملك دفع الفرق."]]);
    expect(await getClientCard(c.db, 9999)).toBeNull();
  });

  it("takes a note and records who left it", async () => {
    await addNote(c.db, { clientId: people["سالم"]!, body: "  اتصل  وطلب   مهلة أسبوع ", actor, now });
    const card = (await getClientCard(c.db, people["سالم"]!))!;
    expect(card.notes[0]).toMatchObject({ kind: "note", body: "اتصل وطلب مهلة أسبوع" });
    expect(await lastAudit()).toMatchObject({ action: "client.note", entity: "client", entityId: people["سالم"], ip: "10.0.0.7" });
    expect(await code(() => addNote(c.db, { clientId: people["سالم"]!, body: "   ", actor }))).toBe("NOTE_EMPTY");
    expect(await code(() => addNote(c.db, { clientId: people["سالم"]!, body: "ن".repeat(1001), actor }))).toBe("INVALID_INPUT");
    expect(await code(() => addNote(c.db, { clientId: 9999, body: "ملاحظة", actor }))).toBe("NOT_FOUND");
  });
});

describe("how a client is reached", () => {
  it("stores what was typed in one form, and names the fields that changed without their values", async () => {
    await updateContact(c.db, {
      clientId: people["سالم"]!,
      input: contact({ phone: "٠٥٥ ١٢٣ ٤٥٦٧", nationalId: "١٠١٠١٠١٠١٠", employer: "  وزارة   الصحة ", city: "جدة", email: " Salem@Example.com " }),
      actor,
      now,
    });
    expect(await row("سالم")).toMatchObject({ phone: "966551234567", nationalId: "1010101010", nationality: "saudi", employer: "وزارة الصحة", city: "جدة", email: "salem@example.com" });
    const entry = await lastAudit();
    expect(entry).toMatchObject({ action: "client.contact", entityId: people["سالم"], details: { changed: ["phone", "nationalId", "email"], adopted: 0 } });
    expect(JSON.stringify(entry.details)).not.toMatch(/55123|1010101010|example/);
  });

  it("writes nothing to the log when nothing changed, however the number is written", async () => {
    const before = (await lastAudit()).id;
    await updateContact(c.db, { clientId: people["سالم"]!, input: contact({ phone: "+966 55 123 4567", nationalId: "1010101010", employer: "وزارة الصحة", city: "جدة", email: "salem@example.com" }), actor, now });
    expect((await lastAudit()).id).toBe(before);
    // A number stored the old way is put in the one form without calling it a change.
    await updateContact(c.db, { clientId: people["فهد"]!, input: contact({ phone: "0500000019", employer: "وزارة التعليم", city: "الرياض" }), actor, now });
    expect((await row("فهد")).phone).toBe("966500000019");
    expect((await lastAudit()).id).toBe(before);
  });

  it("refuses a number, an identity number or an email that is not one", async () => {
    const save = (over: Record<string, unknown>) => code(() => updateContact(c.db, { clientId: people["نورة"]!, input: contact(over), actor, now }));
    expect(await save({ phone: "12345" })).toBe("BAD_PHONE");
    expect(await save({ nationalId: "101010101" })).toBe("ID_FORMAT");
    expect(await save({ nationalId: "1010101011" })).toBe("ID_CHECK");
    expect(await save({ nationalId: "2000000006" })).toBe("ID_KIND");
    expect(await save({ nationalId: "2000000006", nationality: "non_saudi" })).toBe("ok");
    expect(await save({ email: "noura@" })).toBe("BAD_EMAIL");
    expect(await save({ nationality: "martian" })).toBe("INVALID_INPUT");
    expect(await code(() => updateContact(c.db, { clientId: 9999, input: contact(), actor }))).toBe("NOT_FOUND");
    expect(await row("نورة")).toMatchObject({ nationality: "non_saudi", nationalId: "2000000006" });
  });

  it("refuses a number or an identity number that another file holds, and says which", async () => {
    const save = (over: Record<string, unknown>) => () => updateContact(c.db, { clientId: people["ريم"]!, input: contact(over), actor, now });
    expect(await code(save({ phone: "0551234567" }))).toBe("PHONE_TAKEN");
    expect(await params(save({ phone: "00966551234567" }))).toEqual({ fileNo: "C-014" });
    // A file whose number is still written the old way holds it all the same.
    expect(await params(save({ phone: "966500000008" }))).toEqual({ fileNo: "C-008" });
    expect(await code(save({ nationalId: "1010101010" }))).toBe("ID_TAKEN");
    expect(await params(save({ nationalId: "1010101010" }))).toEqual({ fileNo: "C-014" });
    expect((await row("ريم")).phone).toBe("0500000021");
  });

  it("clears what is left empty", async () => {
    await updateContact(c.db, { clientId: people["نورة"]!, input: contact(), actor, now });
    expect(await row("نورة")).toMatchObject({ phone: null, nationalId: null, nationality: "saudi", employer: null, city: null, email: null });
    await updateContact(c.db, { clientId: people["ريم"]!, input: contact(), actor, now });
    expect(await row("ريم")).toMatchObject({ phone: null, employer: null, city: null });
    expect((await lastAudit()).details).toMatchObject({ changed: ["phone", "employer", "city"] });
  });

  it("gives a client what their number wrote before it was on a file", async () => {
    const stranger = async () => (await c.db.select().from(waMessages).where(eq(waMessages.phone, "966500000031"))).map((message) => message.clientId);
    expect(await stranger()).toEqual([null, null]);
    const answer = await updateContact(c.db, { clientId: people["نورة"]!, input: contact({ phone: "0500000031" }), actor, now });
    expect(answer).toEqual({ adopted: 2 });
    expect(await stranger()).toEqual([people["نورة"], people["نورة"]]);
    expect((await lastAudit()).details).toMatchObject({ changed: ["phone"], adopted: 2 });
  });
});

describe("a new file", () => {
  const borrower = { fullName: "تركي", birthYear: 1990, sector: "gov", basicSalary: 9000, totalSalary: 12000, serviceMonths: 96 };

  it("takes a phone at opening, and with it what that number already wrote", async () => {
    await c.db.insert(waMessages).values({ clientId: null, direction: "in", waId: "wamid.before-file", phone: "966550000077", name: "تركي", body: "السلام عليكم", status: "received" });
    const opened = await startDeal(c.db, { borrower, input: defaultDealInput(), phone: "055 000 0077", actor, now });
    const [client] = await c.db.select().from(clients).where(eq(clients.id, opened.clientId));
    expect(client).toMatchObject({ fullName: "تركي", phone: "966550000077", fileNo: "C-022" });
    const [message] = await c.db.select().from(waMessages).where(eq(waMessages.waId, "wamid.before-file"));
    expect(message!.clientId).toBe(opened.clientId);
    const [created] = await c.db.select().from(auditLog).where(eq(auditLog.action, "client.create")).orderBy(desc(auditLog.id)).limit(1);
    expect(created).toMatchObject({ entityId: opened.clientId, details: { fileNo: "C-022", adopted: 1 } });
  });

  it("is not opened on a number another file holds, or on one that is no number", async () => {
    const count = async () => (await c.db.select({ id: clients.id }).from(clients)).length;
    const before = await count();
    expect(await code(() => startDeal(c.db, { borrower, input: defaultDealInput(), phone: "0550000077", actor, now }))).toBe("PHONE_TAKEN");
    expect(await code(() => startDeal(c.db, { borrower, input: defaultDealInput(), phone: "123", actor, now }))).toBe("BAD_PHONE");
    expect(await count()).toBe(before);
    // Without a phone the file opens as before.
    const opened = await startDeal(c.db, { borrower: { ...borrower, fullName: "بدر" }, input: defaultDealInput(), phone: "  ", actor, now });
    expect((await c.db.select().from(clients).where(eq(clients.id, opened.clientId)))[0]!.phone).toBeNull();
  });
});

describe("another deal for a client the office already has a file for", () => {
  const facts = { fullName: "ماجد", birthYear: 1984, sector: "gov", basicSalary: 12000, totalSalary: 16500, serviceMonths: 200 };
  const dealsOf = async (clientId: number) => c.db.select().from(deals).where(eq(deals.clientId, clientId)).orderBy(desc(deals.id));

  it("is refused while one is in progress", async () => {
    const before = (await dealsOf(people["سالم"]!)).length;
    expect(await code(() => startDealFor(c.db, { clientId: people["سالم"]!, borrower: { ...facts, fullName: "سالم" }, input: defaultDealInput(), actor, now }))).toBe("DEAL_ALREADY_OPEN");
    expect((await dealsOf(people["سالم"]!)).length).toBe(before);
    expect(await code(() => startDealFor(c.db, { clientId: 9999, borrower: facts, input: defaultDealInput(), actor, now }))).toBe("NOT_FOUND");
  });

  it("opens on the same file once the last one is completed, with the facts as they are now", async () => {
    const id = people["ماجد"]!;
    const [last] = await dealsOf(id);
    expect(last!.stage).toBe("closed");
    const opened = await startDealFor(c.db, { clientId: id, borrower: facts, input: defaultDealInput(), actor, now });
    expect(opened.clientId).toBe(id);
    const all = await dealsOf(id);
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ id: opened.dealId, stage: "study" });
    expect(all[1]).toMatchObject({ id: last!.id, stage: "closed" });
    const client = await row("ماجد");
    expect(client).toMatchObject({ fileNo: "C-008", totalSalary: 16500, serviceMonths: 200 });
    const card = await getClientCard(c.db, id);
    expect(card!.deals.map((deal) => deal.stage)).toEqual(["study", "closed"]);
    expect((await listClients(c.db, { q: "C-008" })).rows[0]!.deal).toMatchObject({ stage: "study" });
  });

  it("puts a rejected file back under study, and leaves the rejected deal as it ended", async () => {
    const id = people["هند"]!;
    expect((await row("هند")).status).toBe("rejected");
    const [lost] = await dealsOf(id);
    const opened = await startDealFor(c.db, { clientId: id, borrower: { ...facts, fullName: "هند" }, input: defaultDealInput(), actor, now });
    expect((await row("هند")).status).toBe("study");
    const all = await dealsOf(id);
    expect(all.map((deal) => [deal.id, deal.stage])).toEqual([
      [opened.dealId, "study"],
      [lost!.id, "lost"],
    ]);
  });
});

describe("the decision on a file", () => {
  it("rejects with its reason kept on the file, and takes the file back with what changed", async () => {
    const id = people["ريم"]!;
    await rejectDeal(c.db, { clientId: id, reason: "العجز لا يُغلق", actor, now });
    expect((await row("ريم")).status).toBe("rejected");
    let card = await getClientCard(c.db, id);
    expect(card!.deals[0]!.stage).toBe("lost");
    expect(card!.notes[0]).toMatchObject({ kind: "status", body: "العجز لا يُغلق" });
    expect((await lastAudit()).action).toBe("client.reject");

    await reopenDeal(c.db, { clientId: id, note: "وافق على دفع الفرق", actor, now: new Date(now.getTime() + 60_000) });
    expect((await row("ريم")).status).toBe("study");
    card = await getClientCard(c.db, id);
    expect(card!.deals).toHaveLength(1);
    expect(card!.deals[0]!.stage).toBe("study");
    expect(card!.notes.map((note) => note.body).slice(0, 2)).toEqual(["وافق على دفع الفرق", "العجز لا يُغلق"]);
    expect((await c.db.select().from(notes).where(eq(notes.clientId, id))).length).toBeGreaterThanOrEqual(2);
  });
});
