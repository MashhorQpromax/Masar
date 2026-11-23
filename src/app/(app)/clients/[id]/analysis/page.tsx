import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import {
  AFTER_CLEARING,
  ANALYSIS_VERDICT,
  DECISION_SUPPORT,
  FIT_STATUS,
  fitCheckText,
  floorText,
  GAP_KIND,
  gapText,
  INCOME_BASIS,
  kindTitle,
  MARK_SOURCE,
  markText,
  noInstallment,
  noTaker,
  roomRule,
  stepText,
  stepTitle,
  verdictSay,
} from "@/copy/analysis";
import { CONSENT_WITHDRAWN, GRADE } from "@/copy/credit";
import { counted, dayFull, dayOfRecord, ltr, money, months, percent, plainMoney } from "@/copy/format";
import type { Fit, KindFit, Mark, Step } from "@/domain/analysis";
import { can } from "@/domain/auth";
import { getAnalysis } from "@/server/analysis/service";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { isProjectFile } from "@/server/projects/service";
import { BackIcon } from "@/ui/icons";
import { Num } from "@/ui/Num";
import { SubmitButton } from "@/ui/SubmitButton";
import { recordConsent } from "../actions";
import { DoorRow } from "../credit/DoorRow";
import { ReportUpload } from "../credit/ReportUpload";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "التحليل الائتماني · مسار" };

/** How many commitments the installments come from, as it reads after "من". */
const FROM_COMMITMENTS = { one: "التزام واحد", two: "التزامين", few: "التزامات", many: "التزاماً" };
const REFUSING = { one: "منتج واحد لا يقبله", two: "منتجان لا يقبلانه", few: "منتجات لا تقبله", many: "منتجاً لا يقبله" };
/** The lenders shown for a kind of finance before the rest is folded. */
const FITS_SHOWN = 3;
const MARKS_SHOWN = 6;
const ARC = "M236 118A106 106 0 0 0 24 118";

/** A point on the arc, a given percent of the way along it. */
function onArc(share: number, radius: number): string {
  const angle = (Math.PI * share) / 100;
  return `${(130 + radius * Math.cos(angle)).toFixed(1)} ${(118 - radius * Math.sin(angle)).toFixed(1)}`;
}

/**
 * The income as a road bent into an arc. The lit part is what the installments take of it, and the
 * coral mark is the ceiling every commitment together may reach.
 */
function ShareArt({ share, cap, className }: { share: number | null; cap: number | null; className: string }) {
  const lit = share == null ? 0 : Math.max(0, Math.min(100, share));
  return (
    <svg className={className} viewBox="0 -8 260 140" fill="none" aria-hidden="true">
      <path d={ARC} stroke="#1d4468" strokeWidth="16" strokeLinecap="round" />
      {lit > 0 && <path className="an-arc-lit" d={ARC} pathLength={100} stroke="#ffc233" strokeWidth="16" strokeLinecap="round" style={{ "--share": lit } as CSSProperties} />}
      <path className="road-dash" d={ARC} stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      {cap != null && <path className="an-arc-cap" d={`M${onArc(cap, 90)}L${onArc(cap, 122)}`} stroke="#ff5a3c" strokeWidth="5" strokeLinecap="round" />}
      {share != null && <circle className="an-arc-dot" cx={onArc(lit, 106).split(" ")[0]} cy={onArc(lit, 106).split(" ")[1]} r="12" fill="#ffc233" stroke="#0f2a43" strokeWidth="4" />}
    </svg>
  );
}

/** The arc with the share said inside it. On a phone the figures under the verdict say it instead. */
function ShareGauge({ share, cap, floor }: { share: number | null; cap: number | null; floor: boolean }) {
  return (
    <div className="verdict-art an-gauge">
      <ShareArt className="an-arc" share={share} cap={cap} />
      {share != null && (
        <p className="an-gauge-say">
          <b className="num">{percent(share)}</b>
          <small>
            نسبة العبء <abbr className="num">DBR</abbr>
            {floor && " · حد أدنى"}
          </small>
        </p>
      )}
    </div>
  );
}

const joined = (parts: (string | null | undefined | false)[]): string => parts.filter(Boolean).join(" · ");

