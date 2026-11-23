import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { STAGE } from "@/copy/deal";
import { BY_OFFICE, conflictText, owedBrief, paperLabel, sourcePaper } from "@/copy/documents";
import { counted, ltr } from "@/copy/format";
import { can } from "@/domain/auth";
import type { Paper } from "@/domain/documents";
import { clientReachable, messageGate } from "@/domain/messages";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { getPapers } from "@/server/documents/service";
import { BackIcon } from "@/ui/icons";
import { RelyOn } from "../../../_papers/PaperFigures";
import { PapersList, Sheets } from "../../../_papers/PapersList";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "المستندات · مسار" };

const VISIBLE_OWED = 4;
export default async function DocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireActor();
  const dealId = Number((await params).id);
  if (!Number.isInteger(dealId) || dealId <= 0) notFound();
  const view = await getPapers(await getDb(), { dealId });
  if (!view) notFound();

  const { deal, client, who, list, ended } = view;
  const mayUpload = can(me.role, "doc.upload") && !ended;
  const mayVerify = can(me.role, "doc.verify") && !ended;
  const mayOpen = can(me.role, "client.view_pii");
  // The file takes a paper's figure by the word of someone who may judge papers and may change the file.
  const mayRely = mayVerify && can(me.role, "client.edit");
  const conflicts = view.facts.filter((reading) => reading.state === "conflict");
  const disputedPapers = new Set(conflicts.flatMap((reading) => reading.stated.map((statement) => statement.paperId)));

  const home = `d${deal.id}`;
  const name = (paper: Paper) => paperLabel(paper, who);
  const required = list.papers.filter((paper) => paper.required);
  const owed = required.filter((paper) => paper.status === "missing" || paper.status === "rejected");
  const arrived = list.required - list.missing;
  // The client is asked for what is theirs to bring. What the office brings itself is the office's next step.
  const fromClient = owed.filter((paper) => paper.by === "client");
  const fromOffice = owed.filter((paper) => paper.by === "office");
  // A client the office does not write to is not asked for anything either.
  const mayAsk = mayUpload && clientReachable(messageGate({ stage: deal.stage, verdict: view.verdict }));

  return (
    <>
      <div className="head">
        <div>
          <Link className="back" href={`/deals/${deal.id}`}>
            <BackIcon />
            ملف الصفقة
          </Link>
          <h1 className="title">المستندات</h1>
        </div>
        <div className="head-side">
          <p className="where">
            <span className="num">{client.fileNo}</span> · <b>{client.fullName}</b> · {STAGE[deal.stage]}
          </p>
        </div>
      </div>

      <div className="bento">
        <section className="tile tile--verdict" data-verdict={list.missing ? "short" : "go"}>
          <div className="verdict-text">
            <p className="label">ملف العميل</p>
            <h2 className="verdict-say">{list.missing ? "ينقصه" : "مكتمل"}</h2>
            <p className="verdict-keep">
              <b className="num">{list.missing || arrived}</b> <span>من {ltr(list.required)}</span>
            </p>
          </div>
          <Sheets states={required.map((paper) => paper.status)} />
          <dl className="route-figures">
            <div>
              <dt>المطلوب</dt>
              <dd className="num">{list.required}</dd>
            </div>
            <div>
              <dt>وصل</dt>
              <dd className="num">{arrived}</dd>
            </div>
            <div>
              <dt>تحققنا منه</dt>
              <dd className="num">{list.verified}</dd>
            </div>
          </dl>
        </section>

        {ended ? (
          <section className="tile tile--next" data-quiet="true">
            <div>
              <p className="label">الحالة</p>
              <h2>الصفقة انتهت</h2>
              <p className="due">المستندات محفوظة للاطلاع.</p>
            </div>
          </section>
        ) : fromClient.length > 0 ? (
          <section className="tile tile--next">
            <div>
              <p className="label">الخطوة التالية</p>
              <h2>اطلب الناقص من العميل</h2>
              <p className="due">{owedBrief(fromClient.map(name))}</p>
            </div>
            {mayAsk && (
              <div className="actions">
                <Link className="btn btn--navy" href={`/deals/${deal.id}/messages?kind=papers`}>
                  اطلبها من العميل
                </Link>
              </div>
            )}
          </section>
        ) : fromOffice.length > 0 ? (
          <section className="tile tile--next">
            <div>
              <p className="label">الخطوة التالية</p>
              <h2>أكمل أوراق الصفقة</h2>
              <p className="due">{owedBrief(fromOffice.map(name))}</p>
            </div>
          </section>
        ) : list.toCheck > 0 ? (
          <section className="tile tile--next" data-quiet="true">
            <div>
              <p className="label">الخطوة التالية</p>
              <h2>راجع ما وصل</h2>
              <p className="due">كل المطلوب وصل. افتح كل مستند وقل إنه سليم أو أعده.</p>
            </div>
          </section>
        ) : (
          <section className="tile tile--next" data-quiet="true">
            <div>
              <p className="label">الحالة</p>
              <h2>الملف جاهز</h2>
              <p className="due">كل المطلوب وصل وتحققنا منه.</p>
            </div>
          </section>
        )}

        <section className="tile tile--notes tile--five">
          <p className="label">{owed.length ? "ما ينقص" : list.toCheck ? "ينتظر المراجعة" : "لا شيء ناقص"}</p>
          {(owed.length ? [...fromClient, ...fromOffice] : list.papers.filter((paper) => paper.status === "received")).slice(0, VISIBLE_OWED).map((paper) => (
            <p key={paper.code} className="note" data-level={paper.status === "received" ? "warn" : "block"}>
              <span>
                {name(paper)}
                {paper.status === "rejected" && paper.note ? `، يُعاد: ${paper.note}` : ""}
                {paper.by === "office" && paper.status !== "received" ? ` (${BY_OFFICE})` : ""}
              </span>
            </p>
          ))}
          {owed.length > VISIBLE_OWED && (
            <p className="note">
              <span>و{counted(owed.length - VISIBLE_OWED, { one: "مستند آخر", two: "مستندان آخران", few: "مستندات أخرى", many: "مستنداً آخر" })} في القائمة.</span>
            </p>
          )}
          {!owed.length && !list.toCheck && (
            <p className="note" data-level="good">
              <span>يكبر الملف مع تقدم الصفقة: كل محطة تطلب أوراقها حين تصلها.</span>
            </p>
          )}
        </section>

        {conflicts.length > 0 && (
          <section className="tile tile--wide conflicts">
            <p className="label">تعارض بين الملف والمستندات</p>
            <p className="conflicts-say">كل جهة تبقى «بحاجة إلى تحقق» حتى يُحسم: لا جواب يُعتمد على رقم مختلف عليه.</p>
            {conflicts.map((reading) => {
              const first = reading.stated[0]!;
              return (
                <div key={reading.fact} className="conflict">
                  <p className="conflict-what">{conflictText(reading)}</p>
                  <RelyOn home={home} paperId={first.paperId} fact={reading.fact} value={first.value} paper={sourcePaper(first)} papersAgree={reading.papersAgree} may={mayRely} />
                </div>
              );
            })}
          </section>
        )}

        <PapersList home={home} clientId={client.id} list={list} who={who} may={{ upload: mayUpload, verify: mayVerify, open: mayOpen }} disputed={disputedPapers} />
      </div>
    </>
  );
}
