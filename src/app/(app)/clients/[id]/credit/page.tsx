import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import {
  ACCESS,
  actionText,
  actionTitle,
  blockerText,
  CONFIDENCE,
  doorText,
  FACILITY_STATUS,
  findingText,
  GRADE,
  JUDGMENT_KIND,
  parseWarningText,
} from "@/copy/credit";
import { counted, dayOfRecord, dayShort, ltr, money, percent, plainMoney } from "@/copy/format";
import { can } from "@/domain/auth";
import type { Door, Facility, FacilityStatus, FindingLevel, Grade } from "@/domain/credit";
import { requireActor } from "@/server/auth/actor";
import { getCredit } from "@/server/credit/service";
import { getDb } from "@/server/db/client";
import { BackIcon, CheckIcon, ChevronIcon, CloseIcon } from "@/ui/icons";
import { Num } from "@/ui/Num";
import { SubmitButton } from "@/ui/SubmitButton";
import { answerSuspension } from "./actions";
import { ReportUpload } from "./ReportUpload";
import { ReviewForm } from "./ReviewForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "السجل الائتماني · مسار" };

const GRADES: Grade[] = ["A", "B", "C", "D", "E"];
const LEVEL_ORDER: Record<FindingLevel, number> = { block: 0, warn: 1, info: 2, good: 3 };
const STATUS_ORDER: Record<FacilityStatus, number> = { default: 0, late: 1, current: 2, settled: 3, closed: 4 };
const BLOCKERS = { one: "مانع واحد", two: "مانعان", few: "موانع", many: "مانعاً" };
const NOTES = { one: "ملاحظة واحدة", two: "ملاحظتان", few: "ملاحظات", many: "ملاحظة" };
const PATH = "M250 92C212 92 200 40 162 40S112 92 74 92";

/** The road to the bank with a barrier across it. The barrier swings clear as the doors open. */
function GateArt({ swing }: { swing: 0 | 45 | 90 }) {
  return (
    <svg className="verdict-art gate" viewBox="0 0 260 130" fill="none" aria-hidden="true" data-shut={swing === 0 || undefined}>
      <path d={PATH} stroke="#1d4468" strokeWidth="16" strokeLinecap="round" />
      <path className="road-dash" d={PATH} stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="56" cy="92" r="18" fill="#ffc233" />
      <g className="gate-arm" style={{ "--swing": `${swing}deg` } as CSSProperties}>
        <rect x="156" y="14" width="12" height="54" rx="6" fill="#fff" />
        <path d="M156 27h12v9h-12zM156 45h12v9h-12z" fill="#ff5a3c" />
      </g>
      <circle cx="162" cy="14" r="7.5" fill="#ffc233" stroke="#0f2a43" strokeWidth="3" />
    </svg>
  );
}

/** Whether one kind of lender would take the client today, and why. */
function DoorRow({ name, door }: { name: string; door: Door }) {
  const { reason, reopen } = doorText(door);
  return (
    <li className="door" data-access={door.access}>
      <div className="door-head">
        <i className="door-node" aria-hidden="true">
          {door.access === "open" ? <CheckIcon size={16} /> : door.access === "closed" ? <CloseIcon size={15} /> : <b />}
        </i>
        <div>
          <h3 className="door-name">
            {name}
            <span className="door-state">{ACCESS[door.access]}</span>
          </h3>
          <p className="door-say">
            {reason}
            {reopen && ` ${reopen}`}
          </p>
        </div>
      </div>
    </li>
  );
}

/** What a product owes today, as the one figure worth a column. */
const owedOn = (f: Facility): number | null =>
  f.status === "default" ? (f.defaultNow ?? f.defaultAmount ?? f.balance ?? null) : f.status === "settled" ? (f.defaultAmount ?? null) : (f.balance ?? null);

function Line({ title, detail, amount }: { title: string; detail: string; amount: number | null }) {
  return (
    <p className="ledger-line">
      <span>
        {title}
        <small>{detail}</small>
      </span>
      {amount != null ? <Num value={amount} /> : <span />}
    </p>
  );
}

const joined = (parts: (string | null | undefined | false)[]): string => parts.filter(Boolean).join(" · ");

