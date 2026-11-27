import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INBOX_PAPER } from "@/domain/documents";
import type { Connection } from "@/server/db/client";
import { auditLog, clients, documents, shareLinks, waMessages } from "@/server/db/schema";
import { rejectDeal } from "@/server/deals/service";
import { roadView } from "@/server/deals/views";
import { seedDemo } from "@/server/demo/seed";
import { clientOfDeal, getPapers, movePaperFile, reviewPaper } from "@/server/documents/service";
import { cloud, cloudConfig, registersWebhook, signedByMeta, type Cloud, type CloudMedia, type Sent } from "@/server/messages/cloud";
import { closeLinks, DEMO_LINK_SECRET, linkOf, linkToken, openLink, readLink } from "@/server/messages/links";
import { PORTAL_DAILY_FILES, portalUpload, portalView } from "@/server/messages/portal";
import { getMessages, noteSent, receive, sendMessage, threadOf } from "@/server/messages/service";
import { SYSTEM } from "@/server/shared/actor";
import { testDb } from "../helpers/db";

let c: Connection;
const now = new Date("2026-11-22T09:00:00Z");
const secret = DEMO_LINK_SECRET;
const deals: Record<string, number> = {};
const people: Record<string, number> = {};
const actor = { userId: null, ip: "10.0.0.7" };
const linkUrl = (token: string) => `https://masar.test/s/${token}`;

beforeAll(async () => {
  c = await testDb();
  await seedDemo(c.db, now);
  for (const deal of (await roadView(c.db, now)).deals) {
    deals[deal.clientName] = deal.dealId;
    people[deal.clientName] = (await clientOfDeal(c.db, deal.dealId))!;
  }
});
afterAll(async () => {
  await c.close();
});

