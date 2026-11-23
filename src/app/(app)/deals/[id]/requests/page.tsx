import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { STRUCTURE } from "@/copy/deal";
import { dayFull, dayOfIso, ltr, money } from "@/copy/format";
import { paperLabel } from "@/copy/documents";
import { DECISION, PART } from "@/copy/knowledge";
import { OPPORTUNITY_CLASS } from "@/copy/opportunity";
import { CONSENT_WAY, CONTACT_KIND, NAMES_NOBODY, PREPARE_REFUSAL, REQUEST_STATUS, SENDS_NOTHING, waitedSaid } from "@/copy/requests";
import { can } from "@/domain/auth";
import { dayOf } from "@/domain/eligibility";
import type { Decision } from "@/domain/knowledge";
import type { Opportunity, Part } from "@/domain/opportunity";
import { consentFor, prepareRefusal } from "@/domain/request";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { listLenders, replyPapers } from "@/server/knowledge/service";
import { whoOf } from "@/server/documents/service";
import { contactsOf, requestPlaces, type RequestView } from "@/server/requests/service";
import { BackIcon } from "@/ui/icons";
import { DecisionForm } from "../lenders/DecisionForm";
import { ApproveButton, CloseForm, ConsentForm, CopyMessage, PrepareButton, SendForm, WithdrawButton } from "./forms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "طلبات الجهات · مسار" };

const partsSaid = (parts: readonly Part[]): string => parts.map((part) => `التمويل ${PART[part]}`).join(" و");

/** Each lender the deal could go to, once, on the best opportunity it funds a part of. */
function lendersOf(list: readonly Opportunity[]): {
  lenderId: number;
  name: string;
  opportunity: Opportunity;
  rank: number;
  parts: Part[];
}[] {
  const seen = new Map<
    number,
    {
      lenderId: number;
      name: string;
      opportunity: Opportunity;
      rank: number;
      parts: Part[];
    }
  >();
  list.forEach((opportunity, index) => {
    for (const part of ["mortgage", "personal"] as const) {
      const leg = opportunity.route[part];
      if (!leg) continue;
      const lenderId = Number(leg.product.lenderId);
      const known = seen.get(lenderId);
      if (!known)
        seen.set(lenderId, {
          lenderId,
          name: leg.product.lenderName,
          opportunity,
          rank: index + 1,
          parts: [part],
        });
      else if (known.opportunity === opportunity) known.parts.push(part);
    }
  });
  return [...seen.values()];
}

function Road({ request }: { request: RequestView }) {
  const steps = [
    {
      key: "prepared",
      done: true,
      title: "جُهّز",
      say: [dayFull(request.preparedAt), request.preparedBy].filter(Boolean).join(" · "),
    },
    {
      key: "approved",
      done: request.approvedAt != null,
      title: "اعتُمد",
      say: request.approvedAt ? [dayFull(request.approvedAt), request.approvedBy].filter(Boolean).join(" · ") : "بانتظار المدير",
    },
    {
      key: "sent",
      done: request.sentOn != null,
      title: "أُرسل",
      say: request.sentOn ? [dayOfIso(request.sentOn), request.sentTo && `${CONTACT_KIND[request.sentTo.kind]} ${ltr(request.sentTo.value)}`].filter(Boolean).join(" · ") : "لم يُرسل",
    },
    {
      key: "answered",
      done: request.answeredAt != null,
      title: "ردّت الجهة",
      say: request.answeredAt ? dayFull(request.answeredAt) : request.sentOn ? waitedSaid(request.waited ?? 0) : "",
    },
  ];
  return (
    <ol className="req-road">
      {steps.map((step) => (
        <li key={step.key} data-done={step.done || undefined}>
          <b>{step.title}</b>
          {step.say && <small>{step.say}</small>}
        </li>
      ))}
    </ol>
  );
}

/**
 * The deal's requests to lenders: what has to stand before one is prepared, each lender the deal could
 * go to, the client's consent lender by lender, and each request on its road from prepared to answered.
 * Nothing here sends: a person sends the approved message and records it.
 */
