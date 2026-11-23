import "server-only";
import { desc, eq } from "drizzle-orm";
import { addMonths, dayOf } from "@/domain/eligibility";
import type { Db } from "../db/client";
import { clients, deals, lenderContacts, lenderRequests, lenders, users } from "../db/schema";
import { addContact, approveRequest, prepareRequest, recordSent, recordShareConsent, requestPlaces } from "../requests/service";
import type { Actor } from "../shared/actor";
import { DEMO_BANK, DEMO_COMPANY, DEMO_REPLIED } from "./lenders";

/** What names a made-up way of reaching a lender, so nobody reads it as the lender's own. */
export const DEMO_CONTACT_SOURCE = "مصدر تجريبي للعرض فقط";

/**
 * Ways of reaching the two example lenders, and only them: a real lender's address is never invented.
 * Each shows one state: one checked and in use, one whose check ran out, a portal checked and in use,
 * and a number nobody said where it came from. The addresses are on example domains and the numbers
 * are made up. Does nothing when any way is already there.
 */
export async function seedDemoContacts(db: Db, now: Date): Promise<void> {
  const [known] = await db.select({ id: lenderContacts.id }).from(lenderContacts).limit(1);
  if (known) return;
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).orderBy(users.id).limit(1);
  const actor: Actor = { userId: admin?.id ?? null };
  const lenderOf = new Map((await db.select({ id: lenders.id, name: lenders.name }).from(lenders)).map((l) => [l.name, l.id]));
  const bank = lenderOf.get(DEMO_BANK);
  const company = lenderOf.get(DEMO_COMPANY);
  const today = dayOf(now);
  const ago = (days: number) => dayOf(new Date(now.getTime() - days * 86_400_000));
  if (bank) {
    await addContact(db, {
      input: {
        lenderId: bank,
        kind: "email",
        value: "financing@bank.example",
        person: "قسم التمويل الشخصي",
        source: DEMO_CONTACT_SOURCE,
        checkedOn: ago(20),
      },
      actor,
      now,
    });
    const { id } = await addContact(db, {
      input: {
        lenderId: bank,
        kind: "whatsapp",
        value: "0500000090",
        person: null,
        source: DEMO_CONTACT_SOURCE,
        checkedOn: ago(20),
      },
      actor,
      now,
    });
    // The service refuses a check that old, so the row is written as it would stand had time passed.
    await db
      .update(lenderContacts)
      .set({ checkedOn: addMonths(today, -8) })
      .where(eq(lenderContacts.id, id));
  }
  if (company) {
    await addContact(db, {
      input: {
        lenderId: company,
        kind: "portal",
        value: "https://portal.example/requests",
        person: null,
        source: DEMO_CONTACT_SOURCE,
        checkedOn: ago(40),
      },
      actor,
      now,
    });
    await addContact(db, {
      input: {
        lenderId: company,
        kind: "phone",
        value: "0110000090",
        person: "مدير العلاقة",
        source: null,
        checkedOn: null,
      },
      actor,
      now,
    });
  }
}

/**
 * One request on its whole road, for the invented client whose file stands approved: her consent to
 * sharing with the example bank, the request prepared from her approved file, approved, and sent by
 * e-mail. The bank's answer is written on it after, with the replies. Nothing is sent: the demonstration
 * records a sending, as a person would. Does nothing when any request is already there.
 */
export async function seedDemoRequests(db: Db, now: Date): Promise<void> {
  const [known] = await db.select({ id: lenderRequests.id }).from(lenderRequests).limit(1);
  if (known) return;
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).orderBy(users.id).limit(1);
  const actor: Actor = { userId: admin?.id ?? null };
  const [bank] = await db.select({ id: lenders.id }).from(lenders).where(eq(lenders.name, DEMO_BANK));
  const [deal] = await db
    .select({ dealId: deals.id, clientId: clients.id })
    .from(deals)
    .innerJoin(clients, eq(clients.id, deals.clientId))
    .where(eq(clients.fileNo, DEMO_REPLIED))
    .orderBy(desc(deals.id))
    .limit(1);
  if (!bank || !deal) return;
  const places = await requestPlaces(db, { dealId: deal.dealId, now });
  if (!places.approved) return;
  const route = places.study.list.find((o) => [o.route.mortgage, o.route.personal].every((leg) => !leg || Number(leg.product.lenderId) === bank.id));
  const [email] = await db.select({ id: lenderContacts.id }).from(lenderContacts).where(eq(lenderContacts.lenderId, bank.id)).orderBy(lenderContacts.id).limit(1);
  if (!route || !email) return;
  await recordShareConsent(db, {
    clientId: deal.clientId,
    input: {
      lenderId: bank.id,
      way: "written",
      note: "نموذج موافقة تجريبي للعرض فقط",
      givenOn: dayOf(now),
    },
    actor,
    now,
  });
  const { id } = await prepareRequest(db, {
    dealId: deal.dealId,
    routeKey: route.key,
    lenderId: bank.id,
    actor,
    now,
  });
  await approveRequest(db, { requestId: id, actor, now });
  await recordSent(db, {
    requestId: id,
    input: { contactId: email.id, sentOn: dayOf(now) },
    actor,
    now,
  });
}
