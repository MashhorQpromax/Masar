import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { STRUCTURE } from "@/copy/deal";
import { FINANCE_TYPE } from "@/copy/eligibility";
import { counted, dayOf, months, plainMoney } from "@/copy/format";
import { ROUTE_STATUS, routeError, routeLenders, routeNoteText } from "@/copy/funding";
import { acceptedText, PART } from "@/copy/knowledge";
import { can } from "@/domain/auth";
import { STRUCTURES, structureOf } from "@/domain/deal";
import type { FundingRoute, RouteLeg } from "@/domain/funding";
import { experience, knownFor, type Bearing, type Rule } from "@/domain/knowledge";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { getFunding } from "@/server/funding/service";
import { decisionFacts, listLenders, listRules, recentDecisions } from "@/server/knowledge/service";
import { AnswerRow, DecisionRow, NoteRow } from "@/ui/knowledge";
import { BackIcon } from "@/ui/icons";
import { Num } from "@/ui/Num";
import { SubmitButton } from "@/ui/SubmitButton";
import { chooseRoute } from "./actions";
import { DecisionForm, type PartStart } from "./DecisionForm";
import { SalaryBank } from "./SalaryBank";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "جهات التمويل · مسار" };

const OTHERS = { one: "طريق آخر", two: "طريقان آخران", few: "طرق أخرى", many: "طريقاً آخر" };
const REFUSING = { one: "جهة لا تقبل الآن", two: "جهتان لا تقبلان الآن", few: "جهات لا تقبل الآن", many: "جهة لا تقبل الآن" };
/** The office's own notes shown beside a route. The rest are a link away. */
const NOTES_SHOWN = 3;
const PARTS = ["mortgage", "personal"] as const;
type Part = (typeof PARTS)[number];
const UP = "M250 65H190C160 65 152 22 122 22H74";
const MID = "M250 65H74";
const DOWN = "M250 65H190C160 65 152 108 122 108H74";

/** One road that parts into three. The lit branch is the lender the deal should take. */
function ForkArt({ none }: { none: boolean }) {
  return (
    <svg className="verdict-art fork" viewBox="0 0 260 130" fill="none" aria-hidden="true" data-none={none || undefined}>
      <path d={DOWN} stroke="#1d4468" strokeWidth="13" strokeLinecap="round" />
      <path d={MID} stroke="#1d4468" strokeWidth="13" strokeLinecap="round" />
      <path d={UP} stroke="#1d4468" strokeWidth="16" strokeLinecap="round" />
      <path className="road-dash" d={UP} stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="64" cy="65" r="8" fill="#0f2a43" stroke="#34536f" strokeWidth="4" />
      <circle cx="64" cy="108" r="8" fill="#0f2a43" stroke="#34536f" strokeWidth="4" />
      <circle className="fork-end" cx="58" cy="22" r="16" fill="#ffc233" />
    </svg>
  );
}

const monthly = (route: FundingRoute): number => (route.mortgage?.installment ?? 0) + (route.personal?.installment ?? 0);

function Leg({ name, leg }: { name: string; leg: RouteLeg }) {
  return (
    <div>
      <dt>{name}</dt>
      <dd>
        <Num value={leg.amount} />
      </dd>
      <small>
        {months(leg.months)}
        {leg.atCeiling && " · سقف الجهة"}
      </small>
    </div>
  );
}

function Figures({ route }: { route: FundingRoute }) {
  return (
    <dl className="route-figures">
      {route.mortgage && <Leg name="العقاري" leg={route.mortgage} />}
      {route.personal && <Leg name="الشخصي" leg={route.personal} />}
      <div>
        <dt>القسط الشهري</dt>
        <dd>
          <Num value={monthly(route)} />
        </dd>
      </div>
    </dl>
  );
}

/** What the office knows about the lender of one part of a route, with the names to say it under. */
interface Known extends Bearing<Rule> {
  lender: string;
  /** Which part or lender it is about, when the route has more than one. */
  about: string | null;
}

