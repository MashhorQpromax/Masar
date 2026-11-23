import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SHARED_KEYS } from "@/domain/request";
import { approveAnalysis } from "@/server/analysis/approval";
import { setConsent } from "@/server/clients/service";
import type { Connection } from "@/server/db/client";
import { auditLog, clients, deals, lenderRequests, lenders, users } from "@/server/db/schema";
import { DEMO_BANK, DEMO_COMPANY, seedDemoLenders } from "@/server/demo/lenders";
import { seedDemo } from "@/server/demo/seed";
import { addPaper, keepFile } from "@/server/documents/service";
import { lenderReplies, recordDecision } from "@/server/knowledge/service";
import { getOpportunities } from "@/server/opportunities/service";
import {
  addContact,
  approveRequest,
  checkContact,
  closeRequest,
  contactsOf,
  prepareRequest,
  recordSent,
  recordShareConsent,
  requestById,
  requestsBoard,
  stopContact,
  withdrawShareConsent,
} from "@/server/requests/service";
import { setFollowUpDays } from "@/server/settings/requests";
import type { Actor } from "@/server/shared/actor";
import { DomainError } from "@/server/shared/errors";
import { testDb } from "../helpers/db";
import { withoutDemoConflict } from "../helpers/demo";

/**
 * A deal's requests to lenders, end to end: the ways of reaching a lender, the client's consent to
 * sharing, a message written from the approved file that names nobody, its approval and its send
 * recorded by a person, the lender's answer on it, and the follow-up of one left unanswered.
 */
let c: Connection;
let actor: Actor;
let clientId: number;
let dealId: number;
let fileNo: string;
let bank: number;
let company: number;
const now = new Date("2026-11-23T09:00:00Z");
const later = (days: number) => new Date(now.getTime() + days * 86_400_000);
const REASON = "الجهة أكدت الشرط هاتفياً، وخطابها في الطريق";

beforeAll(async () => {
  c = await testDb();
  await seedDemo(c.db, now);
  await seedDemoLenders(c.db, now);
  await withoutDemoConflict(c.db);
  const [user] = await c.db
    .insert(users)
    .values({
      name: "مدير المكتب",
      email: "boss@requests.test",
      passwordHash: "x",
      role: "admin",
    })
    .returning();
  actor = { userId: user!.id };
  const [client] = await c.db.select().from(clients).where(eq(clients.fileNo, "C-014"));
  clientId = client!.id;
  fileNo = client!.fileNo;
  const [deal] = await c.db.select({ id: deals.id }).from(deals).where(eq(deals.clientId, clientId));
  dealId = deal!.id;
  const named = new Map((await c.db.select({ id: lenders.id, name: lenders.name }).from(lenders)).map((l) => [l.name, l.id]));
  bank = named.get(DEMO_BANK)!;
  company = named.get(DEMO_COMPANY)!;
});
afterAll(async () => {
  await c.close();
});

const reason = async (run: () => Promise<unknown>): Promise<string | null> => {
  try {
    await run();
    return null;
  } catch (error) {
    if (error instanceof DomainError) return error.params.reason ?? error.code;
    throw error;
  }
};

/** The opportunity whose two parts both come from the made-up bank. */
const bankRoute = async () =>
  (await getOpportunities(c.db, { dealId, now }))!.list.find((o) => o.route.mortgage?.product.lenderName === DEMO_BANK && o.route.personal?.product.lenderName === DEMO_BANK)!;
const status = async (requestId: number) => (await c.db.select({ status: lenderRequests.status }).from(lenderRequests).where(eq(lenderRequests.id, requestId)))[0]!.status;

let checked: number;