const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4\n${text}\n%%EOF\n`);
const jpeg = (seed: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, seed, seed >> 8, 1, 2, 3, 4]);
const lastAudit = async () => (await c.db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(1))[0]!;
const lastMessage = async () => (await c.db.select().from(waMessages).orderBy(desc(waMessages.id)).limit(1))[0]!;
const code = async (run: () => Promise<unknown>) => run().then(() => "ok", (error) => error.code ?? String(error));
const demoToken = (fileNo: string) => linkToken(secret, `demo:${fileNo}`);
const papers = async (name: string) => (await getPapers(c.db, { dealId: deals[name]!, now }))!.list.papers;

/** A made-up WhatsApp that records what it was asked to send. */
function fakeCloud(options: { fail?: boolean; media?: Record<string, CloudMedia | null> } = {}) {
  const sent: { how: string; to: string; said: string | string[] }[] = [];
  const asked: string[] = [];
  const answer = (): Sent => (options.fail ? { ok: false, error: "Recipient not available (131026)" } : { ok: true, id: `wamid.${crypto.randomUUID()}` });
  const made: Cloud = {
    template: "masar_file_update",
    sendText: async (to, body) => (sent.push({ how: "text", to, said: body }), answer()),
    sendTemplate: async (to, params) => (sent.push({ how: "template", to, said: params }), answer()),
    sendCode: async (to, digits) => (sent.push({ how: "code", to, said: digits }), answer()),
    media: async (id) => (asked.push(id), options.media?.[id] ?? null),
  };
  return { cloud: made, sent, asked };
}

const inbound = (messages: unknown[], extra: Record<string, unknown> = {}) => ({ entry: [{ changes: [{ value: { messages, ...extra } }] }] });

describe("a client's link", () => {
  it("is the one the client already has while it is open", async () => {
    const link = await openLink(c.db, { dealId: deals["سالم"]!, secret, actor, now });
    expect(link.token).toBe(demoToken("C-014"));
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(link.views).toBe(3);
    expect(await readLink(c.db, { token: link.token, now })).toMatchObject({ clientId: people["سالم"] });
  });

  it("keeps only the token's hash and a seed, and a seed opens nothing without the secret", async () => {
    const [row] = await c.db.select().from(shareLinks).where(eq(shareLinks.clientId, people["سالم"]!));
    const token = demoToken("C-014");
    expect(JSON.stringify(row)).not.toContain(token);
    const forged = linkToken("another-secret", row!.seed);
    expect(forged).not.toBe(token);
    expect(await readLink(c.db, { token: forged, now })).toBeNull();
    expect(await readLink(c.db, { token: row!.seed, now })).toBeNull();
  });

  it("is shut for anything that is not an open link", async () => {
    const token = demoToken("C-017");
    expect(await readLink(c.db, { token, now })).not.toBeNull();
    expect(await readLink(c.db, { token, now: new Date("2026-12-10T09:00:00Z") })).toBeNull();
    for (const junk of ["", "short", `${token}x`, token.slice(0, 31) + "!", "../../etc/passwd"]) expect(await readLink(c.db, { token: junk, now })).toBeNull();
  });

  it("closes for good, and the next one is a different link", async () => {
    const before = (await linkOf(c.db, { clientId: people["فهد"]!, secret, now }))!;
    await closeLinks(c.db, { clientId: people["فهد"]!, actor });
    expect(await lastAudit()).toMatchObject({ action: "link.close", entityId: people["فهد"], ip: "10.0.0.7" });
    expect(await linkOf(c.db, { clientId: people["فهد"]!, secret, now })).toBeNull();
    expect(await readLink(c.db, { token: before.token, now })).toBeNull();

    const after = await openLink(c.db, { dealId: deals["فهد"]!, secret, actor, now });
    expect(await lastAudit()).toMatchObject({ action: "link.open", entityId: people["فهد"] });
    expect(after.token).not.toBe(before.token);
    expect(after.expiresAt.getTime() - now.getTime()).toBe(14 * 86_400_000);
    expect(await readLink(c.db, { token: after.token, now })).toMatchObject({ clientId: people["فهد"] });
    expect((await openLink(c.db, { dealId: deals["فهد"]!, secret, actor, now })).token).toBe(after.token);
  });

  it("is not made for a client the office does not write to", async () => {
    expect(await linkOf(c.db, { clientId: people["ريم"]!, secret, now })).toBeNull();
    expect(await code(() => openLink(c.db, { dealId: deals["ريم"]!, secret, actor, now }))).toBe("GATE_CLOSED");
    expect(await code(() => openLink(c.db, { dealId: 9999, secret, actor, now }))).toBe("NOT_FOUND");
  });
});

describe("the client's own page", () => {
  it("shows the road, the plan and the client's own papers", async () => {
    const view = (await portalView(c.db, { token: demoToken("C-014"), now }))!;
    expect(view).toMatchObject({ clientName: "سالم", fileNo: "C-014", stage: "payoff" });
    expect(view.steps.map((step) => step.state)).toEqual(["done", "done", "done", "current", "ahead", "ahead"]);
    expect(view.facts!.financing.length).toBeGreaterThan(0);
    expect(view.owed.map((paper) => [paper.code.startsWith("custom:") ? "custom" : paper.code, paper.status])).toEqual([
      ["salary_cert", "rejected"],
      ["custom", "missing"],
    ]);
    expect(view.owed[0]!.note).toBe("مضى عليه أكثر من شهر");
    expect(view.arrived.map((paper) => paper.code)).toEqual(["id", "address", "simah", "obligations", "bank_3", "deed"]);
  });

  it("never shows what the office brings, what waits unsorted, or what the company earns", async () => {
    for (const fileNo of ["C-019", "C-014", "C-017"]) {
      const token = fileNo === "C-019" ? (await linkOf(c.db, { clientId: people["فهد"]!, secret, now }))!.token : demoToken(fileNo);
      const view = (await portalView(c.db, { token, now }))!;
      const codes = [...view.owed, ...view.arrived].map((paper) => paper.code);
      for (const office of ["valuation", "agreement", "clearance", "payoff_letter", "transfer_deed", INBOX_PAPER]) expect(codes).not.toContain(office);
      // A paper the office adds is named by random hex, which can spell "fee": the codes are checked by name above, and the words are looked for in everything else.
      const text = JSON.stringify(view, (key, value: unknown) => (key === "code" ? undefined : value)).toLowerCase();
      for (const word of ["fee", "capital", "roi", "ledger", "risk", "phone", "nationalid", "salary\""]) expect(text, word).not.toContain(word);
    }
  });

  it("counts an opening only when asked to", async () => {
    const views = async () => (await linkOf(c.db, { clientId: people["سالم"]!, secret, now }))!.views;
    const before = await views();
    await portalView(c.db, { token: demoToken("C-014"), now });
    expect(await views()).toBe(before);
    await portalView(c.db, { token: demoToken("C-014"), now, count: true });
    expect(await views()).toBe(before + 1);
  });

  it("is shut for an unknown link", async () => {
    expect(await portalView(c.db, { token: demoToken("C-021"), now })).toBeNull();
    expect(await portalView(c.db, { token: "x".repeat(32), now })).toBeNull();
  });
});

describe("a file the client sends through their link", () => {
  const token = () => demoToken("C-017");

  it("is kept under the paper, as arrived, with nobody of the office named", async () => {
    const before = (await portalView(c.db, { token: token(), now }))!;
    expect(before.owed.map((paper) => paper.code)).toEqual(["salary_cert", "bank_3"]);
    expect(await portalUpload(c.db, { token: token(), code: "salary_cert", file: { name: "تعريف.jpg", bytes: jpeg(1) }, ip: "203.0.113.9", now })).toEqual({ added: true });
    expect(await lastAudit()).toMatchObject({ action: "doc.upload", userId: null, ip: "203.0.113.9", entityId: people["نورة"], details: { paper: "salary_cert", via: "portal", kind: "jpeg" } });
    const after = (await portalView(c.db, { token: token(), now }))!;
    expect(after.owed.map((paper) => paper.code)).toEqual(["bank_3"]);
    expect(after.arrived.find((paper) => paper.code === "salary_cert")).toMatchObject({ status: "received", files: 1 });
    expect(await portalUpload(c.db, { token: token(), code: "salary_cert", file: { name: "تعريف.jpg", bytes: jpeg(1) }, now })).toEqual({ added: false });
  });

  it("brings a paper that was sent back to the office's eyes again", async () => {
    const salem = demoToken("C-014");
    await portalUpload(c.db, { token: salem, code: "salary_cert", file: { name: "جديد.pdf", bytes: pdf("new letter") }, now });
    const paper = (await papers("سالم")).find((entry) => entry.code === "salary_cert")!;
    expect(paper).toMatchObject({ status: "received", note: null });
    expect(paper.files).toHaveLength(2);
  });

  it("goes only to a paper that is the client's to bring and still open", async () => {
    const send = (paper: string, bytes = jpeg(7)) => code(() => portalUpload(c.db, { token: demoToken("C-014"), code: paper, file: { name: "x.jpg", bytes }, now }));
    expect(await send("valuation")).toBe("INVALID_INPUT");
    expect(await send("payoff_letter")).toBe("INVALID_INPUT");
    expect(await send("id")).toBe("INVALID_INPUT");
    expect(await send("simah")).toBe("INVALID_INPUT");
    expect(await send(INBOX_PAPER)).toBe("INVALID_INPUT");
    expect(await send("cr")).toBe("INVALID_INPUT");
    expect(await send("custom:nothing")).toBe("INVALID_INPUT");
    expect(await send("bank_3", new TextEncoder().encode("<html>hello</html>"))).toBe("FILE_TYPE");
    expect(await send("bank_3", new Uint8Array(4 * 1024 * 1024 + 1))).toBe("FILE_TOO_LARGE");
  });

  it("is refused through a link that is not open", async () => {
    const file = { name: "x.jpg", bytes: jpeg(9) };
    expect(await code(() => portalUpload(c.db, { token: "y".repeat(32), code: "bank_3", file, now }))).toBe("LINK_CLOSED");
    expect(await code(() => portalUpload(c.db, { token: token(), code: "bank_3", file, now: new Date("2026-12-20T00:00:00Z") }))).toBe("LINK_CLOSED");
  });

  it("stops at a day's worth of files", async () => {
    const clientId = people["نورة"]!;
    const [counted] = await c.db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.action, "doc.upload"), eq(auditLog.entityId, clientId)));
    expect(counted).toBeTruthy();
    const filler = Array.from({ length: PORTAL_DAILY_FILES - 2 }, () => ({ action: "doc.upload", entity: "client", entityId: clientId, details: { via: "portal" }, createdAt: now }));
    await c.db.insert(auditLog).values(filler);
    expect(await portalUpload(c.db, { token: token(), code: "bank_3", file: { name: "a.jpg", bytes: jpeg(21) }, now })).toEqual({ added: true });
    expect(await code(() => portalUpload(c.db, { token: token(), code: "bank_3", file: { name: "b.jpg", bytes: jpeg(22) }, now }))).toBe("UPLOAD_LIMIT");
  });
});

describe("what the messages page of a deal knows", () => {
  it("has the gate, the client's papers, their link and the conversation", async () => {
    const view = (await getMessages(c.db, { dealId: deals["سالم"]!, secret, now }))!;
    expect(view.gate).toEqual({ allowed: ["study", "papers", "progress", "reply", "internal"], reason: null });
    expect(view.phone).toBe("966500000014");
    expect(view.link!.token).toBe(demoToken("C-014"));
    expect(view.windowOpen).toBe(true);
    expect(view.thread.map((message) => [message.direction, message.type, message.status])).toEqual([
      ["out", "text", "read"],
      ["in", "document", "received"],
      ["in", "text", "received"],
    ]);
    expect(view.thread[1]!.fileId).toBeGreaterThan(0);
    expect(view.owed.every((paper) => paper.by === "client")).toBe(true);
  });

  it("closes the client's messages for a deal that does not close", async () => {
    const view = (await getMessages(c.db, { dealId: deals["ريم"]!, secret, now }))!;
    expect(view.gate).toEqual({ allowed: ["internal"], reason: "DEFICIT" });
    expect(view.link).toBeNull();
    expect(view.windowOpen).toBe(false);
    expect(await getMessages(c.db, { dealId: 9999, secret, now })).toBeNull();
  });
});

describe("sending from the company's number", () => {
  it("sends the text as written while the client wrote within a day", async () => {
    const wa = fakeCloud();
    const answer = await sendMessage(c.db, { dealId: deals["سالم"]!, kind: "progress", body: "  تحديث على ملفك  ", actor, cloud: wa.cloud, secret, linkUrl, now });
    expect(answer).toEqual({ via: "text" });
    expect(wa.sent).toEqual([{ how: "text", to: "966500000014", said: "تحديث على ملفك" }]);
    expect(await lastMessage()).toMatchObject({ clientId: people["سالم"], direction: "out", type: "text", body: "تحديث على ملفك", status: "sent", error: null, phone: "966500000014" });
    expect((await lastMessage()).waId).toMatch(/^wamid\./);
    expect(await lastAudit()).toMatchObject({ action: "wa.send", entityId: people["سالم"], details: { kind: "progress", via: "text", ok: true } });
  });

  it("sends the approved template with the client's link when they have been quiet", async () => {
    const wa = fakeCloud();
    const answer = await sendMessage(c.db, { dealId: deals["نورة"]!, kind: "papers", body: "نحتاج كشف الحساب", actor, cloud: wa.cloud, secret, linkUrl, now });
    expect(answer).toEqual({ via: "template" });
    const url = `https://masar.test/s/${demoToken("C-017")}`;
    expect(wa.sent).toEqual([{ how: "template", to: "966500000017", said: ["نورة", url] }]);
    expect(await lastMessage()).toMatchObject({ type: "template", body: `[masar_file_update] نورة ${url}`, status: "sent" });
  });

  it("records a message WhatsApp refused, and says it was not sent", async () => {
    const wa = fakeCloud({ fail: true });
    expect(await code(() => sendMessage(c.db, { dealId: deals["سالم"]!, kind: "papers", body: "نحتاج التعريف", actor, cloud: wa.cloud, secret, linkUrl, now }))).toBe("SEND_FAILED");
    expect(await lastMessage()).toMatchObject({ status: "failed", error: "Recipient not available (131026)", waId: null });
    expect(await lastAudit()).toMatchObject({ action: "wa.send", details: { ok: false } });
  });

  it("refuses what may not be said, before WhatsApp is asked anything", async () => {
    const wa = fakeCloud();
    const send = (name: string, kind: string, body = "نص") => code(() => sendMessage(c.db, { dealId: deals[name]!, kind, body, actor, cloud: wa.cloud, secret, linkUrl, now }));
    const before = (await lastMessage()).id;
    expect(await send("سالم", "internal")).toBe("INVALID_INPUT");
    expect(await send("سالم", "anything")).toBe("INVALID_INPUT");
    expect(await send("سالم", "study", "   ")).toBe("MESSAGE_EMPTY");
    expect(await send("سالم", "study", "ن".repeat(4097))).toBe("INVALID_INPUT");
    expect(await send("ريم", "study")).toBe("GATE_CLOSED");
    expect(await send("ريم", "papers")).toBe("GATE_CLOSED");
    expect(await send("ريم", "reply")).toBe("GATE_CLOSED");
    expect(await code(() => sendMessage(c.db, { dealId: 9999, kind: "study", body: "نص", actor, cloud: wa.cloud, secret, linkUrl, now }))).toBe("NOT_FOUND");
    expect(await code(() => sendMessage(c.db, { dealId: deals["سالم"]!, kind: "study", body: "نص", actor, cloud: null, secret, linkUrl, now }))).toBe("WA_OFF");
    expect(wa.sent).toEqual([]);
    expect((await lastMessage()).id).toBe(before);
  });

  it("needs a phone number that is one", async () => {
    const wa = fakeCloud();
    await c.db.update(clients).set({ phone: "12345" }).where(eq(clients.id, people["فهد"]!));
    expect(await code(() => sendMessage(c.db, { dealId: deals["فهد"]!, kind: "study", body: "نص", actor, cloud: wa.cloud, secret, linkUrl, now }))).toBe("NO_PHONE");
    await c.db.update(clients).set({ phone: "0500000019" }).where(eq(clients.id, people["فهد"]!));
    expect(wa.sent).toEqual([]);
  });

  it("keeps a note of a message a person sent from their own WhatsApp", async () => {
    await noteSent(c.db, { dealId: deals["سالم"]!, kind: "study", body: "ملخص الدراسة", actor, now });
    expect(await lastMessage()).toMatchObject({ direction: "out", status: "manual", body: "ملخص الدراسة", waId: null });
    expect(await lastAudit()).toMatchObject({ action: "wa.send", details: { kind: "study", via: "manual" } });
    expect(await code(() => noteSent(c.db, { dealId: deals["سالم"]!, kind: "internal", body: "أتعابنا", actor, now }))).toBe("INVALID_INPUT");
    expect(await code(() => noteSent(c.db, { dealId: deals["ريم"]!, kind: "study", body: "نص", actor, now }))).toBe("GATE_CLOSED");
  });
});