export default async function LendersPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ refused?: string }> }) {
  const me = await requireActor();
  const dealId = Number((await params).id);
  if (!Number.isInteger(dealId) || dealId <= 0) notFound();
  const db = await getDb();
  const view = await getFunding(db, { dealId });
  if (!view) notFound();
  const rules = await listRules(db);
  const facts = await decisionFacts(db);
  const lenders = await listLenders(db);
  const answered = await recentDecisions(db, { clientId: view.client.id });
  const now = new Date();

  const { deal, client, routes, chosen } = view;
  const refused = (await searchParams).refused;
  const mayChoose = can(me.role, "deal.edit") && !view.ended && !view.offerRecorded;
  const mayManage = can(me.role, "lender.manage");
  const mayEditClient = can(me.role, "client.edit") && !view.ended;

  const like = { sector: client.sector, salary: client.totalSalary ?? client.basicSalary };
  const records = { mortgage: experience(facts, "mortgage", like), personal: experience(facts, "personal", like) };
  const knownOf = (route: FundingRoute): Known[] => {
    const both = route.mortgage != null && route.personal != null;
    const legs = PARTS.flatMap((part) => (route[part] ? [{ part, lenderId: Number(route[part].product.lenderId) }] : []));
    return knownFor(legs, rules, records).map((item) => {
      const lender = route[item.part]!.product.lenderName;
      return { ...item, lender, about: both ? (route.oneLender ? PART[item.part] : lender) : null };
    });
  };

  const best = routes[0];
  const open = routes.filter((route) => route.status !== "fail");
  const closed = routes.filter((route) => route.status === "fail");
  const others = open.filter((route) => route !== best);

  const head = (
    <div className="head">
      <div>
        <Link className="back" href={`/deals/${deal.id}`}>
          <BackIcon />
          ملف الصفقة
        </Link>
        <h1 className="title">جهات التمويل</h1>
      </div>
      <div className="head-side">
        <p className="where">
          <span className="num">{client.fileNo}</span> · <b>{client.fullName}</b> · {STRUCTURE[deal.structure]}
        </p>
        {mayEditClient && view.banks.length > 0 && <SalaryBank dealId={deal.id} clientId={client.id} value={client.salaryBank} banks={view.banks} />}
      </div>
    </div>
  );

  if (!best) {
    return (
      <>
        {head}
        <section className="empty">
          <h2>لا جهات في القائمة</h2>
          <p>أضف الجهات التي تتعامل معها الشركة وشروط كل منها، فتُحسب الصفقة على كل جهة.</p>
        </section>
      </>
    );
  }

  const taken = best.status !== "fail";
  const { main, also } = routeLenders(best);
  const net = best.study.clientNet;
  const notes = taken ? best.conditions : best.refusals;
  const isChosen = chosen === best.key;
  const chosenRoute = routes.find((route) => route.key === chosen);
  const known = knownOf(best);
  const written = known.flatMap((item) => item.notes.map((rule) => ({ rule, from: best.oneLender ? "" : item.lender }))).slice(0, NOTES_SHOWN);

  // A lender's answer is recorded against the part of the deal it answered for.
  const structure = STRUCTURES[structureOf(view.input)];
  const lead = chosenRoute ?? best;
  const parts: Partial<Record<Part, PartStart>> = {};
  for (const part of PARTS) {
    if (structure[part]) parts[part] = { lenderId: lead[part] ? Number(lead[part].product.lenderId) : null, amount: view.study.financing[part] || null };
  }
  const mayRecord = can(me.role, "app.manage") && lenders.length > 0 && Object.keys(parts).length > 0;

  return (
    <>
      {head}
      {refused && (
        <p className="said" role="alert" data-bad>
          {routeError(refused)}
        </p>
      )}

      <div className="bento">
        <section className="tile tile--verdict" data-verdict={taken && best.closes ? "go" : "short"}>
          <ForkArt none={!taken} />
          <div className="verdict-text">
            <p className="label">{taken ? (isChosen ? "جهة الصفقة" : "أفضل طريق") : "أقرب جهة"}</p>
            <h2 className="verdict-say verdict-say--name">{main}</h2>
            {also && <p className="verdict-also">{also}</p>}
            <p className="verdict-keep">
              <span>{net >= 0 ? "يبقى للعميل" : "عجز"}</span> <b className="num">{plainMoney(Math.abs(net))}</b> <span>ريال</span>
            </p>
          </div>
          <Figures route={best} />
        </section>

        {view.ended ? (
          <section className="tile tile--next" data-quiet="true">
            <div>
              <p className="label">الحالة</p>
              <h2>الصفقة انتهت</h2>
              <p className="due">المقارنة للاطلاع، وأرقام الصفقة لا تُعدَّل.</p>
            </div>
          </section>
        ) : view.offerRecorded ? (
          <section className="tile tile--next" data-quiet="true">
            <div>
              <p className="label">الحالة</p>
              <h2>على الصفقة عرض فعلي</h2>
              <p className="due">أرقام العرض المسجل هي المعتمدة. ما هنا مقارنة تقديرية بشروط الجهات.</p>
            </div>
          </section>
        ) : !taken ? (
          <section className="tile tile--next" data-quiet="true">
            <div>
              <p className="label">الحالة</p>
              <h2>لا جهة تقبل الآن</h2>
              <p className="due">عالج ما يمنع أقرب جهة، أو صحّح شروطها إن كانت تقبل فعلاً.</p>
            </div>
          </section>
        ) : isChosen ? (
          <section className="tile tile--next" data-quiet="true">
            <div>
              <p className="label">الحالة</p>
              <h2>الصفقة على هذه الجهة</h2>
              <p className="due">أرقام الملف محسوبة على هامشها ومدتها وسقفها.</p>
            </div>
            <div className="actions">
              <Link className="btn btn--navy" href={`/deals/${deal.id}`}>
                ملف الصفقة
              </Link>
            </div>
          </section>
        ) : (
          <section className="tile tile--next">
            <div>
              <p className="label">الخطوة التالية</p>
              <h2>اعتمدها للصفقة</h2>
              <p className="due">
                {chosenRoute ? `الصفقة الآن على ${routeLenders(chosenRoute).main}.` : "تُحسب الصفقة على هامشها ومدتها وسقفها."}
              </p>
            </div>
            {mayChoose && (
              <form className="actions" action={chooseRoute}>
                <input type="hidden" name="dealId" value={deal.id} />
                <input type="hidden" name="key" value={best.key} />
                <SubmitButton className="btn btn--navy">اعتمد هذه الجهة</SubmitButton>
              </form>
            )}
          </section>
        )}

        <section className="tile tile--notes tile--five">
          <p className="label">{taken ? (notes.length ? "ما تطلبه" : "لا شروط على العميل") : "لماذا لا تقبل"}</p>
          {notes.map((note, index) => (
            <p key={index} className="note" data-level={taken ? "warn" : "block"}>
              {routeNoteText(note, best)}
            </p>
          ))}
          <p className="note" data-level={best.verified ? "good" : undefined}>
            <span>
              {best.verified ? "شروطها مؤكدة مع الجهة." : "شروطها استرشادية، ولم تؤكَّد مع الجهة بعد."}{" "}
              {mayManage && (
                <Link className="note-link" href="/lenders">
                  صحّح الشروط
                </Link>
              )}
            </span>
          </p>
        </section>

        {known.length > 0 && (
          <section className="tile tile--wide tile--learned">
            <div className="learned-top">
              <p className="label">من خبرة المكتب</p>
              <Link className="note-link" href="/lenders/knowledge">
                كل الخبرة
              </Link>
            </div>
            <div className="learned">
              {known.some((item) => item.record) && (
                <ol className="answers">
                  {known.map((item) => item.record && <AnswerRow key={item.part} name={item.about ?? item.lender} e={item.record} similar />)}
                </ol>
              )}
              {written.length > 0 && (
                <ul className="know-notes">
                  {written.map(({ rule, from }) => (
                    <NoteRow key={rule.id} rule={rule} meta={[from, rule.author, rule.author && dayOf(rule.createdAt, now)].filter(Boolean).join(" · ")} />
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {(others.length > 0 || closed.length > 0) && (
          <section className="tile tile--wide">
            {others.length > 0 && (
              <>
                <p className="label">{counted(others.length, OTHERS)}</p>
                <ol className="routes">
                  {others.map((route) => {
                    const names = routeLenders(route);
                    const before = knownOf(route).filter((item) => item.record);
                    return (
                      <li key={route.key} className="route" data-chosen={route.key === chosen || undefined}>
                        <div className="route-who">
                          <b>{names.main}</b>
                          {names.also && <small>{names.also}</small>}
                          <span className="route-state" data-status={route.status}>
                            {route.key === chosen ? "جهة الصفقة" : ROUTE_STATUS[route.status]}
                          </span>
                        </div>
                        <Figures route={route} />
                        <p className="route-keep" data-short={route.study.clientNet < 0 || undefined}>
                          <small>{route.study.clientNet >= 0 ? "يبقى للعميل" : "عجز"}</small>
                          <Num value={Math.abs(route.study.clientNet)} />
                        </p>
                        {mayChoose && route.key !== chosen ? (
                          <form className="route-go" action={chooseRoute}>
                            <input type="hidden" name="dealId" value={deal.id} />
                            <input type="hidden" name="key" value={route.key} />
                            <SubmitButton className="btn btn--soft">اعتمد</SubmitButton>
                          </form>
                        ) : (
                          <span className="route-go" />
                        )}
                        {(route.conditions.length > 0 || before.length > 0) && (
                          <ul className="route-notes">
                            {route.conditions.map((note, index) => (
                              <li key={index}>{routeNoteText(note, route)}</li>
                            ))}
                            {before.map((item) => (
                              <li key={item.part} data-learned>
                                {item.about ? `${item.about}: ` : ""}
                                {acceptedText(item.record!)}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
            {closed.length > (taken ? 0 : 1) && (
              <details className="more routes-closed">
                <summary>{counted(taken ? closed.length : closed.length - 1, REFUSING)}</summary>
                <div>
                  {closed
                    .filter((route) => route !== best)
                    .map((route) => (
                      <p key={route.key} className="note" data-level="block">
                        <span>
                          <b>{routeLenders(route).main}</b>
                          {routeLenders(route).also ? ` ${routeLenders(route).also}` : ""}: {route.refusals.map((note) => routeNoteText(note, { oneLender: true })).join(" ")}
                        </span>
                      </p>
                    ))}
                </div>
              </details>
            )}
          </section>
        )}

        {(mayRecord || answered.length > 0) && (
          <section className="tile tile--wide tile--ruling">
            <p className="label">قرار الجهة</p>
            {answered.length > 0 ? (
              <ol className="rulings">
                {answered.map((line) => (
                  <DecisionRow key={line.id} line={line} now={now} sub={line.financeType ? FINANCE_TYPE[line.financeType] : ""} />
                ))}
              </ol>
            ) : (
              <p className="ruling-none">حين تجيب الجهة سجّل قرارها هنا. يُحسب الملف على المبلغ الذي اعتمدته، ويعرف المكتب ما تطلبه في المرة القادمة.</p>
            )}
            {mayRecord && (
              <details className="ruling-new">
                <summary>سجّل قرار جهة</summary>
                <DecisionForm dealId={deal.id} lenders={lenders} parts={parts} mayAmend={can(me.role, "deal.edit") && !view.ended} />
              </details>
            )}
          </section>
        )}
      </div>
    </>
  );
}