describe("a way of reaching a lender", () => {
  it("is kept with its source and check, and refuses what is not written as its kind", async () => {
    expect(
      await reason(() =>
        addContact(c.db, {
          input: {
            lenderId: bank,
            kind: "email",
            value: "not an address",
            person: null,
            source: null,
            checkedOn: null,
          },
          actor,
          now,
        }),
      ),
    ).toBe("BAD_EMAIL");
    expect(
      await reason(() =>
        addContact(c.db, {
          input: {
            lenderId: bank,
            kind: "portal",
            value: "http://portal.bank.example",
            person: null,
            source: null,
            checkedOn: null,
          },
          actor,
          now,
        }),
      ),
    ).toBe("BAD_LINK");
    expect(
      await reason(() =>
        addContact(c.db, {
          input: {
            lenderId: bank,
            kind: "email",
            value: "sme@bank.example",
            person: null,
            source: null,
            checkedOn: "2026-11-20",
          },
          actor,
          now,
        }),
      ),
    ).toBe("INVALID_INPUT");
    expect(
      await reason(() =>
        addContact(c.db, {
          input: {
            lenderId: bank,
            kind: "email",
            value: "sme@bank.example",
            person: null,
            source: "خطاب الجهة",
            checkedOn: "2026-11-24",
          },
          actor,
          now,
        }),
      ),
    ).toBe("INVALID_INPUT");

    const { id: bare } = await addContact(c.db, {
      input: {
        lenderId: bank,
        kind: "whatsapp",
        value: "+966 55 000 0000",
        person: null,
        source: null,
        checkedOn: null,
      },
      actor,
      now,
    });
    ({ id: checked } = await addContact(c.db, {
      input: {
        lenderId: bank,
        kind: "email",
        value: "sme@bank.example",
        person: "مسؤولة الطلبات",
        source: "خطاب الجهة",
        checkedOn: "2026-11-20",
      },
      actor,
      now,
    }));
    const { id: old } = await addContact(c.db, {
      input: {
        lenderId: bank,
        kind: "phone",
        value: "011 000 0000",
        person: null,
        source: "موقع الجهة",
        checkedOn: "2026-04-01",
      },
      actor,
      now,
    });

    const states = async () => Object.fromEntries((await contactsOf(c.db, { lenderId: bank, today: "2026-11-23" })).map((line) => [line.id, line.state.problem]));
    expect(await states()).toEqual({
      [bare]: "NO_SOURCE",
      [checked]: null,
      [old]: "EXPIRED",
    });
    await checkContact(c.db, {
      contactId: old,
      input: { source: "اتصال بالفرع", checkedOn: "2026-11-23" },
      actor,
      now,
    });
    await stopContact(c.db, { contactId: bare, actor });
    expect(await states()).toEqual({
      [bare]: "STOPPED",
      [checked]: null,
      [old]: null,
    });

    const logged = (await c.db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, bank))).map((row) => row.action);
    expect(logged.filter((action) => action.startsWith("lender.contact"))).toEqual(["lender.contact_add", "lender.contact_add", "lender.contact_add", "lender.contact_check", "lender.contact_stop"]);
  });
});

let first: number;

