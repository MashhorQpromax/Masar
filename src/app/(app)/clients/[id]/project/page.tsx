import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { amountParts, counted, dayOf, dayOfRecord, ltr, millions, percent, plainMoney, type CountForms } from "@/copy/format";
import {
  ALERT_LEVEL,
  alertDetail,
  alertExit,
  alertTitle,
  BORROWER_TYPE,
  DEED_FACT,
  FIT,
  GAP_STANDING,
  gapLabel,
  gapWhy,
  HELD_SAY,
  incomeSteps,
  PROJECT_TYPE,
  PROJECT_VERDICT,
  projectLine,
  PURPOSE_FACT,
  ratioLines,
  reachSay,
  REJECTED_PROJECT,
  REJECTED_PROJECT_SAY,
  structureAsk,
  structureHow,
  structureNeeds,
  structureTitle,
  verdictSay,
} from "@/copy/project";
import { can } from "@/domain/auth";
import { gapStanding } from "@/domain/documents";
import { CASH_LTV_LIMIT, MIN_DSCR, WEAK_LTV, type AlertLevel, type Fit, type GapCode } from "@/domain/project";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { getProjectPapers } from "@/server/projects/papers";
import { getProject } from "@/server/projects/service";
import { BackIcon, CheckIcon, ChevronIcon, PenIcon } from "@/ui/icons";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "دراسة المشروع · مسار" };

const LEVELS: AlertLevel[] = ["block", "warn", "info"];
const FITS: Fit[] = ["high", "medium", "low"];
const ALERTS: CountForms = { one: "أمر واحد", two: "أمران", few: "أمور", many: "أمراً" };
const BASICS: CountForms = { one: "واحد أساسي", two: "اثنان أساسيان", few: "أساسية", many: "أساسياً" };

const PATH = "M250 92C212 92 200 40 162 40S112 92 74 92";