export default async function RequestsPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireActor();
  const dealId = Number((await params).id);
  if (!Number.isInteger(dealId) || dealId <= 0) notFound();
  const db = await getDb();
  const now = new Date();
  const today = dayOf(now);
  let places: Awaited<ReturnType<typeof requestPlaces>>;
  try {
    places = await requestPlaces(db, { dealId, now });
  } catch {
    notFound();
  }
  const { view, study, analysis, approved, consents, requests } = places;
  const { deal, client } = view;
  const ended = study.funding.ended;
  const mayWork = can(me.role, "app.manage") && !ended;
  const mayApprove = can(me.role, "request.approve");
  const mayConsent = can(me.role, "client.edit") && !ended;
  const contacts = await contactsOf(db, { today });
  const papers = (await replyPapers(db, client.id)).map((paper) => ({
    id: paper.id,
    name: paperLabel(paper, whoOf(client)),
  }));
  const allLenders = await listLenders(db);
  const reach = lendersOf(study.list);
  // The request a lender's line points at: the one still open, or else the one it answered. A closed one leaves the way open.
  const lastOf = (lenderId: number) => requests.find((r) => r.lenderId === lenderId && r.status !== "closed");
  const consented = client.consentAt != null;
  // The consent form offers first the lenders the deal could go to that have no consent yet, then the others.
  const sharing = new Set(consents.filter((c) => !c.withdrawn).map((c) => c.lenderId));
  const reachIds = reach.filter((r) => r.opportunity.class !== "not_viable").map((r) => r.lenderId);
  const consentLenders = [
    ...reachIds.map((id) => allLenders.find((l) => l.id === id)).filter((l): l is { id: number; name: string } => l != null),
    ...allLenders.filter((l) => !reachIds.includes(l.id)),
  ].filter((l) => !sharing.has(l.id));

  return (
    <>
      <div className="head">
        <div>
          <Link className="back" href={`/deals/${deal.id}`}>
            <BackIcon />
            ملف الصفقة
          </Link>
          <h1 className="title">طلبات الجهات</h1>
        </div>
        <div className="head-side">
          <p className="where">
            <span className="num">{client.fileNo}</span> · <b>{client.fullName}</b> · {STRUCTURE[deal.structure]}
          </p>
          <Link className="note-link" href={`/deals/${deal.id}/opportunities`}>
            دراسة الفرص
          </Link>
        </div>
      </div>

      <div className="bento">
        <section className="tile tile--wide req-gate">
          <p className="label">قبل أي طلب</p>
          <ul className="req-checks">
            <li data-ok={consented || undefined}>
              <b>موافقة العميل على معالجة بياناته</b>
              {consented ? (
                <small>مسجلة.</small>
              ) : (
                <small>
                  غير مسجلة.{" "}
                  <Link className="note-link" href={`/clients/${client.id}`}>
                    ملف العميل
                  </Link>
                </small>
              )}
            </li>
            <li data-ok={(approved && analysis != null) || undefined}>
              <b>تحليل العميل معتمد كما هو الآن</b>
              {approved && analysis ? (
                <small>الرسالة تُبنى من هذا الملف المعتمد.</small>
              ) : (
                <small>
                  غير معتمد، أو تغيّر الملف بعد اعتماده.{" "}
                  <Link className="note-link" href={`/clients/${client.id}/analysis`}>
                    التحليل
                  </Link>
                </small>
              )}
            </li>
          </ul>
          <p className="req-say">{SENDS_NOTHING}</p>
          <p className="req-say">{NAMES_NOBODY}</p>
        </section>

        <section className="tile tile--wide req-lenders" aria-label="الجهات">
          <p className="label">الجهات</p>
          {reach.length === 0 ? (
            <p className="req-say">لا فرص في الدراسة بعد.</p>
          ) : (
            <ol className="req-lender-list">
              {reach.map(({ lenderId, name, opportunity, rank, parts }) => {
                const last = lastOf(lenderId);
                const open = last != null && last.status !== "answered";
                const consent = consentFor(consents, lenderId);
                const viable = opportunity.class !== "not_viable";
                const refusal = prepareRefusal({
                  ended,
                  consented,
                  sharing: consent != null,
                  approved: approved && analysis != null,
                  viable,
                  open,
                });
                return (
                  <li key={lenderId} className="req-lender">
                    <span className="req-rank num">{rank}</span>
                    <span className="req-lender-name">
                      <b>{name}</b>
                      <small>{partsSaid(parts)}</small>
                    </span>
                    <span className="opp-class" data-class={opportunity.class}>
                      {OPPORTUNITY_CLASS[opportunity.class]}
                    </span>
                    {viable ? (
                      <span className="req-consent-state" data-ok={consent != null || undefined}>
                        {consent ? `وافق العميل ${CONSENT_WAY[consent.way]}` : "لم يوافق العميل بعد"}
                      </span>
                    ) : (
                      <span />
                    )}
                    <span className="req-lender-act">
                      {last ? (
                        <a className="note-link" href={`#r${last.id}`}>
                          {last.due ? "تحتاج متابعة" : REQUEST_STATUS[last.status]}
                        </a>
                      ) : !viable ? null : refusal === "NO_SHARING" ? (
                        mayConsent && (
                          <a className="note-link" href="#consent">
                            سجّل موافقته
                          </a>
                        )
                      ) : refusal ? (
                        <small className="req-why">{PREPARE_REFUSAL[refusal]}</small>
                      ) : (
                        mayWork && <PrepareButton dealId={deal.id} routeKey={opportunity.key} lenderId={lenderId} />
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="tile tile--wide req-consents" id="consent">
          <p className="label">موافقة العميل على مشاركة بياناته</p>
          <p className="req-say">لكل جهة موافقة. بلاها لا يُجهَّز لها طلب ولا يُرسل.</p>
          {consents.length > 0 && (
            <ul className="req-consent-list">
              {consents.map((consent) => (
                <li key={consent.id} data-withdrawn={consent.withdrawn || undefined}>
                  <span>
                    <b>{consent.lenderName}</b>
                    <small>{[`${CONSENT_WAY[consent.way]} في ${dayOfIso(consent.givenOn)}`, consent.note, consent.by, consent.withdrawn && "سُحبت"].filter(Boolean).join(" · ")}</small>
                  </span>
                  {mayConsent && !consent.withdrawn && <WithdrawButton dealId={deal.id} clientId={client.id} consentId={consent.id} lender={consent.lenderName} />}
                </li>
              ))}
            </ul>
          )}
          {mayConsent && consented && consentLenders.length > 0 && <ConsentForm dealId={deal.id} clientId={client.id} lenders={consentLenders} today={today} />}
        </section>

        <section className="tile tile--wide req-list" aria-label="الطلبات">
          <p className="label">الطلبات</p>
          {requests.length === 0 ? (
            <p className="req-say">لم يُجهَّز طلب لهذه الصفقة بعد.</p>
          ) : (
            requests.map((request) => {
              const usable = contacts.filter((c) => c.lenderId === request.lenderId && c.state.usable);
              const parts = Object.fromEntries(request.asked.map((leg) => [leg.part, { lenderId: request.lenderId, amount: leg.amount }]));
              return (
                <article key={request.id} id={`r${request.id}`} className="req" data-status={request.status} data-due={request.due || undefined}>
                  <header className="req-head">
                    <h2>
                      {request.lenderName}
                      <small>{partsSaid(request.parts)}</small>
                    </h2>
                    <span className="req-status" data-status={request.status}>
                      {request.due ? `${REQUEST_STATUS.sent} · تحتاج متابعة` : REQUEST_STATUS[request.status]}
                    </span>
                  </header>
                  <Road request={request} />
                  <div className="req-message">
                    <pre>{request.message}</pre>
                    {(request.status === "approved" || request.status === "sent") && <CopyMessage text={request.message} />}
                  </div>

                  {request.answers.length > 0 && (
                    <ul className="req-answers">
                      {request.answers.map((answer, index) => (
                        <li key={index}>
                          <b>
                            التمويل {PART[answer.part]}: {DECISION[answer.decision as Decision]}
                            {answer.amount != null && <> · {money(answer.amount)} ريال</>}
                          </b>
                          <small>{[dayOfIso(answer.on), answer.written ? "رد مكتوب مرفق" : "بلا رد مكتوب"].join(" · ")}</small>
                          {answer.replyText && <q>{answer.replyText}</q>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {request.status === "closed" && <p className="req-say">{request.closeReason ? `أُغلق: ${request.closeReason}` : "أُغلق."}</p>}

                  {request.status === "draft" && (mayApprove ? <ApproveButton dealId={deal.id} requestId={request.id} /> : <p className="req-say">يعتمده المدير قبل أن يُرسل.</p>)}
                  {request.status === "approved" &&
                    mayWork &&
                    (usable.length > 0 ? (
                      <SendForm
                        dealId={deal.id}
                        requestId={request.id}
                        contacts={usable.map((c) => ({
                          id: c.id,
                          label: `${CONTACT_KIND[c.kind]}: ${c.value}${c.person ? ` (${c.person})` : ""}`,
                        }))}
                        today={today}
                      />
                    ) : (
                      <p className="said" data-bad>
                        لا وسيلة تواصل لهذه الجهة لها مصدر وتحقق ساري.{" "}
                        <Link className="note-link" href="/lenders/contacts">
                          وسائل التواصل
                        </Link>
                      </p>
                    ))}
                  {request.status === "sent" && mayWork && (
                    <details className="ruling-new">
                      <summary>سجّل رد الجهة</summary>
                      <DecisionForm
                        dealId={deal.id}
                        lenders={[{ id: request.lenderId, name: request.lenderName }]}
                        parts={parts}
                        mayAmend={can(me.role, "deal.edit")}
                        papers={papers}
                        request={{
                          id: request.id,
                          lenderId: request.lenderId,
                          parts: request.parts.filter((part) => !request.answers.some((a) => a.part === part)),
                          sentOn: request.sentOn,
                          today,
                        }}
                      />
                    </details>
                  )}
                  {mayWork && (request.status === "draft" || request.status === "approved" || request.status === "sent") && <CloseForm dealId={deal.id} requestId={request.id} />}
                </article>
              );
            })
          )}
        </section>
      </div>
    </>
  );
}
