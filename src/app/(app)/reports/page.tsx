import type { Metadata } from "next";
import Link from "next/link";
import { endedLine, feesText, lenderLine, MONTH_NOTE, monthTitle, requestsText } from "@/copy/report";
import { dayOf } from "@/domain/eligibility";
import { isMonth, shiftMonth } from "@/domain/report";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { monthView } from "@/server/reports/service";
import { BackIcon } from "@/ui/icons";
import { Num } from "@/ui/Num";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "تقرير الشهر · مسار" };

/**
 * The office's month on one page, for the manager: what came in, what closed with its fees as counted
 * and as collected, what fell through, and what the lenders answered. It is read from what the system holds and
 * changes nothing. The months run from the first deal's to this one.
 */
export default async function MonthPage({ searchParams }: { searchParams: Promise<{ m?: string | string[] }> }) {
  // It names clients and their fees, and every employee's month: the manager's, as the audit log is.
  await requireActor("audit.view");
  const now = new Date();
  const asked = [(await searchParams).m].flat()[0];
  const today = dayOf(now).slice(0, 7);
  const view = await monthView(await getDb(), { month: isMonth(asked) && asked <= today ? asked : today, now });
  const current = view.month === view.thisMonth;
  const earlier = view.month > view.first ? shiftMonth(view.month, -1) : null;
  const later = view.month < view.thisMonth ? shiftMonth(view.month, 1) : null;
  const ended = [...view.closed.map((deal) => ({ deal, closed: true })), ...view.lost.map((deal) => ({ deal, closed: false }))];

  return (
    <>
      <div className="head">
        <div>
          <Link className="back" href="/account">
            <BackIcon />
            حسابي
          </Link>
          <h1 className="title">تقرير الشهر</h1>
        </div>
        <nav className="month-nav" aria-label="الشهر">
          {earlier ? (
            <Link className="month-step" href={`/reports?m=${earlier}`} aria-label={`الشهر السابق، ${monthTitle(earlier)}`}>
              <BackIcon />
            </Link>
          ) : (
            <span className="month-step" aria-hidden="true" data-off />
          )}
          <b className="month-name">{monthTitle(view.month)}</b>
          {later ? (
            <Link className="month-step" data-next href={`/reports?m=${later}`} aria-label={`الشهر التالي، ${monthTitle(later)}`}>
              <BackIcon />
            </Link>
          ) : (
            <span className="month-step" data-next aria-hidden="true" data-off />
          )}
        </nav>
      </div>

      <div className="month">
        <section className="tile month-figure">
          <p className="label">صفقات جديدة</p>
          <p className="month-big num">{view.opened}</p>
        </section>
        <section className="tile month-figure" data-tone={view.closed.length > 0 ? "good" : undefined}>
          <p className="label">أُغلقت</p>
          <p className="month-big num">{view.closed.length}</p>
          {view.closed.length > 0 && <p className="month-small">{feesText(view)}</p>}
        </section>
        <section className="tile month-figure">
          <p className="label">أُلغيت</p>
          <p className="month-big num">{view.lost.length}</p>
        </section>
        <section className="tile month-figure">
          <p className="label">مدة الصفقة</p>
          {view.closedDays != null ? (
            <>
              <p className="month-big num">{view.closedDays}</p>
              <p className="month-small">يوماً في المتوسط، من فتحها إلى إغلاقها</p>
            </>
          ) : (
            <p className="month-small">لم تُغلق صفقة هذا الشهر.</p>
          )}
        </section>

        <section className="tile month-list">
          <p className="label">ما أُغلق وما أُلغي</p>
          {ended.length ? (
            <ul className="board-list">
              {ended.map(({ deal, closed }) => (
                <li key={deal.dealId} className="board-line" data-lost={!closed || undefined}>
                  <Link href={`/deals/${deal.dealId}`}>
                    <span className="board-who">
                      <span className="num">{deal.fileNo}</span>
                      <b>{deal.clientName}</b>
                    </span>
                    <small className="board-say month-when">{endedLine(deal, closed)}</small>
                    <span className="month-fee">{closed && deal.fee != null ? <Num value={deal.fee} /> : null}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="board-none">لم تُغلق صفقة ولم تُلغَ هذا الشهر.</p>
          )}
        </section>

        <section className="tile month-list">
          <p className="label">ردود الجهات</p>
          {view.lenders.length ? (
            <ul className="month-lenders">
              {view.lenders.map((line) => (
                <li key={line.lenderId}>
                  <b>{line.lender}</b>
                  <span>{lenderLine(line)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="board-none">لم تُسجَّل ردود من الجهات هذا الشهر.</p>
          )}
          <p className="month-requests">
            {requestsText(view.requests, current)}{" "}
            {current && (
              <Link className="month-link" href="/lenders/requests">
                الطلبات
              </Link>
            )}
          </p>
        </section>

        <p className="month-note">{MONTH_NOTE}</p>
      </div>
    </>
  );
}