/** A line of the working: what it is, a word on it, and its figure or the words that stand for one. */
function Line({ title, detail, amount, words, tone }: { title: string; detail?: string | null; amount?: number | null; words?: string; tone?: "total" }) {
  return (
    <p className="ledger-line" data-tone={tone}>
      <span>
        {title}
        {detail && <small>{detail}</small>}
      </span>
      {amount != null ? <Num value={amount} /> : <span className="an-words">{words}</span>}
    </p>
  );
}

/** How heavy a mark is. What the record only notes carries no colour. */
const markLevel = (mark: Mark): "block" | "warn" | "good" | undefined =>
  "blocker" in mark ? "block" : "finding" in mark ? (mark.finding.level === "info" ? undefined : mark.finding.level) : "warn";

function Marks({ marks, good }: { marks: Mark[]; good?: boolean }) {
  const row = (mark: Mark, index: number) => (
    <p key={index} className="note" data-level={good ? "good" : markLevel(mark)}>
      <span>
        {markText(mark)} <small className="an-src">{MARK_SOURCE[mark.source]}</small>
      </span>
    </p>
  );
  return (
    <>
      {marks.slice(0, MARKS_SHOWN).map(row)}
      {marks.length > MARKS_SHOWN && (
        <details className="more">
          <summary>اعرض الباقي ({ltr(marks.length - MARKS_SHOWN)})</summary>
          <div>{marks.slice(MARKS_SHOWN).map((mark, index) => row(mark, index + MARKS_SHOWN))}</div>
        </details>
      )}
    </>
  );
}