/** The road with what the money is for at its end: a building going up, the sun behind it. */
function SiteArt() {
  return (
    <svg className="verdict-art site" viewBox="0 0 260 130" fill="none" aria-hidden="true">
      <path d={PATH} stroke="#1d4468" strokeWidth="16" strokeLinecap="round" />
      <path className="road-dash" d={PATH} stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="30" cy="50" r="17" fill="#ffc233" />
      <g className="site-rise">
        <rect x="26" y="44" width="26" height="66" rx="5" fill="#fff" />
        <path d="M34 56h3M41 56h3M34 67h3M41 67h3M34 78h3M41 78h3M34 89h3M41 89h3" stroke="#0f2a43" strokeWidth="3.4" strokeLinecap="round" />
      </g>
      <g className="site-rise" data-late>
        <rect x="56" y="70" width="20" height="40" rx="5" fill="#b7c4d1" />
        <path d="M63 81h6M63 91h6" stroke="#0f2a43" strokeWidth="3.4" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** A figure with its unit set small beside it. */
function Amount({ value }: { value: number }) {
  const { figure, unit } = amountParts(value);
  return (
    <>
      <b className="num">{figure}</b> <small>{unit}</small>
    </>
  );
}

/**
 * The study of a project that asks for finance against its land and its income: whether it can be
 * financed as asked, what stands in the way, the ways to finance it, and what its file still needs.
 */
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireActor();
  const clientId = Number((await params).id);
  if (!Number.isInteger(clientId) || clientId <= 0) notFound();
  const db = await getDb();
  const view = await getProject(db, clientId);
  if (!view) notFound();
  const { client, facts, requested, study, rejected } = view;
  // A rejected file is read as it stood. It is reopened before anything in it changes.
  const mayEdit = can(me.role, "client.edit") && !rejected;
  const papers = (await getProjectPapers(db, clientId))?.list.papers ?? [];
  // Where the papers of a gap stand, for the gaps that are answered by papers: arrived and waiting, or sent back.
  const standing = (code: GapCode) => {
    const state = gapStanding(code, facts, papers);
    return state === "received" || state === "rejected" ? state : null;
  };
  const papersHref = `/clients/${client.id}/project/papers`;
  const now = new Date();

  const ask = amountParts(requested);
  const ratios = ratioLines(facts, study);
  const alerts = [...study.alerts].sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level));
  const ways = [...study.structures].sort((a, b) => FITS.indexOf(a.fit) - FITS.indexOf(b.fit));
  const basics = study.gaps.filter((gap) => gap.critical);
  const helps = study.gaps.filter((gap) => !gap.critical);
  const income = incomeSteps(facts, study);
  const editHref = `/clients/${client.id}/project/edit`;

  const known = [
    { label: "المالك", value: [client.fullName, facts.borrowerType && BORROWER_TYPE[facts.borrowerType]].filter(Boolean).join("، ") },
    (facts.city || facts.district) && { label: "الموقع", value: [facts.district, facts.city].filter(Boolean).join("، ") },
    facts.projectType && { label: "نوع المشروع", value: PROJECT_TYPE[facts.projectType] },
    facts.purpose && { label: "الغرض", value: PURPOSE_FACT[facts.purpose] },
    facts.landArea && { label: "مساحة الأرض", value: `${ltr(plainMoney(facts.landArea))} م²` },
    study.pricePerM2 != null && { label: "سعر المتر", value: ltr(plainMoney(study.pricePerM2)) },
    facts.deed && { label: "الصك", value: DEED_FACT[facts.deed] },
    (facts.valuer || facts.valuationDate) && { label: "التقييم", value: [facts.valuer, facts.valuationDate && dayOfRecord(facts.valuationDate.replaceAll("-", "/"))].filter(Boolean).join("، ") },
    facts.gfa && { label: "مسطحات البناء", value: `${ltr(plainMoney(facts.gfa))} م²` },
    facts.keys && { label: "الغرف", value: ltr(plainMoney(facts.keys)) },
    facts.adr && { label: "سعر الليلة", value: ltr(plainMoney(facts.adr)) },
    facts.occupancy && { label: "الإشغال", value: percent(facts.occupancy) },
    facts.equityCash && { label: "سيولة المالك", value: millions(facts.equityCash) },
    { label: "رخصة البناء", value: facts.hasPermit ? "موجودة" : "لم تصدر" },
    { label: "دراسة الجدوى", value: facts.hasFeasibility ? "موجودة" : "لم تُعد" },
    facts.existingLien && { label: "الرهن", value: "عليها رهن قائم" },
    facts.nearHaram && { label: "المنطقة", value: "المركزية قرب الحرم" },
  ].filter((fact): fact is { label: string; value: string } => !!fact);

  return (
    <>
      <div className="head">
        <div>
          <Link className="back" href={`/clients/${client.id}`}>
            <BackIcon />
            {client.fullName}
          </Link>
          <h1 className="title">{projectLine(facts) || "دراسة مشروع"}</h1>
        </div>
        <div className="head-side">
          <p className="where">
            <span className="num">{client.fileNo}</span> · <b>{rejected ? "مشروع مرفوض" : "دراسة مشروع"}</b> · آخر تعديل {dayOf(client.updatedAt, now)}
          </p>
          <Link className="edit-link" data-soft href={papersHref}>
            المستندات
          </Link>
          {mayEdit && (
            <Link className="edit-link" href={editHref}>
              <PenIcon size={16} />
              عدّل
            </Link>
          )}
        </div>
      </div>

      <div className="bento pj">
        {rejected && (
          <section className="tile pj-rejected" role="status">
            <div>
              <p className="label">{REJECTED_PROJECT}</p>
              <p>{REJECTED_PROJECT_SAY}</p>
            </div>
            <Link className="btn btn--soft" href={`/clients/${client.id}`}>
              ملف المالك
            </Link>
          </section>
        )}
        <section className="tile tile--verdict pj-verdict" data-verdict={study.verdict}>
          <SiteArt />
          <div className="verdict-text">
            <p className="label">ما تقوله الدراسة</p>
            <h2 className="verdict-say">{PROJECT_VERDICT[study.verdict]}</h2>
            <p className="file-say">{verdictSay(study)}</p>
          </div>

          <div className="pj-ask">
            <p className="verdict-keep">
              <span>المطلوب</span>
              <b className="num">{requested > 0 ? ask.figure : "-"}</b>
              {requested > 0 && <span>{ask.unit}</span>}
            </p>
            {study.ltv != null && requested > 0 && (
              <div className="reach" data-over={study.ltv > WEAK_LTV || undefined}>
                <p className="reach-head">
                  <span>من قيمة الأرض</span>
                  <b className="num">{percent(study.ltv)}</b>
                </p>
                <div className="reach-track" role="img" aria-label={`المطلوب ${percent(study.ltv)} من قيمة الأرض`}>
                  <i className="reach-fill" style={{ inlineSize: `${Math.min(100, study.ltv)}%` }} />
                  <i className="reach-mark" style={{ insetInlineStart: `${CASH_LTV_LIMIT}%` }} />
                  <i className="reach-mark" style={{ insetInlineStart: `${WEAK_LTV}%` }} />
                </div>
                {/* The marks are placed from the line's start. A number reads left to right, so it sits inside the mark's label and does not turn it around. */}
                <p className="reach-scale" aria-hidden="true">
                  <span style={{ insetInlineStart: `${CASH_LTV_LIMIT}%` }}>{percent(CASH_LTV_LIMIT)}</span>
                  <span style={{ insetInlineStart: `${WEAK_LTV}%` }}>{percent(WEAK_LTV)}</span>
                </p>
                <p className="reach-say">{reachSay(study.ltv)}</p>
              </div>
            )}
          </div>

          {(facts.landValue || facts.constructionCost) && (
            <dl className="pj-figures">
              {facts.landValue && (
                <div>
                  <dt>قيمة الأرض</dt>
                  <dd>
                    <Amount value={facts.landValue} />
                  </dd>
                </div>
              )}
              {facts.constructionCost && (
                <div>
                  <dt>تكلفة البناء</dt>
                  <dd>
                    <Amount value={facts.constructionCost} />
                  </dd>
                </div>
              )}
              {study.totalCost != null && (
                <div>
                  <dt>تكلفة المشروع</dt>
                  <dd>
                    <Amount value={study.totalCost} />
                  </dd>
                </div>
              )}
            </dl>
          )}
        </section>

        <div className="pj-side">
          <section className="tile pj-ratios">
            <p className="label">ما تنظر إليه الجهة أولاً</p>
            {ratios.length > 0 ? (
              <ul className="pj-ratio-list">
                {ratios.map((ratio) => (
                  <li key={ratio.key}>
                    <span>
                      {ratio.label}
                      <small>{ratio.from}</small>
                    </span>
                    <b className="num">{percent(ratio.value)}</b>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pj-none">تظهر النسب حين تُكتب قيمة الأرض والمبلغ المطلوب.</p>
            )}
          </section>

          {income.length > 0 && (
            <section className="tile pj-income" data-low={study.dscr != null && study.dscr < MIN_DSCR ? true : undefined}>
              <p className="label">دخل الفندق خطوة بخطوة</p>
              <ol className="pj-steps">
                {income.map((step) => (
                  <li key={step.label}>
                    <span>
                      {step.label}
                      <small>{step.how}</small>
                    </span>
                    <b>{step.value}</b>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        <section className="tile tile--notes pj-alerts">
          <p className="label">{alerts.length ? `${counted(alerts.length, ALERTS)} في الطريق` : "الطريق"}</p>
          {alerts.length > 0 ? (
            <div>
              {alerts.map((alert, index) => (
                <details key={alert.code} className="cond" open={index === 0}>
                  <summary>
                    <span className="note" data-level={alert.level}>
                      <span>
                        {alertTitle(alert)}
                        {alert.level !== "info" && <small>{ALERT_LEVEL[alert.level]}</small>}
                      </span>
                    </span>
                    <ChevronIcon />
                  </summary>
                  <div className="cond-more">
                    <p>{alertDetail(alert)}</p>
                    <p>
                      <b>ما العمل:</b> {alertExit(alert)}
                    </p>
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <p className="pj-none">لا شيء في بيانات المشروع يوقف الجهة.</p>
          )}
        </section>

        <section className="tile pj-ways">
          <p className="label">طرق تمويله</p>
          <div>
            {ways.map((way) => (
              <details key={way.id} className="lift">
                <summary>
                  <span className="lift-what">
                    <b>{structureTitle(way.id)}</b>
                    <small data-fit={way.fit}>{FIT[way.fit]}</small>
                  </span>
                  <span className="lift-gain">
                    {way.amount != null && (
                      <>
                        <b>{millions(way.amount)}</b>
                        <small>تقدير أولي</small>
                      </>
                    )}
                  </span>
                  <ChevronIcon />
                </summary>
                <div className="lift-more">
                  <p>{structureHow(way.id)}</p>
                  <ul className="pj-needs" aria-label="ما يحتاجه">
                    {structureNeeds(way.id).map((need) => (
                      <li key={need}>{need}</li>
                    ))}
                  </ul>
                  <p className="pj-askwho">
                    <b>من يُسأل:</b> {structureAsk(way.id).join("، ")}
                  </p>
                </div>
              </details>
            ))}
          </div>
        </section>

        <section className="tile pj-gaps">
          <div className="facts-head">
            <p className="label">{study.gaps.length ? "ما ينقص الملف" : "لا شيء ينقص الملف"}</p>
            {basics.length > 0 && <p className="pj-count">{counted(basics.length, BASICS)}</p>}
          </div>
          {basics.length > 0 && (
            <ul className="pj-gap-list" aria-label="أساسي قبل الحكم">
              {basics.map((gap) => (
                <li key={gap.code} data-critical>
                  {gapLabel(gap.code)}
                  <small>{gapWhy(gap.code)}</small>
                  {standing(gap.code) && <small data-paper={standing(gap.code)}>{GAP_STANDING[standing(gap.code)!]}</small>}
                </li>
              ))}
            </ul>
          )}
          {helps.length > 0 && (
            <>
              <p className="pj-sub">يقوّي الملف</p>
              <ul className="pj-gap-list" aria-label="يقوّي الملف">
                {helps.map((gap) => (
                  <li key={gap.code}>
                    {gapLabel(gap.code)}
                    <small>{gapWhy(gap.code)}</small>
                    {standing(gap.code) && <small data-paper={standing(gap.code)}>{GAP_STANDING[standing(gap.code)!]}</small>}
                  </li>
                ))}
              </ul>
            </>
          )}
          {view.held.length > 0 && (
            <>
              <p className="pj-sub">{HELD_SAY}</p>
              <ul className="pj-gap-list pj-held" aria-label={HELD_SAY}>
                {view.held.map((code) => (
                  <li key={code}>
                    <CheckIcon size={16} />
                    {gapLabel(code)}
                  </li>
                ))}
              </ul>
            </>
          )}
          <Link className="note-link" href={papersHref}>
            افتح المستندات
          </Link>
        </section>

        <section className="tile pj-facts">
          <div className="facts-head">
            <p className="label">ما نعرفه عن المشروع</p>
            {mayEdit && (
              <Link className="edit-link" data-soft href={editHref}>
                <PenIcon size={15} />
                عدّل
              </Link>
            )}
          </div>
          <dl className="facts">
            {known.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </>
  );
}
