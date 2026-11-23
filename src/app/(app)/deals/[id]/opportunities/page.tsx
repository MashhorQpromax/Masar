import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { STRUCTURE } from "@/copy/deal";
import { counted, dayFull } from "@/copy/format";
import { CLASS_SAY, OPPORTUNITY_CLASS, PLAN_STATE, REPORT_SAY } from "@/copy/opportunity";
import { can } from "@/domain/auth";
import { cardOf, OPPORTUNITY_CLASSES } from "@/domain/opportunity";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { getOpportunities, reportsOf } from "@/server/opportunities/service";
import { BackIcon } from "@/ui/icons";
import { OpportunityCard } from "@/ui/OpportunityCard";
import { SaveReport } from "./SaveReport";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "دراسة الفرص · مسار" };

const CARDS = { one: "فرصة واحدة", two: "فرصتان", few: "فرص", many: "فرصة" };

/**
 * Every way the catalogue can fund the deal, as a card the office can decide on: ranked by class, each
 * read from eligibility to verdict, with where each figure comes from. The deal's own plan is marked.
 */
export default async function OpportunitiesPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireActor();
  const dealId = Number((await params).id);
  if (!Number.isInteger(dealId) || dealId <= 0) notFound();
  const db = await getDb();
  const view = await getOpportunities(db, { dealId });
  if (!view) notFound();
  const { funding, list } = view;
  const { deal, client } = funding;
  const reports = await reportsOf(db, deal.id);
  const cards = list.map(cardOf);
  const counts = OPPORTUNITY_CLASSES.map((c) => ({ c, n: cards.filter((card) => card.class === c).length })).filter((x) => x.n > 0);
  const mayReport = can(me.role, "deal.edit") && cards.length > 0;

  return (
    <>
      <div className="head">
        <div>
          <Link className="back" href={`/deals/${deal.id}`}>
            <BackIcon />
            ملف الصفقة
          </Link>
          <h1 className="title">دراسة الفرص</h1>
        </div>
        <div className="head-side">
          <p className="where">
            <span className="num">{client.fileNo}</span> · <b>{client.fullName}</b> · {STRUCTURE[deal.structure]}
          </p>
          <Link className="note-link" href={`/deals/${deal.id}/lenders`}>
            جهات التمويل وقراراتها
          </Link>
        </div>
      </div>

      {cards.length === 0 ? (
        <section className="empty">
          <h2>لا فرص بعد</h2>
          <p>أضف الجهات التي تتعامل معها الشركة وشروط كل منها، فتُدرس الصفقة على كل جهة.</p>
        </section>
      ) : (
        <div className="bento">
          <section className="tile tile--wide opp-top">
            <div className="opp-count">
              <p className="label">{counted(cards.length, CARDS)}</p>
              <ul className="opp-legend">
                {counts.map(({ c, n }) => (
                  <li key={c} data-class={c}>
                    <span className="opp-class" data-class={c}>
                      {OPPORTUNITY_CLASS[c]}
                    </span>
                    <b className="num">{n}</b>
                    <small>{CLASS_SAY[c]}</small>
                  </li>
                ))}
              </ul>
            </div>
            <div className="opp-report">
              <p className="label">التقرير</p>
              <p className="opp-report-say">{REPORT_SAY}</p>
              {!view.consented ? (
                <p className="said" data-bad>
                  لا يُنشأ قبل تسجيل موافقة العميل.{" "}
                  <Link className="note-link" href={`/clients/${client.id}`}>
                    ملف العميل
                  </Link>
                </p>
              ) : (
                mayReport && !funding.ended && <SaveReport dealId={deal.id} />
              )}
              {reports.length > 0 && (
                <ol className="opp-reports">
                  {reports.slice(0, 5).map((report) => (
                    <li key={report.id}>
                      <Link href={`/deals/${deal.id}/opportunities/reports/${report.id}`}>
                        <b>{dayFull(report.at)}</b>
                        <small>{[report.by, counted(report.count, CARDS)].filter(Boolean).join(" · ")}</small>
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>

          <section className="tile tile--wide opp-list" aria-label="الفرص مرتبة">
            {cards.map((card, index) => (
              <OpportunityCard key={card.key} card={card} rank={index + 1} open={index === 0} plan={card.chosen ? PLAN_STATE[view.plan] : null} />
            ))}
          </section>
        </div>
      )}
    </>
  );
}