function FitRow({ fit, salaryBank }: { fit: Fit; salaryBank: string | null }) {
  return (
    <li className="route an-fit">
      <div className="route-who">
        <b>{fit.product.lenderName}</b>
        <small>
          {fit.product.name}
          {salaryBank != null && fit.product.bankCode === salaryBank && " · بنك راتبه"}
        </small>
        <span className="route-state" data-status={fit.status}>
          {FIT_STATUS[fit.status]}
        </span>
      </div>
      <dl className="route-figures">
        <div>
          <dt>القسط</dt>
          <dd>
            <Num value={fit.installment} />
          </dd>
        </div>
        <div>
          <dt>المدة</dt>
          <dd>{months(fit.months)}</dd>
        </div>
        <div>
          <dt>النسبة الفعلية</dt>
          <dd>{percent(fit.apr)}</dd>
        </div>
      </dl>
      <p className="route-keep">
        <small>المبلغ</small>
        <Num value={fit.amount} />
      </p>
      {fit.conditions.length > 0 && (
        <ul className="route-notes">
          {fit.conditions.map((check, index) => (
            <li key={index}>{fitCheckText(check)}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** One kind of finance: the room for it, then the lenders that would give it, best first. */
function KindTile({ k, salaryBank }: { k: KindFit; salaryBank: string | null }) {
  // With something on the record that blocks every lender, the list worth reading is the one after it is cleared.
  const shown = k.cleared ?? k.today;
  const taking = shown.fits.filter((fit) => fit.status !== "fail" && fit.amount > 0);
  const closed = shown.fits.filter((fit) => !taking.includes(fit));
  return (
    <section className="tile tile--wide an-kind">
      <div className="an-kind-head">
        <div>
          <p className="label">الجهات الأنسب</p>
          <h2>{kindTitle(k)}</h2>
        </div>
        <p className="an-room">
          <small>القسط المتاح</small>
          <Num value={k.room.available} />
          <small>{roomRule(k.room)}</small>
        </p>
      </div>
      {k.cleared && taking.length > 0 && <p className="an-after">{AFTER_CLEARING}</p>}
      {taking.length > 0 ? (
        <ol className="routes">
          {taking.slice(0, FITS_SHOWN).map((fit) => (
            <FitRow key={fit.product.id} fit={fit} salaryBank={salaryBank} />
          ))}
        </ol>
      ) : (
        <p className="an-none">{noTaker(k.cleared != null)}</p>
      )}
      {taking.length > FITS_SHOWN && (
        <details className="more routes-closed">
          <summary>اعرض الباقي ({ltr(taking.length - FITS_SHOWN)})</summary>
          <ol className="routes">
            {taking.slice(FITS_SHOWN).map((fit) => (
              <FitRow key={fit.product.id} fit={fit} salaryBank={salaryBank} />
            ))}
          </ol>
        </details>
      )}
      {closed.length > 0 && (
        <details className="more routes-closed">
          <summary>{counted(closed.length, REFUSING)}</summary>
          <div>
            {closed.map((fit) => (
              <p key={fit.product.id} className="note" data-level="block">
                <span>
                  <b>{fit.product.lenderName}</b>، {fit.product.name}: {fit.refusals.length ? fit.refusals.map(fitCheckText).join(" ") : "لا يبقى في دخله قسط لها."}
                </span>
              </p>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

/** Where a step is carried out, for whoever may carry it out. */
function stepDoor(step: Step, at: { clientId: number; deal: { id: number; open: boolean } | null; mayDeal: boolean }): { href: string; label: string } | null {
  const record = `/clients/${at.clientId}/credit`;
  const fresh = at.mayDeal ? { href: `/deals/new?client=${at.clientId}`, label: "ابدأ صفقة" } : null;
  switch (step.code) {
    case "RECORD_CONSENT":
      // Recorded on this page, by a button of its own.
      return null;
    case "COMPLETE_FILE":
      return at.deal?.open && at.mayDeal ? { href: `/deals/${at.deal.id}/edit`, label: "أكمل بيانات الصفقة" } : at.deal?.open ? null : fresh;
    case "REVIEW_READING":
    case "CONFIRM_SUSPENSION":
    case "CREDIT":
      return { href: record, label: "افتح السجل" };
    case "REFRESH_REPORT":
      return { href: record, label: "ارفع تقريراً أحدث" };
    case "FREE_ROOM":
      return at.deal ? { href: `/deals/${at.deal.id}`, label: "افتح الصفقة" } : null;
    case "VERIFY_INCOME":
      return at.deal ? { href: `/deals/${at.deal.id}/documents`, label: "افتح المستندات" } : null;
    case "APPLY":
      return at.deal?.open ? { href: `/deals/${at.deal.id}/lenders`, label: "جهات الصفقة" } : fresh;
  }
}

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireActor("client.view_pii");
  const clientId = Number((await params).id);
  if (!Number.isInteger(clientId) || clientId <= 0) notFound();
  const now = new Date();
  const view = await getAnalysis(await getDb(), { clientId, now });
  if (!view) notFound();

  const { client, deal, record, analysis: a } = view;
  const mayUpload = can(me.role, "doc.upload");
  const mayEdit = can(me.role, "client.edit");
  const mayDeal = can(me.role, "deal.edit");

  const head = (
    <div className="head">
      <div>
        <Link className="back" href={`/clients/${client.id}`}>
          <BackIcon />
          ملف العميل
        </Link>
        <h1 className="title">التحليل الائتماني</h1>
      </div>
      <div className="head-side">
        <p className="where">
          <span className="num">{client.fileNo}</span> · <b>{client.fullName}</b>
          {record?.report.reportDate && <> · تقرير {dayOfRecord(record.report.reportDate)}</>}
        </p>
        {a && <PrintButton />}
      </div>
    </div>
  );

  if (!record || !a) {
    return (
      <>
        {head}
        <section className="empty empty--credit">
          <ShareArt className="an-arc" share={null} cap={null} />
          <h2>لا تحليل قبل التقرير</h2>
          <p>
            {isProjectFile(client)
              ? "ملف مشروع يُدرس على أرضه ودخله في دراسة المشروع. التحليل الائتماني لملفات الأفراد."
              : "التحليل يقرأ ملف العميل وتقرير سمة وشروط الجهات معاً. ارفع تقرير سمة كما نزل من سمة، ونحسب الباقي."}
          </p>
          {mayUpload && !isProjectFile(client) && <ReportUpload clientId={client.id} consented={client.consentAt != null} />}
        </section>
      </>
    );
  }

  const { report, analysis: credit } = record;
  const { grade, stats, banks, financeCompanies } = credit;
  const { income, burden } = a;
  const known = income.basis !== "missing";
  // The ceiling every commitment together may reach, as SAMA sets it for this income.
  const cap = a.kinds.find((k) => k.kind === "mortgage")?.room.totalCap ?? a.kinds[0]?.room.totalCap ?? null;
  const first = a.steps[0];
  const door = first ? stepDoor(first, { clientId: client.id, deal, mayDeal }) : null;
  const products = a.kinds.flatMap((k) => k.today.fits.map((fit) => fit.product));
  const confirmed = products.filter((product) => product.verified).length;

  return (
    <>
      {head}
      <p className="an-paper">{DECISION_SUPPORT}</p>

      <div className="bento an">
        <section className="tile tile--verdict an-verdict" data-verdict={a.verdict === "eligible" || a.verdict === "conditional" ? "go" : "short"}>
          <ShareGauge share={burden.share} cap={cap != null ? cap * 100 : null} floor={burden.uncounted > 0} />
          <div className="verdict-text">
            <p className="label">النتيجة</p>
            <h2 className="verdict-say">{ANALYSIS_VERDICT[a.verdict]}</h2>
            <p className="an-say">{verdictSay(a, stats.totalToClear)}</p>
          </div>
          <dl className="route-figures">
            <div>
              <dt>الدخل المعتمد</dt>
              <dd>{known ? <Num value={income.total} /> : "-"}</dd>
              <small>{INCOME_BASIS[income.basis]}</small>
            </div>
            <div>
              <dt>الالتزامات الشهرية</dt>
              <dd>
                <Num value={burden.monthly} />
              </dd>
              <small>{a.commitments.length ? `من ${counted(a.commitments.length, FROM_COMMITMENTS)}` : "لا التزامات قائمة"}</small>
            </div>
            {burden.share != null && (
              <div className="an-share">
                <dt>
                  نسبة عبء المديونية <abbr className="num">DBR</abbr>
                </dt>
                <dd>{percent(burden.share)}</dd>
                {burden.uncounted > 0 && <small>حد أدنى</small>}
              </div>
            )}
            {cap != null && (
              <div>
                <dt>السقف الكلي</dt>
                <dd>{percent(Math.round(cap * 100))}</dd>
                <small>لمجموع الالتزامات من الدخل</small>
              </div>
            )}
          </dl>
        </section>

        <section className="tile tile--next" data-quiet={!first || undefined}>
          <div>
            <p className="label">{first ? "الخطوة التالية" : "الحالة"}</p>
            <h2>{first ? stepTitle(first) : "لا خطوة مطلوبة"}</h2>
            <p className="due">{first ? stepText(first) : "لا شيء في الملف أو السجل يحتاج إجراء الآن."}</p>
          </div>
          {door && (
            <div className="actions">
              <Link className="btn btn--navy" href={door.href}>
                {door.label}
              </Link>
            </div>
          )}
          {first?.code === "RECORD_CONSENT" && mayEdit && (
            <form className="actions" action={recordConsent}>
              <input type="hidden" name="clientId" value={client.id} />
              <input type="hidden" name="given" value="yes" />
              <SubmitButton className="btn btn--navy">وافق العميل</SubmitButton>
            </form>
          )}
        </section>

        <section className="tile tile--access an-standing">
          <div className="an-standing-head">
            <p className="label">السجل الائتماني: {GRADE[grade].title}</p>
            <Link className="note-link" href={`/clients/${client.id}/credit`}>
              افتح السجل
            </Link>
          </div>
          <ul>
            <DoorRow name="البنوك" door={banks} />
            <DoorRow name="شركات التمويل" door={financeCompanies} />
          </ul>
        </section>

        <section className="tile tile--wide an-working">
          <p className="label">الالتزامات ونسبة العبء، خطوة خطوة</p>
          <div className="ledger-grid">
            <div className="ledger-section">
              <h3>1. ما يدفعه كل شهر، من تقرير سمة</h3>
              {a.commitments.map((c, index) => (
                <Line
                  key={index}
                  title={c.lender}
                  detail={joined([c.product, c.late && "عليه متأخرات", c.balance != null && `الرصيد ${money(c.balance)}`])}
                  amount={c.monthly}
                  words={noInstallment(c)}
                />
              ))}
              {!a.commitments.length && <p className="ledger-none">لا التزامات قائمة في التقرير.</p>}
              <Line title="مجموع الأقساط" amount={burden.monthly} tone="total" />
              {burden.uncounted > 0 && <p className="an-floor">{floorText(burden.uncounted)}</p>}
            </div>

            <div className="ledger-section">
              <h3>2. الدخل المعتمد</h3>
              {known ? (
                <>
                  <Line title={income.basicOnly ? "الراتب الأساسي" : "الراتب الإجمالي"} detail={income.basicOnly ? "الإجمالي غير مدخل" : null} amount={income.salary} />
                  {income.other > 0 && <Line title="نصف الدخل الإضافي" detail="يُحتسب نصفه" amount={income.other} />}
                  <Line title="الدخل المعتمد" detail={INCOME_BASIS[income.basis]} amount={income.total} tone="total" />
                </>
              ) : (
                <p className="ledger-none">الراتب غير مدخل في الملف.</p>
              )}
            </div>

            <div className="ledger-section">
              <h3>3. النسبة والقسط المتاح</h3>
              {burden.share != null ? (
                <p className="ledger-line">
                  <span>
                    الأقساط من الدخل
                    <small>
                      <span className="num">
                        {plainMoney(burden.monthly)} ÷ {plainMoney(income.total)}
                      </span>
                    </small>
                  </span>
                  <span>{percent(burden.share)}</span>
                </p>
              ) : (
                <p className="ledger-none">لا نسبة قبل إدخال الراتب.</p>
              )}
              {a.kinds.map((k) => (
                <Line key={k.kind} title={`المتاح لقسط ${kindTitle(k)}`} detail={roomRule(k.room)} amount={k.room.available} />
              ))}
            </div>
          </div>
        </section>

        <section className="tile an-half an-good">
          <p className="label">نقاط القوة</p>
          {a.strengths.length ? <Marks marks={a.strengths} good /> : <p className="an-none">لا نقاط قوة ظاهرة في الملف أو التقرير.</p>}
        </section>

        <section className="tile tile--notes an-half">
          <p className="label">المخاطر</p>
          {a.risks.length ? <Marks marks={a.risks} /> : <p className="an-none">لا مخاطر ظاهرة في الملف أو التقرير.</p>}
        </section>

        {a.kinds.map((k) => (
          <KindTile key={k.kind} k={k} salaryBank={view.file.salaryBank} />
        ))}

        <section className="tile tile--plan">
          <p className="label">التوصيات بالترتيب</p>
          {a.steps.length ? (
            <ol className="plan">
              {a.steps.map((step, index) => (
                <li key={index}>
                  <b className="num">{index + 1}</b>
                  <div>
                    <h3>{stepTitle(step)}</h3>
                    <p>{stepText(step)}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="an-none">لا خطوة مطلوبة الآن.</p>
          )}
        </section>

        <section className="tile tile--five an-gaps">
          <p className="label">الناقص وغير المؤكد</p>
          {a.gaps.map((gap, index) => (
            <div key={index} className="an-gap" data-kind={gap.kind}>
              <span className="an-gap-kind">{GAP_KIND[gap.kind]}</span>
              <p>{gapText(gap)}</p>
            </div>
          ))}
          {!a.gaps.length && <p className="an-none">لا شيء ناقص، وكل ما بُني عليه مؤكد.</p>}
        </section>

        <section className="tile tile--wide an-foot">
          <p className="an-support">{DECISION_SUPPORT}</p>
          <dl className="facts">
            <div>
              <dt>الملف</dt>
              <dd className="num">{client.fileNo}</dd>
            </div>
            <div>
              <dt>تقرير سمة</dt>
              <dd>{report.reportDate ? dayOfRecord(report.reportDate) : "بلا تاريخ"}</dd>
            </div>
            <div>
              <dt>قُرئ التقرير</dt>
              <dd>{dayFull(record.createdAt)}</dd>
            </div>
            <div>
              <dt>شروط الجهات</dt>
              <dd>{products.length ? `${ltr(products.length)} منتجاً، المؤكد منها ${ltr(confirmed)}` : "لا جهات في القائمة"}</dd>
            </div>
            <div>
              <dt>موافقة العميل</dt>
              <dd>{client.consentAt ? dayFull(client.consentAt) : "غير مسجلة"}</dd>
              {client.consentAt && mayEdit && (
                <details className="an-consent">
                  <summary>سحبها العميل؟</summary>
                  <form action={recordConsent}>
                    <input type="hidden" name="clientId" value={client.id} />
                    <input type="hidden" name="given" value="no" />
                    <p>{CONSENT_WITHDRAWN}</p>
                    <SubmitButton className="btn btn--soft">سجّل السحب</SubmitButton>
                  </form>
                </details>
              )}
            </div>
            <div>
              <dt>يوم التحليل</dt>
              <dd>{dayFull(now)}</dd>
            </div>
          </dl>
        </section>
      </div>
    </>
  );
}
