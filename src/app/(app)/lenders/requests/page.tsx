import type { Metadata } from "next";
import Link from "next/link";
import { counted, dayFull } from "@/copy/format";
import { PART } from "@/copy/knowledge";
import { CONTACT_KIND, FOLLOW_UP_SAY, REQUEST_STATUS, waitedSaid } from "@/copy/requests";
import { can } from "@/domain/auth";
import type { RequestStatus } from "@/domain/request";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { requestsBoard, type RequestView } from "@/server/requests/service";
import { LendersNav } from "../LendersNav";
import { FollowUpForm } from "./FollowUpForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "الطلبات · مسار" };

const REQUESTS = {
  one: "طلب مفتوح",
  two: "طلبان مفتوحان",
  few: "طلبات مفتوحة",
  many: "طلباً مفتوحاً",
};
const DAYS = { one: "يوم", two: "يومين", few: "أيام", many: "يوماً" };

/** What a request's line says beside its status: when it moved last, and through which way. */
function lineSay(request: RequestView): string {
  if (request.status === "draft") return [`جُهّز ${dayFull(request.preparedAt)}`, request.preparedBy].filter(Boolean).join(" · ");
  if (request.status === "approved") return [`اعتُمد ${dayFull(request.approvedAt!)}`, request.approvedBy].filter(Boolean).join(" · ");
  if (request.status === "sent") return [waitedSaid(request.waited ?? 0), request.sentTo && CONTACT_KIND[request.sentTo.kind]].filter(Boolean).join(" · ");
  if (request.status === "answered") return request.answeredAt ? `ردّت ${dayFull(request.answeredAt)}` : "ردّت";
  return [request.closedAt && `أُغلق ${dayFull(request.closedAt)}`, request.closeReason].filter(Boolean).join(" · ");
}

function Line({ request }: { request: RequestView }) {
  return (
    <li className="board-line" data-status={request.status} data-due={request.due || undefined}>
      <Link href={`/deals/${request.dealId}/requests#r${request.id}`}>
        <span className="board-who">
          <span className="num">{request.fileNo}</span>
          <b>{request.clientName}</b>
        </span>
        <span className="board-lender">
          <b>{request.lenderName}</b>
          <small>{request.parts.map((part) => `التمويل ${PART[part]}`).join(" و")}</small>
        </span>
        <small className="board-say">{lineSay(request)}</small>
      </Link>
    </li>
  );
}

const OPEN_ORDER: RequestStatus[] = ["draft", "approved", "sent"];

/**
 * Every request the office has open with a lender, those waiting too long first, and those that ended
 * in the last month. Each line opens the request on its deal.
 */
export default async function RequestsBoardPage() {
  const me = await requireActor();
  const { list, followUpDays } = await requestsBoard(await getDb());
  const due = list.filter((r) => r.due);
  const open = OPEN_ORDER.map((status) => ({
    status,
    lines: list.filter((r) => r.status === status && !r.due),
  })).filter((group) => group.lines.length > 0);
  const ended = list.filter((r) => r.status === "answered" || r.status === "closed");
  const openCount = list.filter((r) => OPEN_ORDER.includes(r.status)).length;

  return (
    <>
      <div className="head">
        <div>
          <h1 className="title">الطلبات</h1>
        </div>
        <div className="head-side">
          <p className="where">
            {openCount ? counted(openCount, REQUESTS) : "لا طلبات مفتوحة"} · <b>{due.length ? `${due.length} تحتاج متابعة` : "لا شيء متأخر"}</b>
          </p>
        </div>
      </div>
      <LendersNav current="/lenders/requests" />

      <div className="board">
        <section className="tile board-due" data-empty={due.length === 0 || undefined}>
          <div className="board-top">
            <div>
              <p className="label">تحتاج متابعة</p>
              <p className="req-say">
                {FOLLOW_UP_SAY} المدة الآن {counted(followUpDays, DAYS)}.
              </p>
            </div>
            {can(me.role, "settings.manage") && <FollowUpForm days={followUpDays} />}
          </div>
          {due.length ? (
            <ul className="board-list">
              {due.map((request) => (
                <Line key={request.id} request={request} />
              ))}
            </ul>
          ) : (
            <p className="board-none">كل طلب أُرسل ما زال في مدته.</p>
          )}
        </section>

        {open.map((group) => (
          <section key={group.status} className="tile board-group">
            <p className="label">{REQUEST_STATUS[group.status]}</p>
            <ul className="board-list">
              {group.lines.map((request) => (
                <Line key={request.id} request={request} />
              ))}
            </ul>
          </section>
        ))}

        {ended.length > 0 && (
          <section className="tile board-group board-ended">
            <p className="label">انتهت خلال الشهر</p>
            <ul className="board-list">
              {ended.map((request) => (
                <Line key={request.id} request={request} />
              ))}
            </ul>
          </section>
        )}

        {list.length === 0 && <p className="req-say">لم يُجهَّز طلب لأي جهة بعد. الطلب يبدأ من صفحة طلبات الجهات في ملف الصفقة.</p>}
      </div>
    </>
  );
}