describe("preparing a request", () => {
  it("needs the client's consents and an approved analysis, then writes a message that names nobody", async () => {
    const { key } = await bankRoute();
    const prepare = () =>
      prepareRequest(c.db, {
        dealId,
        routeKey: key,
        lenderId: bank,
        actor,
        now,
      });

    await setConsent(c.db, { clientId, given: false, actor, now });
    expect(await reason(prepare)).toBe("NO_CONSENT");
    expect(
      await reason(() =>
        recordShareConsent(c.db, {
          clientId,
          input: {
            lenderId: bank,
            way: "verbal",
            note: null,
            givenOn: "2026-11-23",
          },
          actor,
          now,
        }),
      ),
    ).toBe("CONSENT_NEEDED");
    await setConsent(c.db, { clientId, given: true, actor, now });
    expect(await reason(prepare)).toBe("NO_SHARING");

    expect(
      await reason(() =>
        recordShareConsent(c.db, {
          clientId,
          input: {
            lenderId: bank,
            way: "verbal",
            note: null,
            givenOn: "2026-11-24",
          },
          actor,
          now,
        }),
      ),
    ).toBe("INVALID_INPUT");
    await recordShareConsent(c.db, {
      clientId,
      input: {
        lenderId: bank,
        way: "verbal",
        note: "في اتصال هاتفي",
        givenOn: "2026-11-23",
      },
      actor,
      now,
    });
    expect(await reason(prepare)).toBe("NOT_APPROVED");

    await approveAnalysis(c.db, { clientId, reason: REASON, actor, now });
    ({ id: first } = await prepare());

    const [row] = await c.db.select().from(lenderRequests).where(eq(lenderRequests.id, first));
    const [client] = await c.db.select().from(clients).where(eq(clients.id, clientId));
    expect(row).toMatchObject({
      status: "draft",
      dealId,
      clientId,
      lenderId: bank,
      routeKey: key,
      preparedBy: actor.userId,
    });
    expect(row!.mortgageProductId).not.toBeNull();
    expect(row!.personalProductId).not.toBeNull();
    // What the lender is told is exactly the shared facts, and nothing that names the client.
    expect(Object.keys(row!.shared).sort()).toEqual([...SHARED_KEYS].sort());
    expect(row!.message).toContain(`مرجعه عندنا ${fileNo}`);
    for (const part of [client!.fullName, ...client!.fullName.split(" "), client!.phone, client!.nationalId].filter((value): value is string => !!value && value.length > 2)) {
      expect(row!.message, part).not.toContain(part);
      expect(JSON.stringify(row!.shared), part).not.toContain(part);
    }

    // One open request for a client and a lender: the second is refused and points at the first.
    try {
      await prepare();
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        code: "REQUEST_REFUSED",
        params: { reason: "OPEN_REQUEST", request: String(first) },
      });
    }
    const [logged] = await c.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "request.prepare"), eq(auditLog.entityId, dealId)));
    expect(logged).toMatchObject({
      entity: "deal",
      details: {
        lender: DEMO_BANK,
        request: first,
        parts: ["mortgage", "personal"],
      },
    });
  });

  it("is refused on an opportunity that cannot be carried out", async () => {
    const viewing = (await getOpportunities(c.db, { dealId, now }))!;
    const refused = viewing.list.find((o) => o.class === "not_viable" && (o.route.mortgage?.product.lenderName === DEMO_COMPANY || o.route.personal?.product.lenderName === DEMO_COMPANY))!;
    await recordShareConsent(c.db, {
      clientId,
      input: {
        lenderId: company,
        way: "written",
        note: null,
        givenOn: "2026-11-23",
      },
      actor,
      now,
    });
    expect(
      await reason(() =>
        prepareRequest(c.db, {
          dealId,
          routeKey: refused.key,
          lenderId: company,
          actor,
          now,
        }),
      ),
    ).toBe("NOT_VIABLE");
    expect(
      await reason(() =>
        prepareRequest(c.db, {
          dealId,
          routeKey: "no-such-route",
          lenderId: company,
          actor,
          now,
        }),
      ),
    ).toBe("ROUTE_GONE");
  });
});

