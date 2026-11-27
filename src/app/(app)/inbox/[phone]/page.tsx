import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { contactError, fileStateText, phoneText } from "@/copy/clients";
import { can } from "@/domain/auth";
import { fileState } from "@/domain/clients";
import { normalizePhone } from "@/domain/shared/phone";
import { requireActor } from "@/server/auth/actor";
import { listClients } from "@/server/clients/directory";
import { getDb } from "@/server/db/client";
import { waMessages } from "@/server/db/schema";
import { strangerOf } from "@/server/messages/inbox";
import { BackIcon, PlusIcon, SearchIcon } from "@/ui/icons";
import { SubmitButton } from "@/ui/SubmitButton";
import { ThreadBubble } from "@/ui/ThreadBubble";
import { claim, strangerHandled } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "رقم بلا ملف · مسار" };

const one = (value: string | string[] | undefined): string => (Array.isArray(value) ? value[0] : value)?.trim() ?? "";

export default async function StrangerPage({ params, searchParams }: { params: Promise<{ phone: string }>; searchParams: Promise<{ q?: string | string[]; refused?: string | string[] }> }) {
  const me = await requireActor("client.view_pii");
  const mayEdit = can(me.role, "client.edit");
  const mayOpen = can(me.role, "client.create");
  const phone = normalizePhone((await params).phone);
  if (!phone) notFound();

  const db = await getDb();
  const stranger = await strangerOf(db, phone);
  if (!stranger) {
    // The number may have been given to a client since the link was made: their conversation is with their deal.
    const [theirs] = await db.select({ clientId: waMessages.clientId }).from(waMessages).where(eq(waMessages.phone, phone)).limit(1);
    if (theirs?.clientId) redirect(`/clients/${theirs.clientId}`);
    notFound();
  }

  const query = await searchParams;
  const q = one(query.q).slice(0, 80);
  const refused = one(query.refused);
  const found = q ? (await listClients(db, { q, byPhone: true, limit: 5 })).rows : [];
  const now = new Date();
  const name = stranger.waName ?? "رقم بلا ملف";
  const said = stranger.waName ?? "صاحب الرقم";

  return (
    <>
      <div className="head">
        <div>
          <Link className="back" href="/inbox">
            <BackIcon />
            الوارد
          </Link>
          <h1 className="title">{name}</h1>
        </div>
        <div className="head-side">
          <p className="where">
            <span className="num">{phoneText(stranger.phone)}</span> · <b>بلا ملف</b>
            {stranger.waName && <> · الاسم كما كتبه في واتساب</>}
          </p>
        </div>
      </div>

      <div className="bento">
        <section className="tile tile--talk">
          <p className="label">ما كتبه لرقم الشركة</p>
          <ol className="thread">
            {stranger.thread.map((message) => (
              <ThreadBubble key={message.id} message={message} from={said} now={now} />
            ))}
          </ol>
        </section>

        <section className="tile tile--next tile--who">
          <div>
            <p className="label">الخطوة التالية</p>
            <h2>افتح له ملفاً</h2>
            <p className="due">يبدأ الملف برقمه واسمه، وتنضم إليه رسائله. الرد عليه يكون من ملفه.</p>
          </div>
          <div className="actions">
            {mayOpen && (
              <Link className="btn btn--navy" href={`/deals/new?phone=${stranger.phone}${stranger.waName ? `&name=${encodeURIComponent(stranger.waName)}` : ""}`}>
                <PlusIcon />
                افتح ملفاً
              </Link>
            )}
            {mayEdit && stranger.waiting && (
              <form action={strangerHandled}>
                <input type="hidden" name="phone" value={stranger.phone} />
                <SubmitButton className="btn btn--ghost">لا يحتاج رداً</SubmitButton>
              </form>
            )}
          </div>
        </section>

        {mayEdit && (
          <section className="tile tile--known">
            <p className="label">عميل عندنا بالفعل؟</p>
            <p className="known-say">ابحث عن ملفه. يصير هذا الرقم جواله، وتنضم الرسائل إلى محادثته.</p>
            <form className="search search--tile" action={`/inbox/${stranger.phone}`} role="search">
              <SearchIcon />
              <input name="q" defaultValue={q} placeholder="اسم العميل أو رقم ملفه" aria-label="ابحث عن العميل" autoComplete="off" enterKeyHint="search" maxLength={80} />
              <button type="submit">ابحث</button>
            </form>
            {refused && (
              <p role="alert" className="said" data-bad>
                {contactError(refused)}
              </p>
            )}
            {q && found.length === 0 && <p className="known-none">لا ملف بهذا الاسم.</p>}
            {found.length > 0 && (
              <ul className="known">
                {found.map((person) => {
                  const current = normalizePhone(person.phone);
                  return (
                    <li key={person.id}>
                      <span>
                        <b>{person.name}</b>
                        <small>
                          <span className="num">{person.fileNo}</span> · {fileStateText(fileState(person.deal?.stage ?? null))} · {current ? <>جواله الآن {phoneText(current)}، يُستبدل</> : "بلا جوال مسجل"}
                        </small>
                      </span>
                      <form action={claim}>
                        <input type="hidden" name="phone" value={stranger.phone} />
                        <input type="hidden" name="clientId" value={person.id} />
                        <SubmitButton className="btn btn--soft">هذا رقمه</SubmitButton>
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>
    </>
  );
}
