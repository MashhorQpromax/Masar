import type { Metadata } from "next";
import { paperLabel } from "@/copy/documents";
import { dayShort, ltr, percent, plainMoney } from "@/copy/format";
import { about, CLIENT_NOW, CLIENT_STEP, ESTIMATE_NOTE, feeItemWhat, firstName, hasEstimate, OFFER, OFFER_COST } from "@/copy/messages";
import { dataMode, getDb } from "@/server/db/client";
import { portalView, type PortalPaper } from "@/server/messages/portal";
import { Certain } from "@/ui/Certain";
import { CheckIcon, Mark } from "@/ui/icons";
import { PaperUpload } from "@/ui/PaperUpload";
import { sendPaper } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ملفك · مسار", robots: { index: false, follow: false }, referrer: "no-referrer" };

const PART = { mortgage: "تمويل عقاري", personal: "تمويل شخصي" } as const;

/**
 * The client's own page. A link opens it, with no account and no password, so it shows only what a
 * client may know: where their file stands, what they end with, the papers they still owe, and, once
 * the fee plan is approved, their final offer with the office's fee in detail.
 */
export default async function ClientPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await portalView(await getDb(), { token, count: true });
  const demo = dataMode() === "demo";

  if (!view) {
    return (
      <div className="portal">
        <header className="portal-top">
          <span className="brand">
            <Mark />
            مسار
          </span>
        </header>
        <main className="portal-body">
          <section className="tile portal-shut">
            <h1>انتهت صلاحية الرابط</h1>
            <p>اطلب رابطاً جديداً من مسؤول ملفك.</p>
          </section>
        </main>
      </div>
    );
  }

  const first = firstName(view.clientName);
  const name = (paper: PortalPaper) => paperLabel(paper, view.who);
  const total = view.owed.length + view.arrived.length;
  const done = view.steps.every((step) => step.state === "done");

  return (
    <div className="portal">
      <header className="portal-top">
        <span className="brand">
          <Mark />
          مسار
        </span>
        {demo && (
          <p className="chip">
            <i className="chip-dot" aria-hidden="true" />
            بيانات تجريبية
          </p>
        )}
      </header>

      <main className="portal-body">
        <section className="tile portal-hero">
          <p className="label">
            ملف <span className="num">{view.fileNo}</span>
          </p>
          <h1 className="portal-hello">{first ? `أهلاً ${first}` : "أهلاً بك"}</h1>
          <p className="portal-now">{CLIENT_NOW[view.stage]}</p>
          <ol className="trail" aria-label="أين وصل ملفك">
            {view.steps.map((step) => (
              <li key={step.key} data-state={done ? "done" : step.state} aria-current={step.state === "current" ? "step" : undefined}>
                <i aria-hidden="true">{(done || step.state === "done") && <CheckIcon size={14} />}</i>
                <span>{CLIENT_STEP[step.key]}</span>
                {step.state === "current" && <small>الآن</small>}
              </li>
            ))}
          </ol>
        </section>

        {/* Once the fee plan is approved the client reads the whole sum: the financing, what is paid out of it, the fee item by item, and what is left. */}
        {view.offer && (
          <section className="tile portal-plan">
            <p className="label">{OFFER.title}</p>
            <p className="portal-keep">
              <span>{OFFER.keeps}</span>
              <b className="num">{plainMoney(view.offer.keeps)}</b>
              <span>ريال</span>
              <Certain value={view.offer.certainty} />
            </p>
            <div className="offer">
              <h2>{OFFER.financing}</h2>
              <ul>
                {view.offer.financing.map((part) => (
                  <li key={part.part}>
                    <span>
                      {PART[part.part]} <Certain value={part.certainty} />
                    </span>
                    <b className="num">{plainMoney(part.amount)}</b>
                  </li>
                ))}
              </ul>
              {(view.offer.obligations || view.offer.costs.length > 0) && (
                <>
                  <h2>{OFFER.out}</h2>
                  <ul>
                    {view.offer.obligations && (
                      <li>
                        <span>
                          {OFFER.obligations} {view.offer.obligations.certainty === "estimated" && <Certain value="estimated" />}
                        </span>
                        <b className="num">{plainMoney(-view.offer.obligations.amount)}</b>
                      </li>
                    )}
                    {view.offer.costs.map((cost) => (
                      <li key={cost.kind}>
                        <span>
                          {OFFER_COST[cost.kind]} <Certain value="estimated" />
                        </span>
                        <b className="num">{plainMoney(-cost.amount)}</b>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <h2>{OFFER.fee}</h2>
              {view.offer.fee.items.length === 0 ? (
                <p className="offer-none">{OFFER.noFee}.</p>
              ) : (
                <ul>
                  {view.offer.fee.items.map((item) => (
                    <li key={item.kind}>
                      <span>
                        {item.kind !== "fixed" && <>{percent(item.pct)} </>}
                        {feeItemWhat(item)}
                        {item.kind !== "fixed" && (
                          <small>
                            من <span className="num">{plainMoney(item.base)}</span> ريال
                          </small>
                        )}
                      </span>
                      <b className="num">{plainMoney(-item.amount)}</b>
                    </li>
                  ))}
                  {view.offer.fee.items.length > 1 && (
                    <li className="offer-sum">
                      <span>
                        {OFFER.feeTotal} {view.offer.fee.certainty === "estimated" && <Certain value="estimated" />}
                      </span>
                      <b className="num">{plainMoney(-view.offer.fee.total)}</b>
                    </li>
                  )}
                </ul>
              )}
            </div>
            <p className="portal-fine">{view.offer.certainty === "estimated" ? ESTIMATE_NOTE : OFFER.written}</p>
          </section>
        )}

        {view.facts && !view.offer && (
          <section className="tile portal-plan">
            <p className="label">{view.facts.offered ? "عرض تمويلك" : "المتوقع لك"}</p>
            {view.facts.keeps > 0 && (
              <p className="portal-keep">
                <span>{view.facts.keepsCertainty === "confirmed" ? "يبقى لك" : "يبقى لك نحو"}</span>
                <b className="num">{view.facts.keepsCertainty === "confirmed" ? plainMoney(view.facts.keeps) : about(view.facts.keeps)}</b>
                <span>ريال</span>
                <Certain value={view.facts.keepsCertainty} />
              </p>
            )}
            {view.facts.financing.length > 0 && (
              <dl className="portal-figures">
                {view.facts.financing.map((part) => (
                  <div key={part.part}>
                    <dt>{PART[part.part]}</dt>
                    <dd>
                      <span className="num">{part.certainty === "confirmed" ? plainMoney(part.amount) : about(part.amount)}</span> ريال <Certain value={part.certainty} />
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="portal-fine">{hasEstimate(view.facts) ? ESTIMATE_NOTE : "الأرقام من عرض الجهة المكتوب."}</p>
          </section>
        )}

        <section className="tile portal-papers">
          <div className="portal-papers-head">
            <h2>مستنداتك</h2>
            {total > 0 && (
              <p>
                وصلنا {ltr(view.arrived.length)} من {ltr(total)}
              </p>
            )}
          </div>
          {view.owed.length === 0 ? (
            <p className="note" data-level="good">
              <span>وصلتنا كل مستنداتك. شكراً لك.</span>
            </p>
          ) : (
            <>
              <p className="portal-say">صورة واضحة أو ملف PDF لكل مستند.</p>
              <ul className="portal-owed">
                {view.owed.map((paper) => (
                  <li key={paper.code}>
                    <div>
                      <b>{name(paper)}</b>
                      {paper.status === "rejected" && <p className="paper-why">نحتاجه من جديد{paper.note ? `: ${paper.note}` : ""}</p>}
                    </div>
                    <PaperUpload send={sendPaper.bind(null, token, paper.code)} name={name(paper)} look="navy" />
                  </li>
                ))}
              </ul>
            </>
          )}
          {view.arrived.length > 0 && (
            <ul className="portal-arrived">
              {view.arrived.map((paper) => (
                <li key={paper.code}>
                  <CheckIcon size={16} />
                  <span>{name(paper)}</span>
                  <small>{paper.status === "verified" ? "تحققنا منه" : "وصلنا"}</small>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="portal-foot">صفحة خاصة بك، صالحة حتى {dayShort(view.expiresAt)}.</p>
      </main>
    </div>
  );
}
