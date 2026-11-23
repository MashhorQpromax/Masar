import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import {
  alternativeText,
  FLOW_PART,
  LEDGER_SECTION,
  ledgerText,
  NEXT_STEP,
  riskText,
  STAGE,
  STATION,
  STRUCTURE,
  VERDICT,
} from "@/copy/deal";
import { GRADE } from "@/copy/credit";
import { missingText } from "@/copy/documents";
import { differenceText } from "@/copy/editor";
import { feeText, planLine, planState, termsText } from "@/copy/fees";
import { deductionText, lineSource, NET_DEFICIT, NET_PART, NET_TOTAL, netWhy } from "@/copy/net";
import { counted, days, dayShort, dueIn, ltr, money, percent, plainMoney } from "@/copy/format";
import {
  clientNet,
  dealAlternatives,
  dealTimeline,
  fundsFlow,
  NET_INCOME,
  policyTerms,
  readTerms,
  recordDifferences,
  stagesFor,
  stationTimeline,
  type LedgerSection,
  type Risk,
  type Stage,
} from "@/domain/deal";
import { can } from "@/domain/auth";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { borrowerOf } from "@/server/deals/mapping";
import { planApprovalsOf, planOf } from "@/server/deals/plan";
import { getDeal } from "@/server/deals/service";
import { feePolicy } from "@/server/settings/fees";
import { fundingOf } from "@/server/funding/service";
import { papersOf } from "@/server/documents/service";
import { Certain } from "@/ui/Certain";
import { BackIcon, ChevronIcon, PenIcon } from "@/ui/icons";
import { Num } from "@/ui/Num";
import { SubmitButton } from "@/ui/SubmitButton";
import { reportOffer } from "../report-offer";
import { moveDealStage } from "./actions";
import { ApprovePlan } from "./ApprovePlan";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ملف الصفقة · مسار" };

