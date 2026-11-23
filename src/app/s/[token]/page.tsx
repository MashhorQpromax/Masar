import type { Metadata } from "next";
import { paperLabel } from "@/copy/documents";
import { dayShort, ltr } from "@/copy/format";
import { about, CLIENT_NOW, CLIENT_STEP, firstName } from "@/copy/messages";
import { dataMode, getDb } from "@/server/db/client";
import { portalView, type PortalPaper } from "@/server/messages/portal";
import { CheckIcon, Mark } from "@/ui/icons";
import { PaperUpload } from "@/ui/PaperUpload";
import { sendPaper } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ملفك · مسار", robots: { index: false, follow: false }, referrer: "no-referrer" };

const PART = { mortgage: "تمويل عقاري", personal: "تمويل شخصي" } as const;

/**
 * The client's own page. A link opens it, with no account and no password, so it shows only what a
 * client may know: where their file stands, what they end with, and the papers they still owe.
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

        {view.facts && (
          <section className="tile portal-plan">
            <p className="label">{view.facts.offered ? "عرض تمويلك" : "المتوقع لك"}</p>
            {view.facts.keeps > 0 && (
              <p className="portal-keep">
                <span>يبقى لك نحو</span>
                <b className="num">{about(view.facts.keeps)}</b>
                <span>ريال</span>
              </p>
            )}
            {view.facts.financing.length > 0 && (
              <dl className="portal-figures">
                {view.facts.financing.map((part) => (
                  <div key={part.part}>
                    <dt>{PART[part.part]}</dt>
                    <dd>
                      <span className="num">{about(part.amount)}</span> ريال
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="portal-fine">أرقام تقديرية حتى موافقة الجهة والتقييم الرسمي.</p>
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
