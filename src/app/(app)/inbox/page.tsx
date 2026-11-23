import type { Metadata } from "next";
import Link from "next/link";
import { phoneText } from "@/copy/clients";
import { initial } from "@/copy/format";
import { agoText, excerpt, waitingText } from "@/copy/messages";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { inboxOf } from "@/server/messages/inbox";
import { whatsapp } from "@/server/messages/request";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "الوارد · مسار" };

export default async function InboxPage() {
  // What clients wrote, and their numbers: only who may see a client's details reads it.
  const me = await requireActor("client.view_pii");
  const now = new Date();
  const talks = await inboxOf(await getDb());
  const waiting = talks.filter((talk) => talk.waiting).length;
  const connected = me.demo || whatsapp() !== null;

  return (
    <>
      <div className="head">
        <div>
          <h1 className="title">الوارد</h1>
          <p className="lede">{talks.length ? waitingText(waiting) : "لا رسائل بعد."}</p>
        </div>
      </div>

      {!connected && (
        <p className="inbox-off">
          رقم الشركة لم يُربط بواتساب بعد، فلا يصل هنا ما يكتبه العملاء. يظهر الآن ما سجّله الفريق من رسائل أرسلها من جواله.
        </p>
      )}

      {talks.length === 0 ? (
        <div className="empty empty--inbox">
          <svg viewBox="0 0 220 110" fill="none" aria-hidden="true">
            <path d="M24 80c40 0 46-44 86-44s46 44 86 44" stroke="#dfe4ea" strokeWidth="14" strokeLinecap="round" />
            <path className="road-dash" d="M24 80c40 0 46-44 86-44s46 44 86 44" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="6 10" />
            <rect x="82" y="14" width="56" height="38" rx="14" fill="#0f2a43" />
            <path d="M98 52l-6 12 16-12" fill="#0f2a43" />
            <circle cx="99" cy="33" r="3" fill="#ffc233" />
            <circle cx="110" cy="33" r="3" fill="#fff" />
            <circle cx="121" cy="33" r="3" fill="#fff" />
          </svg>
          <p className="text-body">ما يكتبه العملاء لرقم الشركة، وما نرسله لهم، يجتمع هنا.</p>
        </div>
      ) : (
        <div className="rows">
          {talks.map((talk, index) => {
            const stranger = talk.client == null;
            const name = talk.client?.name ?? talk.waName ?? phoneText(talk.phone);
            const href = talk.client ? (talk.client.dealId ? `/deals/${talk.client.dealId}/messages` : `/clients/${talk.client.id}`) : `/inbox/${talk.phone}`;
            return (
              <Link key={talk.client ? `c${talk.client.id}` : talk.phone} className="row row--talk" data-waiting={talk.waiting || undefined} href={href} style={{ animationDelay: `${Math.min(index, 12) * 0.05}s` }}>
                <span className="row-who" data-tone={stranger ? "hot" : undefined}>
                  <span className="avatar" aria-hidden="true">
                    {stranger ? "؟" : initial(name)}
                  </span>
                  <span>
                    <b>{name}</b>
                    {talk.client ? <small className="num">{talk.client.fileNo}</small> : <small>رقم بلا ملف{talk.waName ? <> · {phoneText(talk.phone)}</> : null}</small>}
                  </span>
                </span>
                <span className="talk-last" data-out={talk.last.direction === "out" || undefined}>
                  {talk.last.direction === "out" && <i>أنت: </i>}
                  {excerpt(talk.last)}
                </span>
                <span className="talk-when">
                  {talk.waiting && <b>ينتظر ردك</b>}
                  <small>{agoText(talk.last.at, now)}</small>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