const DAY = 24 * 60 * 60 * 1000;
const NOTES = { one: "ملاحظة واحدة", two: "ملاحظتان", few: "ملاحظات", many: "ملاحظة" };
const LEVEL_ORDER: Record<Risk["level"], number> = { block: 0, warn: 1, info: 2 };
const TONE_ORDER = { good: 0, maybe: 1, no: 2 };
const SECTIONS: LedgerSection[] = ["personal", "mortgage", "dues", "result"];
const VISIBLE_NOTES = 3;

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireActor();
  const mayEdit = can(me.role, "deal.edit");
  const maySeeCredit = can(me.role, "client.view_pii");
  const dealId = Number((await params).id);
  if (!Number.isInteger(dealId) || dealId <= 0) notFound();

  const now = new Date();
  const db = await getDb();
  const view = await getDeal(db, { dealId, now });
  if (!view) notFound();
  const { deal, client, input, study, history, credit } = view;
  const papers = await papersOf(db, view);

  const ended = deal.stage === "closed" || deal.stage === "lost";
  const timeline = dealTimeline(deal.structure, deal.stage, view.stageEnteredAt, now);
  const stations = stationTimeline(deal.structure, timeline, history);
  const flow = fundsFlow(study);
  // What the client keeps, line by line, each with whether a written word stands behind it.
  const net = clientNet(input, study);
  const deduction = deductionText(net.deduction);
  const closes = study.verdict === "go" || study.verdict === "tight";
  const alternatives =
    study.verdict === "short"
      ? dealAlternatives(input, borrowerOf(client, now), view.creditFlags).sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone])
      : [];
  const bestWay = alternatives.find((a) => a.tone === "good") ?? alternatives.find((a) => a.tone === "maybe");

  // The fee plan is held against the deal as it stands: an approval stands only while its numbers print the same.
  const mayApprovePlan = can(me.role, "fee.approve");
  // The print includes the terms of the lenders whose route the deal holds: a change to one of them drops the approval.
  const funding = await fundingOf(db, view, now);
  const current = planOf(input, study, funding.routes.find((route) => route.key === funding.chosen) ?? null);
  const planLog = await planApprovalsOf(db, { dealId: deal.id, now: current });
  const planSaid = planState({ latest: planLog[0] ?? null, closing: closes, may: mayApprovePlan });
  // The terms the fee is owed on: the ones kept with a standing approval, else the policy's, which an approval now would keep.
  const feeTerms = planSaid.state === "stands" ? readTerms(planLog[0]?.plan.terms) : policyTerms(await feePolicy(db));

  const plan: Stage[] = stagesFor(deal.structure)
    .map((s) => s.stage)
    .filter((s) => s !== "lost");
  const at = plan.indexOf(deal.stage);
  const nextStage = at >= 0 ? plan[at + 1] : undefined;
  const previousStage = at > 0 ? plan[at - 1] : undefined;
  const step = NEXT_STEP[deal.stage];

  const startedAt = history[0]?.at ?? deal.createdAt;
  const elapsed = Math.max(1, Math.floor((now.getTime() - startedAt.getTime()) / DAY) + 1);
  const share = Math.min(100, Math.round((elapsed / Math.max(1, study.days)) * 1000) / 10);

  // A court order or default the deal holds at another amount than the credit report stands beside the risks,
  // for those who may read the report: the capital rests on these amounts.
  const differences = maySeeCredit && credit ? recordDifferences(reportOffer(credit.report).drafts, input.items) : [];
  // They come right after what blocks, ahead of the other warnings: what the office pays is in question.
  const notes: { key: string; level: Risk["level"]; text: string }[] = [
    ...differences.map((difference) => ({
      key: `record-${difference.item}`,
      level: "warn" as const,
      text: differenceText({ label: input.items[difference.item]!.label, deal: difference.deal, record: difference.record }),
    })),
    ...study.risks.map((risk) => ({ key: risk.code, level: risk.level, text: riskText(risk) })),
  ].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  const flowTotal = flow.total + flow.deficit;

  return (
    <>
      <div className="head">
        <div>
          <Link className="back" href="/">
            <BackIcon />
            الطريق
          </Link>
          <h1 className="title">{client.fullName}</h1>
        </div>
        <div className="head-side">
          <p className="where">
            <Link className="where-file num" href={`/clients/${client.id}`} title="ملف العميل">
              {client.fileNo}
            </Link>{" "}
            · <b>{STAGE[deal.stage]}</b>
            {!ended && stations.position > 0 && (
              <>
                {" "}
                · المحطة {ltr(stations.position)} من {ltr(stations.total)}
              </>
            )}{" "}
            · {STRUCTURE[deal.structure]}
          </p>
          {maySeeCredit && (
            <Link className="edit-link" data-soft href={`/clients/${client.id}/credit`}>
              {credit && <i className="grade-dot" data-grade={credit.analysis.grade} aria-hidden="true" />}
              {credit ? `سمة: ${GRADE[credit.analysis.grade].title}` : "ارفع تقرير سمة"}
            </Link>
          )}
          <Link className="edit-link" data-soft href={`/deals/${deal.id}/documents`}>
            {papers.missing > 0 ? missingText(papers.missing) : "المستندات مكتملة"}
          </Link>
          <Link className="edit-link" data-soft href={`/deals/${deal.id}/lenders`}>
            جهات التمويل
          </Link>
          <Link className="edit-link" data-soft href={`/deals/${deal.id}/opportunities`}>
            دراسة الفرص
          </Link>
          <Link className="edit-link" data-soft href={`/deals/${deal.id}/requests`}>
            طلبات الجهات
          </Link>
          {!ended && (
            <Link className="edit-link" data-soft href={`/deals/${deal.id}/compare`}>
              قارن سيناريو
            </Link>
          )}
          {maySeeCredit && (
            <Link className="edit-link" data-soft href={`/deals/${deal.id}/messages`}>
              الرسائل
            </Link>
          )}
          {!ended && mayEdit && (
            <Link className="edit-link" href={`/deals/${deal.id}/edit`}>
              <PenIcon size={16} />
              عدّل الأرقام
            </Link>
          )}
        </div>
      </div>

      <div className="bento">
        <section className="tile tile--verdict" data-verdict={study.verdict}>
          <svg className="verdict-art" viewBox="0 0 260 130" fill="none" aria-hidden="true">
            <path d="M250 92C212 92 200 40 162 40S112 92 74 92" stroke="#1d4468" strokeWidth="16" strokeLinecap="round" />
            <path className="road-dash" d="M250 92C212 92 200 40 162 40S112 92 74 92" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
            <circle className="road-ring" cx="56" cy="92" r="18" stroke="#ffc233" strokeWidth="2" />
            <circle cx="56" cy="92" r="18" fill="#ffc233" />
          </svg>
          <div className="verdict-text">
            <p className="label">الحكم</p>
            <h2 className="verdict-say">{VERDICT[study.verdict]}</h2>
            {closes && (
              <p className="verdict-keep">
                <span>يبقى للعميل</span> <b className="num">{plainMoney(study.clientNet)}</b> <span>ريال</span> <Certain value={net.certainty} />
              </p>
            )}
            {study.verdict === "short" && study.clientNet < 0 && (
              <p className="verdict-keep">
                <span>العجز</span> <b className="num">{plainMoney(-study.clientNet)}</b> <span>ريال</span>
              </p>
            )}
          </div>
          <ol className="steps" aria-label="محطات الصفقة">
            {stations.steps.map((s) => (
              <li key={s.key} data-state={s.state} aria-current={s.state === "current" ? "step" : undefined}>
                {STATION[s.key]}
                <small>
                  {s.state === "current" ? "الآن" : s.at ? (s.expected ? `متوقع ${dayShort(s.at)}` : dayShort(s.at)) : ""}
                </small>
              </li>
            ))}
          </ol>
        </section>

        {ended ? (
          <section className="tile tile--next" data-quiet="true">
            <div>
              <p className="label">الحالة</p>
              <h2>{deal.stage === "closed" ? "اكتملت الصفقة" : "أُغلق الملف بلا صفقة"}</h2>
            </div>
            <div className="actions">
              <Link className="btn btn--soft" href={`/clients/${client.id}`}>
                ملف العميل
              </Link>
            </div>
          </section>
        ) : study.verdict === "short" || study.verdict === "needs_info" ? (
          <section className="tile tile--next" data-quiet="true">
            <div>
              <p className="label">{study.verdict === "short" ? "أقرب حل" : "ينقص الملف"}</p>
              {study.verdict === "needs_info" ? (
                <>
                  <h2>قيمة العقار</h2>
                  <p className="due">اطلب تقييماً معتمداً. هو سعر البيع للبنك وأساس كل الحساب.</p>
                </>
              ) : bestWay ? (
                <>
                  <h2>{alternativeText(bestWay).title}</h2>
                  <p className="due">{alternativeText(bestWay).detail}</p>
                </>
              ) : (
                <>
                  <h2>لا حل بهذه الأرقام</h2>
                  <p className="due">الصفقة التي لا تُغلق لا تُعرض على العميل.</p>
                </>
              )}
            </div>
            {study.verdict === "short" && mayEdit && (
              <div className="actions">
                <Link className="btn btn--soft" href={`/clients/${client.id}`}>
                  قرار الملف
                </Link>
              </div>
            )}
          </section>
        ) : (
          <section className="tile tile--next">
            <div>
              <p className="label">الخطوة التالية</p>
              <h2>{step?.title}</h2>
              {timeline.stageDueInDays != null && <p className="due">{dueIn(timeline.stageDueInDays)}</p>}
            </div>
            <div className="actions">
              {mayEdit && nextStage && (
                <form action={moveDealStage}>
                  <input type="hidden" name="dealId" value={deal.id} />
                  <input type="hidden" name="stage" value={nextStage} />
                  <SubmitButton className="btn btn--navy">{step?.done}</SubmitButton>
                </form>
              )}
              {mayEdit && previousStage && (
                <form action={moveDealStage}>
                  <input type="hidden" name="dealId" value={deal.id} />
                  <input type="hidden" name="stage" value={previousStage} />
                  <SubmitButton className="btn btn--ghost">تراجع خطوة</SubmitButton>
                </form>
              )}
            </div>
          </section>
        )}

        <section className="tile tile--fee">
          <p className="label">أتعابنا</p>
          <p className="big">
            <Num value={study.fee} />
          </p>
          {study.roi != null ? (
            <p className="tag">
              {closes ? "عائد" : "لو أُغلقت: عائد"} {percent(study.roi)} في {days(study.days)}
            </p>
          ) : (
            <span />
          )}
        </section>

        <section className="tile tile--days">
          <p className="label">
            اليوم {ltr(elapsed)} من {ltr(study.days)}
          </p>
          <div className="dial" role="img" aria-label={`مضى ${days(elapsed)} من ${ltr(study.days)}`}>
            <svg viewBox="0 0 100 100" fill="none">
              <circle cx="50" cy="50" r="42" stroke="#eef0f3" strokeWidth="10" />
              <circle
                className="dial-arc"
                cx="50"
                cy="50"
                r="42"
                pathLength={100}
                stroke={elapsed > study.days ? "#ff5a3c" : "#0f2a43"}
                strokeWidth="10"
                strokeLinecap="round"
                style={{ "--share": share } as CSSProperties}
              />
            </svg>
            <b className="num">{elapsed}</b>
          </div>
        </section>

        <section className="tile tile--flow">
          <div className="flow-head">
            <p className="label">أين يذهب التمويل</p>
            <span className="flow-total">
              التمويل الجديد <Num value={flow.total} />
            </span>
          </div>
          <div
            className="flow-bar"
            role="img"
            aria-label={`توزيع التمويل الجديد: ${flow.parts.map((p) => `${FLOW_PART[p.key]} ${money(p.amount)}`).join("، ")}${
              flow.deficit ? `، والعجز ${money(flow.deficit)}` : ""
            }`}
          >
            {flow.parts.map((p) => (
              <span key={p.key} data-part={p.key} style={{ flex: Math.max(p.amount, flowTotal * 0.012) }} />
            ))}
            {flow.deficit > 0 && <span data-part="deficit" style={{ flex: Math.max(flow.deficit, flowTotal * 0.012) }} />}
          </div>
          <div className="flow-legend">
            {flow.parts.map((p) => (
              <div key={p.key}>
                <small>
                  <i className="swatch" data-part={p.key} />
                  {FLOW_PART[p.key]}
                </small>
                <b>
                  <Num value={p.amount} />
                </b>
              </div>
            ))}
            {flow.deficit > 0 && (
              <div>
                <small>
                  <i className="swatch" data-part="deficit" />
                  عجز لا يغطيه التمويل
                </small>
                <b className="text-coral-ink">
                  <Num value={flow.deficit} />
                </b>
              </div>
            )}
          </div>
        </section>

        <section className="tile tile--notes">
          <p className="label">{notes.length ? counted(notes.length, NOTES) : "لا ملاحظات"}</p>
          {notes.slice(0, VISIBLE_NOTES).map((note) => (
            <p key={note.key} className="note" data-level={note.level}>
              {note.text}
            </p>
          ))}
          {notes.length > VISIBLE_NOTES && (
            <details className="more">
              <summary>اعرض الباقي ({ltr(notes.length - VISIBLE_NOTES)})</summary>
              <div>
                {notes.slice(VISIBLE_NOTES).map((note) => (
                  <p key={note.key} className="note" data-level={note.level}>
                    {note.text}
                  </p>
                ))}
              </div>
            </details>
          )}
        </section>

        {alternatives.length > 0 && (
          <section className="tile tile--wide">
            <p className="label">الحلول الممكنة</p>
            <div className="ways">
              {alternatives.map((alt) => {
                const { title, detail } = alternativeText(alt);
                return (
                  <div key={alt.code + title} className="way" data-tone={alt.tone}>
                    <b>{title}</b>
                    <p>{detail}</p>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {study.verdict !== "needs_info" && (
          <section className="tile tile--wide net" data-certainty={net.certainty}>
            <p className="label net-head">صافي العميل</p>
            <div className="net-lines">
              {net.lines.map((line) => (
                <p key={line.part} className="net-line" data-in={NET_INCOME.has(line.part)}>
                  <span>
                    {NET_PART[line.part]}
                    <small>{lineSource(line)}</small>
                  </span>
                  <span className="net-figure">
                    <Num value={NET_INCOME.has(line.part) ? line.amount : -line.amount} />
                    <Certain value={line.certainty} />
                  </span>
                </p>
              ))}
            </div>
            <div className="net-sum" data-deficit={net.net < 0}>
              <p className="label">{net.net < 0 ? NET_DEFICIT : NET_TOTAL}</p>
              <p className="net-big">
                <Num value={Math.abs(net.net)} /> <span>ريال</span> <Certain value={net.certainty} />
              </p>
              <p className="net-why">{netWhy(net)}</p>
              {deduction && (
                <p className="net-deduction">
                  <span>{deduction}</span>
                  <Certain value="estimated" />
                </p>
              )}
            </div>
          </section>
        )}

        <section className="tile tile--wide an-approval" data-state={planSaid.state}>
          <div>
            <p className="label">اعتماد خطة الأتعاب</p>
            <h2>{planSaid.title}</h2>
            <p className="due">{planSaid.text}</p>
            <small className="an-why">
              {feeText(input.fee)}
              {feeTerms ? `. ${termsText(feeTerms)}.` : ""}
            </small>
          </div>
          {mayApprovePlan && !ended && closes && planSaid.state !== "stands" && <ApprovePlan key={current.print} dealId={deal.id} />}
          {/* An approved plan is what the client's final offer is written from. */}
          {planSaid.state === "stands" && !ended && closes && maySeeCredit && (
            <div className="actions">
              <Link className="btn btn--soft" href={`/deals/${deal.id}/messages?kind=offer`}>
                العرض النهائي للعميل
              </Link>
            </div>
          )}
          {planLog.length > 0 && (
            <details className="more">
              <summary>سجل اعتماد الأتعاب ({ltr(planLog.length)})</summary>
              <div>
                {planLog.map((entry) => (
                  <p key={entry.id} className="note" data-level={entry.stands ? "good" : undefined}>
                    <span>
                      {planLine(entry)}
                      <small className="an-why">{feeText(entry.plan.fee)}</small>
                    </span>
                  </p>
                ))}
              </div>
            </details>
          )}
        </section>

        <details className="tile tile--wide ledger">
          <summary>
            الحساب خطوة بخطوة
            <ChevronIcon />
          </summary>
          <div className="ledger-grid">
            {SECTIONS.filter((section) => study.ledger.some((l) => l.section === section)).map((section) => (
              <div key={section} className="ledger-section">
                <h3>{LEDGER_SECTION[section]}</h3>
                {study.ledger
                  .filter((l) => l.section === section)
                  .map((line, index) => {
                    const { label, how } = ledgerText(line);
                    return (
                      <p key={`${line.key}-${index}`} className="ledger-line" data-tone={line.tone} data-deficit={line.key === "client_net" && line.value < 0}>
                        <span>
                          {label}
                          {how && <small>{how}</small>}
                        </span>
                        <Num value={line.value} />
                      </p>
                    );
                  })}
              </div>
            ))}
          </div>
        </details>
      </div>
    </>
  );
}
