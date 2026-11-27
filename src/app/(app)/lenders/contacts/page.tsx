import type { Metadata } from "next";
import { counted, ltr } from "@/copy/format";
import { CONTACT_KIND, CONTACT_PROBLEM, contactUntil, CONTACTS_SAY } from "@/copy/requests";
import { can } from "@/domain/auth";
import { dayOf } from "@/domain/eligibility";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { listLenders } from "@/server/knowledge/service";
import { contactsOf, type ContactLine } from "@/server/requests/service";
import { LendersNav } from "../LendersNav";
import { CheckForm, ContactForm, StopButton } from "./forms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "وسائل التواصل · مسار" };

const WAYS = { one: "وسيلة", two: "وسيلتان", few: "وسائل", many: "وسيلة" };

/**
 * How the office reaches each lender. A way carries a request only with a source and a check that has
 * not run out; the others are kept, and say why they carry nothing.
 */
export default async function ContactsPage() {
  const me = await requireActor();
  const mayManage = can(me.role, "lender.manage");
  const db = await getDb();
  const today = dayOf(new Date());
  const [contacts, lenders] = await Promise.all([contactsOf(db, { today }), listLenders(db)]);
  const byLender = new Map<number, ContactLine[]>();
  for (const contact of contacts) byLender.set(contact.lenderId, [...(byLender.get(contact.lenderId) ?? []), contact]);
  const usable = contacts.filter((c) => c.state.usable).length;

  return (
    <>
      <div className="head">
        <div>
          <h1 className="title">وسائل التواصل</h1>
        </div>
        <div className="head-side">
          <p className="where">
            {contacts.length ? counted(contacts.length, WAYS) : "لا وسائل بعد"} · <b>{usable} صالحة للإرسال</b>
          </p>
          {mayManage && (
            <a className="btn btn--soft know-jump" href="#new-contact">
              أضف وسيلة
            </a>
          )}
        </div>
      </div>
      <LendersNav current="/lenders/contacts" />

      <p className="req-say contacts-say">{CONTACTS_SAY}</p>
      <div className="contacts">
        {[...byLender.entries()].map(([lenderId, lines]) => (
          <section key={lenderId} className="tile contact-lender" aria-label={lines[0]!.lenderName}>
            <h2>{lines[0]!.lenderName}</h2>
            <ul className="contact-list">
              {lines.map((line) => (
                <li key={line.id} data-usable={line.state.usable || undefined} data-stopped={!line.active || undefined}>
                  <span className="contact-what">
                    <small>{CONTACT_KIND[line.kind]}</small>
                    <b>{line.kind === "visit" ? line.value : ltr(line.value)}</b>
                    {line.person && <small>{line.person}</small>}
                  </span>
                  <span className="contact-state">
                    <b>{line.state.usable && line.state.until ? contactUntil(line.state.until) : CONTACT_PROBLEM[line.state.problem!]}</b>
                    {line.source && <small>المصدر: {line.source}</small>}
                  </span>
                  {mayManage && line.active && (
                    <span className="contact-act">
                      <CheckForm contactId={line.id} source={line.source} today={today} />
                      <StopButton contactId={line.id} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {contacts.length === 0 && <p className="req-say">لم تُسجَّل وسيلة تواصل لأي جهة بعد.</p>}
        {mayManage && lenders.length > 0 && (
          <section className="tile contact-new" id="new-contact">
            <p className="label">وسيلة جديدة</p>
            <ContactForm lenders={lenders} today={today} />
          </section>
        )}
      </div>
    </>
  );
}
