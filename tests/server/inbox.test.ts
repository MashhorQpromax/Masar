import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Connection } from "@/server/db/client";
import { auditLog, clients, waMessages } from "@/server/db/schema";
import { roadView } from "@/server/deals/views";
import { seedDemo } from "@/server/demo/seed";
import { claimNumber, inboxOf, markHandled, strangerOf, waitingCount } from "@/server/messages/inbox";
import { DEMO_LINK_SECRET } from "@/server/messages/links";
import { getMessages, noteSent, receive } from "@/server/messages/service";
import { testDb } from "../helpers/db";

let c: Connection;
const now = new Date("2026-11-22T09:00:00Z");
const actor = { userId: null, ip: "10.0.0.7" };
const people: Record<string, number> = {};
const deals: Record<string, number> = {};

beforeAll(async () => {
  c = await testDb();
  await seedDemo(c.db, now);
  for (const row of await c.db.select({ id: clients.id, name: clients.fullName }).from(clients)) people[row.name] = row.id;
  for (const deal of (await roadView(c.db, now)).deals) deals[deal.clientName] = deal.dealId;
});
afterAll(async () => {
  await c.close();
});

const code = async (run: () => Promise<unknown>) => run().then(() => "ok", (error) => error.code ?? String(error));
const lastAudit = async () => (await c.db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(1))[0]!;
const who = async () => (await inboxOf(c.db)).map((talk) => [talk.client?.name ?? talk.waName ?? talk.phone, talk.waiting]);
const text = (from: string, id: string, body: string, name?: string) => ({
  entry: [{ changes: [{ value: { messages: [{ from, id, type: "text", text: { body } }], contacts: name ? [{ wa_id: from, profile: { name } }] : [] } }] }],
});

describe("the inbox", () => {
  it("lists one conversation per client and per unknown number, the waiting ones first", async () => {
    expect(await who()).toEqual([
      ["أبو تركي", true],
      ["سالم", true],
      ["فهد", false],
    ]);
    expect(await waitingCount(c.db)).toBe(2);
    const [stranger, salem, fahad] = await inboxOf(c.db);
    expect(stranger).toMatchObject({ client: null, phone: "966500000031", waName: "أبو تركي", last: { direction: "in", body: "أعمل في جهة حكومية وراتبي 14 ألف" } });
    expect(salem).toMatchObject({ client: { name: "سالم", fileNo: "C-014", dealId: deals["سالم"] }, waName: null, last: { direction: "in", body: "متى يتحدث سجلي في سمة؟" } });
    // The client's thanks was marked as needing no answer.
    expect(fahad).toMatchObject({ client: { name: "فهد" }, last: { direction: "in", body: "الحمد لله، بانتظاركم" }, waiting: false });
    expect(await inboxOf(c.db, { limit: 1 })).toHaveLength(1);
  });

  it("stops waiting once the office answers, and waits again when the client writes", async () => {
    expect((await getMessages(c.db, { dealId: deals["سالم"]!, secret: DEMO_LINK_SECRET, now }))!.waiting).toBe(true);
    await noteSent(c.db, { dealId: deals["سالم"]!, kind: "reply", body: "يتحدث خلال أيام بعد المخالصة", actor, now });
    expect(await who()).toEqual([
      ["أبو تركي", true],
      ["سالم", false],
      ["فهد", false],
    ]);
    expect((await getMessages(c.db, { dealId: deals["سالم"]!, secret: DEMO_LINK_SECRET, now }))!.waiting).toBe(false);
    await receive(c.db, { payload: text("966500000014", "wamid.again", "شكراً"), cloud: null, now });
    expect(await who()).toEqual([
      ["سالم", true],
      ["أبو تركي", true],
      ["فهد", false],
    ]);
  });

  it("stops waiting when someone says the conversation needs no answer", async () => {
    expect(await markHandled(c.db, { clientId: people["سالم"]! }, actor, now)).toBe(3);
    expect(await lastAudit()).toMatchObject({ action: "wa.handled", entity: "wa_message", details: { messages: 3 }, ip: "10.0.0.7" });
    expect(await waitingCount(c.db)).toBe(1);
    const before = (await lastAudit()).id;
    expect(await markHandled(c.db, { clientId: people["سالم"]! }, actor, now)).toBe(0);
    expect((await lastAudit()).id).toBe(before);
    expect(await markHandled(c.db, { phone: "0500000031" }, actor, now)).toBe(2);
    expect(await waitingCount(c.db)).toBe(0);
    expect(await markHandled(c.db, { phone: "not a number" }, actor, now)).toBe(0);
  });
});

describe("a number the office does not know", () => {
  it("shows what it wrote and the name it carries", async () => {
    await receive(c.db, { payload: text("966500000031", "wamid.more", "هل من رد؟", "تركي العلي"), cloud: null, now });
    const stranger = (await strangerOf(c.db, "0500000031"))!;
    expect(stranger).toMatchObject({ phone: "966500000031", waName: "تركي العلي", waiting: true });
    expect(stranger.thread.map((message) => message.body)).toEqual(["السلام عليكم، وصلني رقمكم من صديق. عندي تعثر مسجل في سمة وقرض عقاري قائم، هل لكم حل؟", "أعمل في جهة حكومية وراتبي 14 ألف", "هل من رد؟"]);
    expect(await strangerOf(c.db, "966500000014")).toBeNull();
    expect(await strangerOf(c.db, "0509999999")).toBeNull();
    expect(await strangerOf(c.db, "abc")).toBeNull();
  });

  it("becomes a client's number, and what it wrote joins their conversation", async () => {
    expect(await code(() => claimNumber(c.db, { phone: "0500000031", clientId: 9999, actor, now }))).toBe("NOT_FOUND");
    expect(await code(() => claimNumber(c.db, { phone: "abc", clientId: people["ريم"]!, actor, now }))).toBe("BAD_PHONE");
    // A number that is another client's cannot be given to this one.
    expect(await code(() => claimNumber(c.db, { phone: "0500000014", clientId: people["ريم"]!, actor, now }))).toBe("PHONE_TAKEN");

    expect(await claimNumber(c.db, { phone: "0500000031", clientId: people["ريم"]!, actor, now })).toEqual({ adopted: 3 });
    expect((await c.db.select().from(clients).where(eq(clients.id, people["ريم"]!)))[0]!.phone).toBe("966500000031");
    expect(await lastAudit()).toMatchObject({ action: "client.contact", entityId: people["ريم"], details: { changed: ["phone"], adopted: 3, via: "inbox" } });
    expect(await strangerOf(c.db, "0500000031")).toBeNull();
    expect((await inboxOf(c.db))[0]).toMatchObject({ client: { name: "ريم", fileNo: "C-021" }, waName: null, waiting: true });
    // What arrives from that number next goes straight to the client.
    await receive(c.db, { payload: text("966500000031", "wamid.after", "وصلتني رسالتكم"), cloud: null, now });
    expect((await c.db.select().from(waMessages).where(eq(waMessages.waId, "wamid.after")))[0]!.clientId).toBe(people["ريم"]);
  });
});