describe("what Meta reports", () => {
  it("updates how a sent message is doing", async () => {
    const wa = fakeCloud();
    await sendMessage(c.db, { dealId: deals["سالم"]!, kind: "progress", body: "أين وصل ملفك", actor, cloud: wa.cloud, secret, linkUrl, now });
    const sent = await lastMessage();
    const report = (status: string, errors?: unknown[]) => receive(c.db, { payload: { entry: [{ changes: [{ value: { statuses: [{ id: sent.waId, status, errors }] } }] }] }, cloud: null, now });
    expect(await report("delivered")).toEqual({ messages: 0, statuses: 1 });
    expect((await lastMessage()).status).toBe("delivered");
    await report("read");
    expect((await lastMessage()).status).toBe("read");
    await report("failed", [{ title: "Message undeliverable" }]);
    expect(await lastMessage()).toMatchObject({ status: "failed", error: "Message undeliverable" });
    expect(await receive(c.db, { payload: { entry: [{ changes: [{ value: { statuses: [{ id: "wamid.unknown", status: "read" }] } }] }] }, cloud: null, now })).toEqual({ messages: 0, statuses: 0 });
  });

  it("keeps what a client wrote, once, under their file", async () => {
    const message = { from: "966500000017", id: "wamid.in.1", type: "text", text: { body: "وصلتني رسالتكم" } };
    const payload = inbound([message], { contacts: [{ wa_id: "966500000017", profile: { name: "Noura" } }] });
    expect(await receive(c.db, { payload, cloud: null, now })).toEqual({ messages: 1, statuses: 0 });
    expect(await lastMessage()).toMatchObject({ clientId: people["نورة"], direction: "in", type: "text", body: "وصلتني رسالتكم", status: "received", name: "Noura", phone: "966500000017" });
    expect(await receive(c.db, { payload, cloud: null, now })).toEqual({ messages: 0, statuses: 0 });
    // The client wrote, so free text is open again.
    expect((await getMessages(c.db, { dealId: deals["نورة"]!, secret, now }))!.windowOpen).toBe(true);
  });

  it("keeps a picture from a client in the tray of what arrived by WhatsApp", async () => {
    const wa = fakeCloud({ media: { "media.1": { bytes: jpeg(41), mime: "image/jpeg" } } });
    const payload = inbound([{ from: "966500000017", id: "wamid.in.2", type: "image", image: { id: "media.1", caption: "كشف الحساب" } }]);
    expect(await receive(c.db, { payload, cloud: wa.cloud, now })).toEqual({ messages: 1, statuses: 0 });
    expect(wa.asked).toEqual(["media.1"]);
    const kept = await lastMessage();
    expect(kept).toMatchObject({ type: "image", body: "كشف الحساب", error: null });
    expect(kept.fileId).toBeGreaterThan(0);
    const tray = (await papers("نورة")).find((paper) => paper.code === INBOX_PAPER)!;
    expect(tray).toMatchObject({ category: "extra", required: false, asked: false, status: "received" });
    expect(tray.files.map((file) => [file.id, file.name, file.kind])).toEqual([[kept.fileId, "whatsapp.jpg", "jpeg"]]);
    const [audit] = await c.db.select().from(auditLog).where(eq(auditLog.action, "doc.upload")).orderBy(desc(auditLog.id)).limit(1);
    expect(audit).toMatchObject({ userId: null, details: { paper: INBOX_PAPER, via: "whatsapp" } });
  });

  it("keeps the message even when its file cannot be kept", async () => {
    const wa = fakeCloud({ media: { "media.bad": { bytes: new TextEncoder().encode("MZ executable"), mime: "application/pdf" } } });
    const send = (id: string, media: string) => receive(c.db, { payload: inbound([{ from: "966500000017", id, type: "document", document: { id: media, filename: "ملف.pdf" } }]), cloud: wa.cloud, now });
    expect(await send("wamid.in.3", "media.bad")).toEqual({ messages: 1, statuses: 0 });
    expect(await lastMessage()).toMatchObject({ type: "document", fileId: null, error: "FILE_TYPE" });
    expect(await send("wamid.in.4", "media.too.large")).toEqual({ messages: 1, statuses: 0 });
    expect(await lastMessage()).toMatchObject({ fileId: null, error: "MEDIA_NOT_KEPT" });
  });

  it("keeps a message from a number nobody knows, without fetching its file", async () => {
    const wa = fakeCloud({ media: { "media.9": { bytes: jpeg(9), mime: "image/jpeg" } } });
    const payload = inbound([{ from: "966511112222", id: "wamid.in.5", type: "image", image: { id: "media.9" } }]);
    expect(await receive(c.db, { payload, cloud: wa.cloud, now })).toEqual({ messages: 1, statuses: 0 });
    expect(await lastMessage()).toMatchObject({ clientId: null, phone: "966511112222", fileId: null, body: null });
    expect(wa.asked).toEqual([]);
  });

  it("ignores what it cannot read", async () => {
    expect(await code(() => receive(c.db, { payload: "not json", cloud: null, now }))).toBe("INVALID_INPUT");
    expect(await receive(c.db, { payload: {}, cloud: null, now })).toEqual({ messages: 0, statuses: 0 });
    expect(await receive(c.db, { payload: inbound([{ nothing: true }, { from: "abc", id: "x", type: "text" }]), cloud: null, now })).toEqual({ messages: 0, statuses: 0 });
  });
});

