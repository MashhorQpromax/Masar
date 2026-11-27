import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { STRUCTURE, VERDICT } from "@/copy/deal";
import { dayFull, dayOfIso, timeText } from "@/copy/format";
import { netWhy, NET_DEFICIT, NET_TOTAL } from "@/copy/net";
import { PLAN_STATE, REPORT_INTERNAL, REPORT_SAY } from "@/copy/opportunity";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { getDeal } from "@/server/deals/service";
import { reportById } from "@/server/opportunities/service";
import { Certain } from "@/ui/Certain";
import { BackIcon } from "@/ui/icons";
import { Num } from "@/ui/Num";
import { OpportunityCard } from "@/ui/OpportunityCard";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "تقرير الفرص · مسار" };

/** A saved study of a deal's opportunities, exactly as it was made on its day. Printed, it is the PDF. */
export default async function ReportPage({ params }: { params: Promise<{ id: string; reportId: string }> }) {
  await requireActor();
  const { id, reportId } = await params;
  const dealId = Number(id);
  const reportNo = Number(reportId);
  if (!Number.isInteger(dealId) || dealId <= 0 || !Number.isInteger(reportNo) || reportNo <= 0) notFound();
  const db = await getDb();
  const report = await reportById(db, { dealId, reportId: reportNo });
  const view = report ? await getDeal(db, { dealId }) : null;
  if (!report || !view) notFound();
  const { body } = report;
  const { client } = view;
  const short = body.asIs.net.net < 0;

  return (
    <div className="report">
      <div className="head report-head">
        <div>
          <Link className="back" href={`/deals/${dealId}/opportunities`}>
            <BackIcon />
            دراسة الفرص
          </Link>
          <h1 className="title">تقرير الفرص</h1>
        </div>
        <div className="head-side">
          <PrintButton />
        </div>
      </div>

      <section className="tile report-cover">
        <dl className="report-meta">
          <div>
            <dt>العميل</dt>
            <dd>
              <b>{client.fullName}</b> · <span className="num">{client.fileNo}</span>
            </dd>
          </div>
          <div>
            <dt>التاريخ</dt>
            <dd>
              {dayOfIso(body.day)} · {timeText(report.at)}
            </dd>
          </div>
          <div>
            <dt>أعدّه</dt>
            <dd>{report.by ?? "حساب أُغلق"}</dd>
          </div>
          <div>
            <dt>الهيكل</dt>
            <dd>{STRUCTURE[body.structure]}</dd>
          </div>
        </dl>
        <div className="report-asis">
          <p className="label">الصفقة كما هي</p>
          <p>
            {VERDICT[body.asIs.verdict]} · التمويل <Num value={body.asIs.financing} /> · {short ? NET_DEFICIT : NET_TOTAL} <Num value={Math.abs(body.asIs.net.net)} /> ريال{" "}
            <Certain value={body.asIs.net.certainty} />
          </p>
          <p className="report-why">{netWhy(body.asIs.net)}</p>
          <p className="report-why">{PLAN_STATE[body.plan]}.</p>
        </div>
        <p className="report-note">
          {REPORT_SAY} {REPORT_INTERNAL} حُفظ في {dayFull(report.at)}.
        </p>
      </section>

      <section className="opp-list report-cards" aria-label="الفرص مرتبة">
        {body.cards.map((card, index) => (
          <OpportunityCard key={card.key} card={card} rank={index + 1} open plan={card.chosen ? PLAN_STATE[body.plan] : null} />
        ))}
      </section>
    </div>
  );
}