describe("approving and sending a request", () => {
  it("refuses a message the file no longer matches, and one whose analysis approval fell", async () => {
    const [row] = await c.db.select({ print: lenderRequests.print }).from(lenderRequests).where(eq(lenderRequests.id, first));
    await c.db.update(lenderRequests).set({ print: "something else" }).where(eq(lenderRequests.id, first));
    expect(await reason(() => approveRequest(c.db, { requestId: first, actor, now }))).toBe("STALE");
    await c.db.update(lenderRequests).set({ print: row!.print }).where(eq(lenderRequests.id, first));

    const [client] = await c.db.select({ serviceMonths: clients.serviceMonths }).from(clients).where(eq(clients.id, clientId));
    await c.db
      .update(clients)
      .set({ serviceMonths: (client!.serviceMonths ?? 0) + 1 })
      .where(eq(clients.id, clientId));
    expect(await reason(() => approveRequest(c.db, { requestId: first, actor, now }))).toBe("NOT_APPROVED");
    await c.db.update(clients).set({ serviceMonths: client!.serviceMonths }).where(eq(clients.id, clientId));
  });

  it("approves, then records the send through the lender's own checked way, on a day that came", async () => {
    await approveRequest(c.db, { requestId: first, actor, now });
    expect(await reason(() => approveRequest(c.db, { requestId: first, actor, now }))).toBe("STATUS");

    const [unchecked] = await contactsOf(c.db, {
      lenderId: bank,
      today: "2026-11-23",
    }).then((lines) => lines.filter((line) => line.state.problem === "STOPPED"));
    const { id: theirs } = await addContact(c.db, {
      input: {
        lenderId: company,
        kind: "email",
        value: "credit@company.example",
        person: null,
        source: "خطاب الجهة",
        checkedOn: "2026-11-20",
      },
      actor,
      now,
    });
    expect(
      await reason(() =>
        recordSent(c.db, {
          requestId: first,
          input: { contactId: unchecked!.id, sentOn: "2026-11-23" },
          actor,
          now,
        }),
      ),
    ).toBe("CONTACT");
    expect(
      await reason(() =>
        recordSent(c.db, {
          requestId: first,
          input: { contactId: theirs, sentOn: "2026-11-23" },
          actor,
          now,
        }),
      ),
    ).toBe("CONTACT");
    expect(
      await reason(() =>
        recordSent(c.db, {
          requestId: first,
          input: { contactId: checked, sentOn: "2026-11-24" },
          actor,
          now,
        }),
      ),
    ).toBe("DAY");
    await recordSent(c.db, {
      requestId: first,
      input: { contactId: checked, sentOn: "2026-11-23" },
      actor,
      now,
    });

    const view = (await requestById(c.db, { dealId, requestId: first, now }))!;
    expect(view).toMatchObject({
      status: "sent",
      sentOn: "2026-11-23",
      sentTo: {
        kind: "email",
        value: "sme@bank.example",
        person: "مسؤولة الطلبات",
      },
      approvedBy: "مدير المكتب",
      sentBy: "مدير المكتب",
      waited: 0,
      due: false,
    });
    expect(
      await reason(() =>
        closeRequest(c.db, {
          requestId: first + 1000,
          reason: null,
          actor,
          now,
        }),
      ),
    ).toBe("NOT_FOUND");
  });
});

describe("the lender's answer on a request", () => {
  it("is kept on the request with its words, paper and day, and the request is answered once both parts are", async () => {
    const at = later(3);
    const answer = (part: "mortgage" | "personal", extra: Record<string, unknown> = {}) => ({
      lenderId: bank,
      part,
      decision: "approved",
      approvedAmount: 200_000,
      asks: [],
      reason: null,
      note: null,
      onDeal: false,
      replyPaperId: null,
      requestId: first,
      on: "2026-11-25",
      replyText: "نوافق مبدئياً على الطلب بالمبلغ المذكور.",
      ...extra,
    });
    expect(
      await reason(() =>
        recordDecision(c.db, {
          dealId,
          decision: answer("personal", { on: "2026-11-22" }),
          actor,
          now: at,
        }),
      ),
    ).toBe("INVALID_INPUT");
    expect(
      await reason(() =>
        recordDecision(c.db, {
          dealId,
          decision: answer("personal", { on: "2026-11-27" }),
          actor,
          now: at,
        }),
      ),
    ).toBe("INVALID_INPUT");
    expect(
      await reason(() =>
        recordDecision(c.db, {
          dealId,
          decision: answer("personal", { lenderId: company }),
          actor,
          now: at,
        }),
      ),
    ).toBe("INVALID_INPUT");

    const { code } = await addPaper(c.db, {
      clientId,
      label: "رد الجهة المكتوب",
      actor,
      now: at,
    });
    const { paperId } = await c.db.transaction((tx) =>
      keepFile(tx, {
        clientId,
        code,
        name: "رد.pdf",
        bytes: new TextEncoder().encode("%PDF-1.4\n%%EOF\n"),
        actor,
        now: at,
      }),
    );
    await recordDecision(c.db, {
      dealId,
      decision: answer("personal", { replyPaperId: paperId }),
      actor,
      now: at,
    });
    expect(await status(first)).toBe("sent");
    expect(
      await reason(() =>
        recordDecision(c.db, {
          dealId,
          decision: answer("personal"),
          actor,
          now: at,
        }),
      ),
    ).toBe("INVALID_INPUT");

    await recordDecision(c.db, {
      dealId,
      decision: answer("mortgage", { approvedAmount: 600_000 }),
      actor,
      now: at,
    });
    expect(await status(first)).toBe("answered");
    const view = (await requestById(c.db, {
      dealId,
      requestId: first,
      now: at,
    }))!;
    expect(view.answers).toMatchObject([
      {
        part: "personal",
        decision: "approved",
        amount: 200_000,
        on: "2026-11-25",
        written: true,
        replyText: "نوافق مبدئياً على الطلب بالمبلغ المذكور.",
      },
      { part: "mortgage", amount: 600_000, written: false },
    ]);
    // The answer is dated the day the lender gave it, not the day it was typed in.
    expect((await lenderReplies(c.db, clientId))[0]).toMatchObject({
      on: "2026-11-25",
    });
    expect(
      await reason(() =>
        recordDecision(c.db, {
          dealId,
          decision: answer("mortgage"),
          actor,
          now: at,
        }),
      ),
    ).toBe("INVALID_STAGE");
    expect(await reason(() => closeRequest(c.db, { requestId: first, reason: null, actor, now: at }))).toBe("INVALID_STAGE");
  });
});