describe("a file that arrived by WhatsApp", () => {
  it("becomes the paper it is when a person puts it there", async () => {
    const clientId = people["سالم"]!;
    const tray = (await papers("سالم")).find((paper) => paper.code === INBOX_PAPER)!;
    expect(tray.files.map((file) => file.name)).toEqual(["تعريف جديد.pdf"]);
    const fileId = tray.files[0]!.id;

    expect(await code(() => reviewPaper(c.db, { clientId, paperId: tray.id!, review: { verdict: "verified" }, actor }))).toBe("INVALID_INPUT");
    expect(await code(() => movePaperFile(c.db, { clientId, fileId, code: "simah", actor, now }))).toBe("INVALID_INPUT");
    expect(await code(() => movePaperFile(c.db, { clientId, fileId, code: INBOX_PAPER, actor, now }))).toBe("INVALID_INPUT");
    expect(await code(() => movePaperFile(c.db, { clientId: people["نورة"]!, fileId, code: "salary_cert", actor, now }))).toBe("NOT_FOUND");

    await movePaperFile(c.db, { clientId, fileId, code: "salary_cert", actor, now });
    expect(await lastAudit()).toMatchObject({ action: "doc.move", entityId: clientId, details: { fileId, from: INBOX_PAPER, to: "salary_cert" } });
    const after = await papers("سالم");
    expect(after.find((paper) => paper.code === INBOX_PAPER)).toBeUndefined();
    const letter = after.find((paper) => paper.code === "salary_cert")!;
    expect(letter.status).toBe("received");
    expect(letter.files.map((file) => file.id)).toContain(fileId);
    // The message still points at the file it brought.
    expect((await threadOf(c.db, clientId)).find((message) => message.fileId === fileId)).toBeTruthy();
    // The tray's row stays, empty and out of sight.
    const [row] = await c.db.select().from(documents).where(and(eq(documents.clientId, clientId), eq(documents.code, INBOX_PAPER)));
    expect(row).toMatchObject({ status: "missing" });
  });
});

