import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fileStateText, NATIONALITY, NOTE_KIND, phoneText, phoneTyped, ID_LABEL } from "@/copy/clients";
import { STAGE, STATION, STRUCTURE, VERDICT } from "@/copy/deal";
import { SECTOR } from "@/copy/editor";
import { CONTRACT_TYPE } from "@/copy/eligibility";
import { amountParts, dayFull, dayOf, ltr, percent, plainMoney } from "@/copy/format";
import { agoText } from "@/copy/messages";
import { PROJECT_VERDICT, projectLine, REJECTED_PROJECT, REJECTED_PROJECT_SAY, verdictSay } from "@/copy/project";
import { can } from "@/domain/auth";
import { fileState, type ClientNationality } from "@/domain/clients";
import { SECTORS, stationsFor, type Sector } from "@/domain/deal";
import { contractOf } from "@/domain/eligibility";
import { requireActor } from "@/server/auth/actor";
import { getClientCard } from "@/server/clients/directory";
import { getDb } from "@/server/db/client";
import { getOpportunities } from "@/server/opportunities/service";
import { cardLenders, CONFIDENCE, OPPORTUNITY_CLASS, PLAN_STATE } from "@/copy/opportunity";
import { cardOf } from "@/domain/opportunity";
import { Num } from "@/ui/Num";
import { projectsOf } from "@/server/projects/service";
import { BackIcon, PenIcon, PlusIcon } from "@/ui/icons";
import { ContactForm } from "./ContactForm";
import { DecideFile } from "./DecideFile";
import { NoteForm } from "./NoteForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ملف العميل · مسار" };

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireActor();
  const maySee = can(me.role, "client.view_pii");
  const mayEdit = can(me.role, "client.edit");
  const mayDecide = can(me.role, "deal.edit");
  const clientId = Number((await params).id);
  if (!Number.isInteger(clientId) || clientId <= 0) notFound();

  const now = new Date();
  const db = await getDb();
  const card = await getClientCard(db, clientId);
  if (!card) notFound();
  const { client, deals, notes } = card;
  const deal = deals[0] ?? null;
  const state = fileState(deal?.stage ?? null);
  // A project's file is studied on its land and its income. It has no deal and no salary.
  const project = (await projectsOf(db, [client])).get(client.id) ?? null;
  const nationality: ClientNationality = client.nationality === "non_saudi" ? "non_saudi" : "saudi";
  const sector = (SECTORS as readonly string[]).includes(client.sector) ? SECTOR[client.sector as Sector] : null;
  const age = client.birthYear != null ? now.getFullYear() - client.birthYear : null;
  const service = client.serviceMonths != null ? Math.round((client.serviceMonths / 12) * 10) / 10 : null;

  // The open deal's opportunities, ranked, with the plan it holds and the state of its approval.
  const study = deal && state.kind === "open" && !project ? await getOpportunities(db, { dealId: deal.id, now }) : null;
  const opportunities = study ? study.list.map(cardOf) : [];
  const stations = deal ? stationsFor(deal.structure) : [];
  const position = state.kind === "open" ? stations.indexOf(state.station) : -1;
  const why = state.kind === "rejected" || project?.rejected ? (notes.find((note) => note.kind === "status")?.body ?? null) : null;
  const figures = deal
    ? [
        deal.capital != null && { label: "رأس المال", value: deal.capital },
        deal.fee != null && state.kind !== "rejected" && { label: "أتعابنا", value: deal.fee },
        deal.clientNet != null && (deal.clientNet >= 0 ? { label: "يبقى للعميل", value: deal.clientNet } : { label: "العجز", value: -deal.clientNet, bad: true }),
      ].filter((figure): figure is { label: string; value: number; bad?: boolean } => !!figure)
    : [];
  const facts = [
    sector && { label: "القطاع", value: sector },
    age != null && { label: "العمر", value: `${ltr(age)} سنة` },
    service != null && { label: "الخدمة", value: `${ltr(service)} سنة` },
    contractOf(client.contractType) && client.sector !== "retired" && client.sector !== "self" && { label: "نوع العقد", value: CONTRACT_TYPE[contractOf(client.contractType)!] },
    client.basicSalary != null && { label: "الراتب الأساسي", value: ltr(plainMoney(client.basicSalary)) },
    client.totalSalary != null && { label: "الراتب الإجمالي", value: ltr(plainMoney(client.totalSalary)) },
  ].filter((fact): fact is { label: string; value: string } => !!fact);

  return (
    <>
      <div className="head">
        <div>
          <Link className="back" href="/clients">
            <BackIcon />
            العملاء
          </Link>
          <h1 className="title">{client.fullName}</h1>
        </div>
        <div className="head-side">
          <p className="where">
            <span className="num">{client.fileNo}</span> · <b>{project ? (project.rejected ? "مشروع مرفوض" : "مشروع") : fileStateText(state)}</b> · فُتح ملفه {dayOf(client.createdAt, now)}
          </p>
        </div>
      </div>

      <div className="bento bento--file">
        {project ? (
          <section className="tile tile--verdict tile--file" data-state={project.rejected ? "rejected" : "project"}>
            <div>
              <p className="label">دراسة المشروع</p>
              <h2 className="compose-title">{project.rejected ? REJECTED_PROJECT : PROJECT_VERDICT[project.study.verdict]}</h2>
              <p className="file-say">{project.rejected ? (why ?? REJECTED_PROJECT_SAY) : [projectLine(project.facts), verdictSay(project.study)].filter(Boolean).join(". ")}</p>
            </div>
            <dl className="file-figures">
              {project.requested > 0 && (
                <div>
                  <dt>المطلوب، {amountParts(project.requested).unit}</dt>
                  <dd className="num">{amountParts(project.requested).figure}</dd>
                </div>
              )}
              {project.facts.landValue && (
                <div>
                  <dt>قيمة الأرض، {amountParts(project.facts.landValue).unit}</dt>
                  <dd className="num">{amountParts(project.facts.landValue).figure}</dd>
                </div>
              )}
              {project.study.ltv != null && project.requested > 0 && (
                <div data-bad={project.study.verdict === "weak" || undefined}>
                  <dt>المطلوب من قيمة الأرض</dt>
                  <dd className="num">{percent(project.study.ltv)}</dd>
                </div>
              )}
            </dl>
            <div className="file-doors">
              <Link className="btn btn--white" href={`/clients/${client.id}/project`}>
                افتح الدراسة
              </Link>
              <Link href={`/clients/${client.id}/project/papers`}>المستندات</Link>
              {mayEdit && !project.rejected && <Link href={`/clients/${client.id}/project/edit`}>عدّل المشروع</Link>}
              {maySee && <Link href={`/clients/${client.id}/credit`}>سمة</Link>}
            </div>
            {mayDecide && <DecideFile clientId={client.id} decision={project.rejected ? "reopen" : "reject"} project />}
          </section>
        ) : (
          <section className="tile tile--verdict tile--file" data-state={state.kind}>
            <div>
              <p className="label">{state.kind === "open" ? "الصفقة الجارية" : state.kind === "none" ? "الصفقة" : "آخر صفقة"}</p>
              <h2 className="compose-title">
                {state.kind === "open" ? STAGE[state.stage] : state.kind === "done" ? "اكتملت الصفقة" : state.kind === "rejected" ? "الملف مرفوض" : "لا صفقة بعد"}
              </h2>
              <p className="file-say">
                {state.kind === "open" && deal
                  ? `${deal.verdict ? VERDICT[deal.verdict] : "قيد الدراسة"} · ${STRUCTURE[deal.structure]}`
                  : state.kind === "done" && deal
                    ? `أُغلقت ${dayFull(deal.movedAt)}، واستُرد رأس المال والأتعاب.`
                    : state.kind === "rejected"
                      ? (why ?? "أُغلق الملف بلا صفقة.")
                      : "فُتح الملف ولم تُدرس له صفقة."}
              </p>
            </div>

            {figures.length > 0 && (
              <dl className="file-figures">
                {figures.map((figure) => (
                  <div key={figure.label} data-bad={figure.bad || undefined}>
                    <dt>{figure.label}</dt>
                    <dd className="num">{plainMoney(figure.value)}</dd>
                  </div>
                ))}
              </dl>
            )}

            {state.kind === "open" && (
              <ol className="steps" aria-label="محطات الصفقة">
                {stations.map((key, index) => (
                  <li key={key} data-state={index < position ? "done" : index === position ? "current" : "ahead"} aria-current={index === position ? "step" : undefined}>
                    {STATION[key]}
                  </li>
                ))}
              </ol>
            )}

            <div className="file-doors">
              {deal ? (
                <>
                  <Link className="btn btn--white" href={`/deals/${deal.id}`}>
                    افتح الصفقة
                  </Link>
                  <Link href={`/deals/${deal.id}/documents`}>المستندات</Link>
                  {maySee && <Link href={`/deals/${deal.id}/messages`}>الرسائل</Link>}
                  {maySee && <Link href={`/clients/${client.id}/credit`}>سمة</Link>}
                  {maySee && <Link href={`/clients/${client.id}/analysis`}>التحليل الائتماني</Link>}
                  <Link href={`/deals/${deal.id}/lenders`}>جهات التمويل</Link>
                  {maySee && <Link href={`/clients/${client.id}/conditions`}>شروط الجهات</Link>}
                </>
              ) : (
                maySee && (
                  <>
                    <Link href={`/clients/${client.id}/credit`}>سمة</Link>
                    <Link href={`/clients/${client.id}/analysis`}>التحليل الائتماني</Link>
                  </>
                )
              )}
              {mayDecide && (state.kind === "none" || state.kind === "done") && (
                <Link className={deal ? undefined : "btn btn--white"} href={`/deals/new?client=${client.id}`}>
                  {!deal && <PlusIcon />}
                  صفقة جديدة
                </Link>
              )}
            </div>
            {mayDecide && state.kind === "open" && <DecideFile clientId={client.id} decision="reject" />}
            {mayDecide && state.kind === "rejected" && <DecideFile clientId={client.id} decision="reopen" />}
          </section>
        )}

        <section className="tile tile--contact">
          <p className="label">بيانات التواصل</p>
          {!maySee ? (
            <p className="thread-none">تظهر لمن له صلاحية الاطلاع على بيانات العملاء.</p>
          ) : mayEdit ? (
            <ContactForm
              clientId={client.id}
              contact={{
                phone: phoneTyped(client.phone),
                nationality,
                nationalId: client.nationalId ?? "",
                employer: client.employer ?? "",
                city: client.city ?? "",
                email: client.email ?? "",
              }}
            />
          ) : (
            <dl className="facts">
              <div>
                <dt>الجوال</dt>
                <dd className="num">{phoneText(client.phone) || "-"}</dd>
              </div>
              <div>
                <dt>الجنسية</dt>
                <dd>{NATIONALITY[nationality]}</dd>
              </div>
              <div>
                <dt>{ID_LABEL[nationality]}</dt>
                <dd className="num">{client.nationalId ? ltr(client.nationalId) : "-"}</dd>
              </div>
              <div>
                <dt>المدينة</dt>
                <dd>{client.city ?? "-"}</dd>
              </div>
              <div>
                <dt>جهة العمل</dt>
                <dd>{client.employer ?? "-"}</dd>
              </div>
              <div>
                <dt>البريد الإلكتروني</dt>
                <dd className="num">{client.email ? ltr(client.email) : "-"}</dd>
              </div>
            </dl>
          )}
        </section>

        <section className="tile tile--filenotes">
          <p className="label">ملاحظات الملف</p>
          {mayEdit && <NoteForm clientId={client.id} />}
          {notes.length > 0 ? (
            <ul className="file-notes">
              {notes.map((note) => (
                <li key={note.id} data-kind={note.kind}>
                  <p>{note.body}</p>
                  <small>
                    {[NOTE_KIND[note.kind] ?? NOTE_KIND.note, note.by, agoText(note.at, now)].filter(Boolean).join(" · ")}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            !mayEdit && <p className="thread-none">لا ملاحظات على هذا الملف.</p>
          )}
        </section>

        {maySee && !project && facts.length > 0 && (
          <section className="tile tile--five tile--facts">
            <div className="facts-head">
              <p className="label">ما تُحسب عليه الصفقة</p>
              {mayDecide && state.kind === "open" && deal && (
                <Link className="edit-link" data-soft href={`/deals/${deal.id}/edit`}>
                  <PenIcon size={15} />
                  عدّل
                </Link>
              )}
            </div>
            <dl className="facts">
              {facts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {study && deal && (
          <section className="tile tile--wide file-opps">
            <div className="facts-head">
              <p className="label">الفرص</p>
              <Link className="note-link" href={`/deals/${deal.id}/opportunities`}>
                افتح الدراسة
              </Link>
            </div>
            {opportunities.length === 0 ? (
              <p className="thread-none">لا جهات في القائمة بعد، فلا فرص تُدرس.</p>
            ) : (
              <ol className="file-opps-list">
                {opportunities.slice(0, 5).map((o, index) => {
                  const names = cardLenders(o);
                  return (
                    <li key={o.key} data-class={o.class} data-chosen={o.chosen || undefined}>
                      <span className="opp-rank num" aria-hidden="true">
                        {index + 1}
                      </span>
                      <div className="file-opps-who">
                        <b>{names.main}</b>
                        <small>{[names.also, o.chosen && `الخطة المختارة · ${PLAN_STATE[study.plan]}`].filter(Boolean).join(" · ")}</small>
                      </div>
                      <span className="opp-class" data-class={o.class}>
                        {OPPORTUNITY_CLASS[o.class]}
                      </span>
                      <span className="opp-confidence" data-confidence={o.confidence}>
                        {CONFIDENCE[o.confidence]}
                      </span>
                      <p className="file-opps-keep" data-short={o.net.net < 0 || undefined}>
                        <small>{o.net.net >= 0 ? "يبقى للعميل" : "عجز"}</small>
                        <Num value={Math.abs(o.net.net)} />
                      </p>
                    </li>
                  );
                })}
              </ol>
            )}
            {opportunities.length > 0 && !opportunities.some((o) => o.chosen) && <p className="file-opps-none">لم تُختر خطة بعد: الصفقة ليست على شروط جهة من القائمة.</p>}
          </section>
        )}

        {deals.length > 1 && (
          <section className="tile tile--wide">
            <p className="label">صفقات سابقة</p>
            <ul className="past">
              {deals.slice(1).map((past) => (
                <li key={past.id}>
                  <Link href={`/deals/${past.id}`}>
                    <b>{past.stage === "closed" ? "اكتملت" : past.stage === "lost" ? "لم تُغلق" : STAGE[past.stage]}</b>
                    <span>{STRUCTURE[past.structure]}</span>
                    <small>{dayFull(past.startedAt)}</small>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