export default async function CreditPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireActor("client.view_pii");
  const clientId = Number((await params).id);
  if (!Number.isInteger(clientId) || clientId <= 0) notFound();
  const view = await getCredit(await getDb(), clientId);
  if (!view) notFound();

  const { client, dealId, record, history } = view;
  const mayUpload = can(me.role, "doc.upload");
  const mayEdit = can(me.role, "client.edit");

  const head = (side: ReactNode) => (
    <div className="head">
      <div>
        <Link className="back" href={dealId ? `/deals/${dealId}` : "/"}>
          <BackIcon />
          {dealId ? "ملف الصفقة" : "الطريق"}
        </Link>
        <h1 className="title">السجل الائتماني</h1>
      </div>
      <div className="head-side">{side}</div>
    </div>
  );
  const who = (
    <>
      <span className="num">{client.fileNo}</span> · <b>{client.fullName}</b>
    </>
  );

  if (!record) {
    return (
      <>
        {head(<p className="where">{who}</p>)}
        <section className="empty empty--credit">
          <GateArt swing={45} />
          <h2>لا تقرير بعد</h2>
          <p>ارفع تقرير سمة كما نزل من سمة، ونقرؤه في ثوانٍ: التقييم، ومن يقبل العميل اليوم، وما المطلوب سداده.</p>
          {mayUpload && <ReportUpload clientId={client.id} />}
        </section>
      </>
    );
  }

  const { report, analysis, warnings } = record;
  const { grade, stats, banks, financeCompanies } = analysis;
  const asking = !!report.suspensionAssumed && mayEdit;
  const swing = banks.access === "open" ? 90 : banks.access === "conditional" || financeCompanies.access !== "closed" ? 45 : 0;

  // What a person should double check in the reading comes first, then what blocks, then what was found.
  const notes: { key: string; level: FindingLevel; text: string }[] = [
    ...warnings.filter((w) => w.code !== "SUSPENSION_ASSUMED").map((w, i) => ({ key: `w${i}`, level: "warn" as const, text: parseWarningText(w) })),
    ...analysis.blockers.map((b, i) => ({ key: `b${i}`, level: "block" as const, text: blockerText(b) })),
    ...[...analysis.findings]
      .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
      .map((f, i) => ({ key: `f${i}`, level: f.level, text: findingText(f) })),
  ];
  const blocking = analysis.blockers.length;
  const notesLabel = [blocking ? counted(blocking, BLOCKERS) : null, notes.length - blocking ? counted(notes.length - blocking, NOTES) : null]
    .filter(Boolean)
    .join(" و");

  const plan = analysis.actions.filter((a) => a.code !== "NONE");
  // The notes stand beside the plan. A long plan leaves room for more of them before the rest is folded.
  const VISIBLE_NOTES = plan.length > 4 ? 6 : 4;
  const facilities = [...report.facilities].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  const inquiries = report.inquiries ?? [];

  // The record in figures. With a plan it runs under it; with none it takes the plan's place beside the notes.
  const figures = (className: string) => (
    <section className={className}>
      <dl className="figures">
        <div>
          <dt>التزامات قائمة</dt>
          <dd className="num">{stats.activeFacilities}</dd>
        </div>
        <div>
          <dt>أقساط شهرية</dt>
          <dd>
            <Num value={stats.monthlyInstallments} />
          </dd>
        </div>
        <div>
          <dt>أرصدة قائمة</dt>
          <dd>
            <Num value={stats.totalBalance} />
          </dd>
        </div>
        {stats.cardUtilization != null && (
          <div>
            <dt>استخدام البطاقات</dt>
            <dd>{percent(stats.cardUtilization)}</dd>
          </div>
        )}
        <div>
          <dt>استعلامات في 6 أشهر</dt>
          <dd className="num">{stats.inquiries6m}</dd>
        </div>
        {report.score != null && (
          <div>
            <dt>الدرجة الائتمانية</dt>
            <dd className="num">{report.score}</dd>
          </div>
        )}
      </dl>
    </section>
  );

  return (
    <>
      {head(
        <>
          <p className="where">
            {who}
            {report.reportDate && <> · تقرير {dayOfRecord(report.reportDate)}</>}
            {record.confidence && record.confidence !== "high" && <> · {CONFIDENCE[record.confidence]}</>}
          </p>
          {mayUpload && <ReportUpload clientId={client.id} again />}
        </>,
      )}

      <div className="bento">
        <section className="tile tile--verdict" data-verdict={stats.totalToClear > 0 ? "short" : "go"}>
          <GateArt swing={swing} />
          <div className="verdict-text">
            <p className="label">التقييم</p>
            <h2 className="verdict-say">{GRADE[grade].title}</h2>
            {stats.totalToClear > 0 ? (
              <p className="verdict-keep">
                <span>المطلوب سداده</span> <b className="num">{plainMoney(stats.totalToClear)}</b> <span>ريال</span>
              </p>
            ) : (
              <p className="verdict-keep">
                <span>{GRADE[grade].note}</span>
              </p>
            )}
          </div>
          <ol className="steps steps--scale" aria-label="سلّم التقييم" data-good={grade === "A" || grade === "B" || undefined}>
            {GRADES.map((g) => (
              <li key={g} data-state={g === grade ? "current" : undefined} aria-current={g === grade ? "true" : undefined}>
                {GRADE[g].title}
              </li>
            ))}
          </ol>
        </section>

        {asking && (
          <section className="tile tile--next">
            <div>
              <p className="label">يحتاج تحققاً</p>
              <h2>هل على العميل إيقاف خدمات؟</h2>
              <p className="due">على السجل قرار تنفيذ لم يُنفّذ، فافترضنا الإيقاف. تحقق من أبشر أو ناجز.</p>
            </div>
            <div className="actions">
              {(["yes", "no"] as const).map((answer) => (
                <form key={answer} action={answerSuspension}>
                  <input type="hidden" name="clientId" value={client.id} />
                  <input type="hidden" name="reportId" value={record.id} />
                  <input type="hidden" name="suspension" value={answer} />
                  <SubmitButton className={answer === "yes" ? "btn btn--navy" : "btn btn--white"}>{answer === "yes" ? "يوجد إيقاف" : "لا يوجد"}</SubmitButton>
                </form>
              ))}
            </div>
          </section>
        )}

        <section className="tile tile--access" data-tall={!asking || undefined}>
          <p className="label">من يقبله اليوم</p>
          <ul>
            <DoorRow name="البنوك" door={banks} />
            <DoorRow name="شركات التمويل" door={financeCompanies} />
          </ul>
        </section>

        {plan.length > 0 ? (
          <section className="tile tile--plan">
            <p className="label">الخطة بالترتيب</p>
            <ol className="plan">
              {plan.map((action, index) => (
                <li key={`${action.code}-${index}`}>
                  <b className="num">{index + 1}</b>
                  <div>
                    <h3>{actionTitle(action)}</h3>
                    <p>{actionText(action)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ) : (
          figures("tile tile--plan tile--figures")
        )}

        <section className="tile tile--notes tile--five">
          <p className="label">{notesLabel || "لا ملاحظات"}</p>
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
          {report.notes && <p className="note-own">{report.notes}</p>}
        </section>

        {plan.length > 0 && figures("tile tile--wide")}

        <details className="tile tile--wide ledger">
          <summary>
            ما في التقرير
            <ChevronIcon />
          </summary>
          <div className="ledger-grid">
            <div className="ledger-section">
              <h3>المنتجات ({ltr(facilities.length)})</h3>
              {facilities.map((f, index) => (
                <Line
                  key={index}
                  title={f.lender}
                  detail={joined([f.product, FACILITY_STATUS[f.status], f.installment ? `قسط ${money(f.installment)}` : null, f.worstDelay ? `تأخر ${ltr(f.worstDelay)} يوماً` : null])}
                  amount={owedOn(f)}
                />
              ))}
              {!facilities.length && <p className="ledger-none">لا منتجات مقروءة.</p>}
            </div>
            {report.judgments.length > 0 && (
              <div className="ledger-section">
                <h3>الأحكام وقرارات التنفيذ ({ltr(report.judgments.length)})</h3>
                {report.judgments.map((j, index) => (
                  <Line
                    key={index}
                    title={`${JUDGMENT_KIND[j.kind]}${j.decisionNo ? ` ${ltr(j.decisionNo)}` : ""}`}
                    detail={joined([j.creditor ?? "دائن غير محدد", j.date ? ltr(j.date) : null, j.state ?? (j.active ? "قائم" : "منتهٍ")])}
                    amount={j.remaining ?? j.amount ?? null}
                  />
                ))}
              </div>
            )}
            {inquiries.length > 0 && (
              <div className="ledger-section">
                <h3>الاستعلامات ({ltr(inquiries.length)})</h3>
                {inquiries.map((q, index) => (
                  <Line key={index} title={q.lender} detail={joined([q.product, ltr(q.date)])} amount={q.amount} />
                ))}
              </div>
            )}
          </div>
        </details>

        {(mayEdit || history.length > 1) && (
          <details className="tile tile--wide ledger">
            <summary>
              المراجعة اليدوية
              <ChevronIcon />
            </summary>
            <div className="ledger-grid">
              {mayEdit && (
                <div className="ledger-section">
                  <h3>ما لا يظهر في سمة</h3>
                  <ReviewForm
                    key={`${record.id}-${report.suspensionAssumed}-${report.serviceSuspension}`}
                    clientId={client.id}
                    reportId={record.id}
                    suspension={report.serviceSuspension}
                    assumed={!!report.suspensionAssumed}
                    travelBan={!!report.travelBan}
                    note={report.notes ?? ""}
                  />
                </div>
              )}
              <div className="ledger-section">
                <h3>القراءات ({ltr(history.length)})</h3>
                {history.map((reading) => (
                  <p key={reading.id} className="ledger-line">
                    <span>
                      {dayShort(reading.createdAt)}
                      <small>{reading.id === record.id ? "السجل الحالي" : "قراءة سابقة"}</small>
                    </span>
                    <span>{reading.grade && reading.grade in GRADE ? GRADE[reading.grade as Grade].title : ""}</span>
                  </p>
                ))}
              </div>
            </div>
          </details>
        )}
      </div>
    </>
  );
}
