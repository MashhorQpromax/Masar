import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { owedBrief, paperLabel } from "@/copy/documents";
import { counted, ltr } from "@/copy/format";
import { PAPERS_CLOSE_GAPS, projectLine, REJECTED_PROJECT, REJECTED_PROJECT_SAY } from "@/copy/project";
import { can } from "@/domain/auth";
import type { Paper } from "@/domain/documents";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { getProjectPapers } from "@/server/projects/papers";
import { BackIcon } from "@/ui/icons";
import { PapersList, Sheets } from "../../../../_papers/PapersList";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "مستندات المشروع · مسار" };

const VISIBLE_OWED = 4;

/**
 * The papers of a project's file against what a lender asks of a project. A paper that is checked
 * and stands as good answers its gap in the study, so the study stops asking for it.
 */
export default async function ProjectPapersPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireActor();
  const clientId = Number((await params).id);
  if (!Number.isInteger(clientId) || clientId <= 0) notFound();
  const view = await getProjectPapers(await getDb(), clientId);
  if (!view) notFound();

  const { client, who, facts, list, rejected } = view;
  const mayUpload = can(me.role, "doc.upload") && !rejected;
  const mayVerify = can(me.role, "doc.verify") && !rejected;
  const mayOpen = can(me.role, "client.view_pii");

  const name = (paper: Paper) => paperLabel(paper, who, "project");
  const required = list.papers.filter((paper) => paper.required);
  const owed = required.filter((paper) => paper.status === "missing" || paper.status === "rejected");
  const waiting = list.papers.filter((paper) => paper.status === "received");
  const arrived = list.required - list.missing;

  return (
    <>
      <div className="head">
        <div>
          <Link className="back" href={`/clients/${client.id}/project`}>
            <BackIcon />
            دراسة المشروع
          </Link>
          <h1 className="title">مستندات المشروع</h1>
        </div>
        <div className="head-side">
          <p className="where">
            <span className="num">{client.fileNo}</span> · <b>{client.fullName}</b>
            {projectLine(facts) ? ` · ${projectLine(facts)}` : ""}
          </p>
        </div>
      </div>

      <div className="bento">
        <section className="tile tile--verdict" data-verdict={list.missing ? "short" : "go"}>
          <div className="verdict-text">
            <p className="label">ملف المشروع</p>
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

        {rejected ? (
          <section className="tile tile--next" data-quiet="true">
            <div>
              <p className="label">الحالة</p>
              <h2>{REJECTED_PROJECT}</h2>
              <p className="due">{REJECTED_PROJECT_SAY}</p>
            </div>
          </section>
        ) : owed.length > 0 ? (
          <section className="tile tile--next">
            <div>
              <p className="label">الخطوة التالية</p>
              <h2>اطلب الناقص من المالك</h2>
              <p className="due">{owedBrief(owed.map(name))}</p>
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
          <p className="label">{owed.length ? "ما ينقص" : waiting.length ? "ينتظر المراجعة" : "لا شيء ناقص"}</p>
          {(owed.length ? owed : waiting).slice(0, VISIBLE_OWED).map((paper) => (
            <p key={paper.code} className="note" data-level={paper.status === "received" ? "warn" : "block"}>
              <span>
                {name(paper)}
                {paper.status === "rejected" && paper.note ? `، يُعاد: ${paper.note}` : ""}
              </span>
            </p>
          ))}
          {owed.length > VISIBLE_OWED && (
            <p className="note">
              <span>و{counted(owed.length - VISIBLE_OWED, { one: "مستند آخر", two: "مستندان آخران", few: "مستندات أخرى", many: "مستنداً آخر" })} في القائمة.</span>
            </p>
          )}
          <p className="note" data-level="good">
            <span>{PAPERS_CLOSE_GAPS}</span>
          </p>
        </section>

        <PapersList home={`p${client.id}`} clientId={client.id} list={list} who={who} file="project" may={{ upload: mayUpload, verify: mayVerify, open: mayOpen }} />
      </div>
    </>
  );
}