describe("a request left unanswered", () => {
  it("shows for a follow-up once the office's wait passed, and the wait is the manager's to set", async () => {
    const { key } = await bankRoute();
    const { id } = await prepareRequest(c.db, {
      dealId,
      routeKey: key,
      lenderId: bank,
      actor,
      now,
    });
    await approveRequest(c.db, { requestId: id, actor, now });
    await recordSent(c.db, {
      requestId: id,
      input: { contactId: checked, sentOn: "2026-11-23" },
      actor,
      now,
    });

    const line = async (at: Date) => (await requestsBoard(c.db, { now: at })).list.find((r) => r.id === id)!;
    expect(await line(later(6))).toMatchObject({ waited: 6, due: false });
    expect(await line(later(7))).toMatchObject({
      waited: 7,
      due: true,
      fileNo,
      lenderName: DEMO_BANK,
    });
    expect(await reason(() => setFollowUpDays(c.db, { days: 0, actor }))).toBe("INVALID_INPUT");
    await setFollowUpDays(c.db, { days: 10, actor });
    expect(await line(later(7))).toMatchObject({ due: false });
    expect((await requestsBoard(c.db, { now: later(7) })).followUpDays).toBe(10);

    await closeRequest(c.db, {
      requestId: id,
      reason: "  الجهة طلبت التقديم من فرعها  ",
      actor,
      now: later(7),
    });
    expect(await requestById(c.db, { dealId, requestId: id, now })).toMatchObject({
      status: "closed",
      closeReason: "الجهة طلبت التقديم من فرعها",
    });
  });

  it("is not prepared, approved or sent once the client withdraws their consent for the lender", async () => {
    const { key } = await bankRoute();
    const { id } = await prepareRequest(c.db, {
      dealId,
      routeKey: key,
      lenderId: bank,
      actor,
      now,
    });
    const consents = await c.db.query.shareConsents.findMany({
      where: (row, { and: both, eq: is }) => both(is(row.clientId, clientId), is(row.lenderId, bank)),
    });
    await withdrawShareConsent(c.db, {
      clientId,
      consentId: consents[0]!.id,
      actor,
      now,
    });
    expect(await reason(() => approveRequest(c.db, { requestId: id, actor, now }))).toBe("NO_SHARING");
    await closeRequest(c.db, { requestId: id, reason: null, actor, now });
    expect(
      await reason(() =>
        prepareRequest(c.db, {
          dealId,
          routeKey: key,
          lenderId: bank,
          actor,
          now,
        }),
      ),
    ).toBe("NO_SHARING");
    const actions = (await c.db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, clientId))).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(["client.share_consent", "client.share_withdraw"]));
  });
});