describe("a deal that falls through", () => {
  it("shuts the client's page and their messages", async () => {
    const token = demoToken("C-017");
    expect(await portalView(c.db, { token, now })).not.toBeNull();
    await rejectDeal(c.db, { clientId: people["نورة"]!, reason: "انسحب العميل", actor: SYSTEM, now });
    expect(await portalView(c.db, { token, now })).toBeNull();
    expect(await code(() => portalUpload(c.db, { token, code: "bank_3", file: { name: "x.jpg", bytes: jpeg(77) }, now }))).toBe("LINK_CLOSED");
    const dealId = deals["نورة"]!;
    expect((await getMessages(c.db, { dealId, secret, now }))!.gate).toEqual({ allowed: ["internal"], reason: "REJECTED" });
    expect(await code(() => noteSent(c.db, { dealId, kind: "progress", body: "نص", actor, now }))).toBe("GATE_CLOSED");
  });
});

describe("talking to Meta", () => {
  const config = cloudConfig({ WA_TOKEN: "token-1", WA_PHONE_ID: "1055" })!;

  it("stays off until the owner connects it", () => {
    expect(cloudConfig({})).toBeNull();
    expect(cloudConfig({ WA_TOKEN: "t" })).toBeNull();
    expect(config).toMatchObject({ version: "v21.0", template: "masar_file_update", templateLang: "ar", codeTemplate: "masar_login_code" });
  });

  it("posts a message with the token and reads the id back", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.abc" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const wa = cloud(config, fetcher);
    expect(await wa.sendText("966500000014", "مرحبا")).toEqual({ ok: true, id: "wamid.abc" });
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v21.0/1055/messages");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer token-1");
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ messaging_product: "whatsapp", to: "966500000014", type: "text", text: { body: "مرحبا" } });

    await wa.sendTemplate("966500000014", ["سالم", "https://x/s/t\nline"]);
    expect(JSON.parse(String(calls[1]!.init.body)).template).toMatchObject({ name: "masar_file_update", language: { code: "ar" }, components: [{ type: "body", parameters: [{ text: "سالم" }, { text: "https://x/s/t line" }] }] });
    await wa.sendCode("966500000014", "481516");
    expect(JSON.parse(String(calls[2]!.init.body)).template).toMatchObject({ name: "masar_login_code", components: [{ type: "body", parameters: [{ text: "481516" }] }, { type: "button", sub_type: "url" }] });
  });

  it("reports a refusal and a dead line without throwing", async () => {
    const refuses = (async () => new Response(JSON.stringify({ error: { message: "Invalid parameter", code: 100 } }), { status: 400 })) as unknown as typeof fetch;
    expect(await cloud(config, refuses).sendText("9665", "x")).toEqual({ ok: false, error: "Invalid parameter (100)" });
    const dead = (async () => {
      throw new Error("socket hang up");
    }) as unknown as typeof fetch;
    expect(await cloud(config, dead).sendText("9665", "x")).toEqual({ ok: false, error: "network: socket hang up" });
    expect(await cloud(config, dead).media("m", 100)).toBeNull();
  });

  it("fetches a file a client sent, within the size it is told", async () => {
    const fetcher = (async (url: string) =>
      String(url).includes("graph.facebook.com")
        ? new Response(JSON.stringify({ url: "https://lookaside.example/file", mime_type: "image/jpeg; charset=binary", file_size: 10 }), { status: 200 })
        : new Response(jpeg(3), { status: 200 })) as unknown as typeof fetch;
    const wa = cloud(config, fetcher);
    expect(await wa.media("m1", 100)).toEqual({ bytes: jpeg(3), mime: "image/jpeg" });
    expect(await wa.media("m1", 5)).toBeNull();
    const plain = (async () => new Response(JSON.stringify({ url: "http://plain.example/file", file_size: 1 }), { status: 200 })) as unknown as typeof fetch;
    expect(await cloud(config, plain).media("m2", 100)).toBeNull();
  });

  it("trusts a webhook call only with Meta's signature over its exact body", () => {
    const body = JSON.stringify({ entry: [] });
    const sign = (key: string, text: string) => `sha256=${crypto.createHmac("sha256", key).update(text).digest("hex")}`;
    expect(signedByMeta("app-secret", body, sign("app-secret", body))).toBe(true);
    expect(signedByMeta("app-secret", body, sign("other", body))).toBe(false);
    expect(signedByMeta("app-secret", `${body} `, sign("app-secret", body))).toBe(false);
    expect(signedByMeta("app-secret", body, null)).toBe(false);
    expect(signedByMeta("app-secret", body, "sha1=abc")).toBe(false);
    expect(signedByMeta(undefined, body, sign("", body))).toBe(false);
    expect(registersWebhook("word", "subscribe", "word")).toBe(true);
    expect(registersWebhook("word", "subscribe", "wor")).toBe(false);
    expect(registersWebhook("word", "unsubscribe", "word")).toBe(false);
    expect(registersWebhook(undefined, "subscribe", "")).toBe(false);
  });
});
