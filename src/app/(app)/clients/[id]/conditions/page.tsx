import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ANSWER, askedLabel, askedOpenText, FINANCE_TYPE, UNMET } from "@/copy/eligibility";
import { agoText } from "@/copy/messages";
import { can } from "@/domain/auth";
import type { Answer } from "@/domain/eligibility";
import { requireActor } from "@/server/auth/actor";
import { getAsked, type AskedCondition } from "@/server/clients/conditions";
import { getDb } from "@/server/db/client";
import { BackIcon } from "@/ui/icons";
import { answerAsked } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "شروط الجهات الخاصة · مسار" };

const ANSWERS: Answer[] = ["met", "unmet"];

/** One question with its answer. Whoever may change the file answers with one press, and may take the answer back. */
function Asked({ clientId, condition, mayAnswer, now }: { clientId: number; condition: AskedCondition; mayAnswer: boolean; now: Date }) {
  return (
    <li className="asked" data-answer={condition.answer ?? "open"}>
      <div className="asked-text">
        <b>{askedLabel(condition)}</b>
        <small>
          {condition.answer && condition.answeredAt
            ? [`${UNMET[condition.unmet]}`, condition.answeredBy && `أجاب ${condition.answeredBy}`, agoText(condition.answeredAt, now)].filter(Boolean).join(" · ")
            : `${UNMET[condition.unmet]} · لم يُجب عنه، فلا يُحسب مستوفى`}
        </small>
      </div>
      {mayAnswer ? (
        <form action={answerAsked} className="asked-answer">
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="conditionId" value={condition.id} />
          <div className="seg" role="radiogroup" aria-label={askedLabel(condition)}>
            {ANSWERS.map((answer) => (
              <button key={answer} type="submit" name="answer" value={answer} role="radio" aria-checked={condition.answer === answer}>
                {ANSWER[answer]}
              </button>
            ))}
          </div>
          {condition.answer && (
            <button type="submit" name="answer" value="" className="asked-back">
              اسحب الجواب
            </button>
          )}
        </form>
      ) : (
        <span className="route-state" data-status={condition.answer === "met" ? "pass" : condition.answer === "unmet" ? "fail" : "warn"}>
          {condition.answer ? ANSWER[condition.answer] : "لم يُجب"}
        </span>
      )}
    </li>
  );
}

export default async function ConditionsPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireActor("client.view_pii");
  const clientId = Number((await params).id);
  if (!Number.isInteger(clientId) || clientId <= 0) notFound();
  const view = await getAsked(await getDb(), { clientId });
  if (!view) notFound();
  const mayAnswer = can(me.role, "client.edit");
  const now = new Date();

  return (
    <>
      <div className="head">
        <div>
          <Link className="back" href={`/clients/${view.client.id}`}>
            <BackIcon />
            ملف العميل
          </Link>
          <h1 className="title">شروط الجهات الخاصة</h1>
        </div>
        <div className="head-side">
          <p className="where">
            <span className="num">{view.client.fileNo}</span> · <b>{view.client.fullName}</b>
            {view.lenders.length > 0 && <> · {askedOpenText(view.open)}</>}
          </p>
        </div>
      </div>

      {!view.lenders.length ? (
        <section className="empty">
          <h2>لا جهة تسأل عن العميل شيئاً</h2>
          <p>حين يُسجَّل لجهة شرط يُجاب عنه لكل عميل، مثل كفيل أو اعتماد جهة العمل، يظهر هنا لتُسجَّل إجابة هذا العميل.</p>
        </section>
      ) : (
        <div className="bento">
          {/* Said while something is left to ask. Once every question has its answer, the list speaks for itself. */}
          {view.open > 0 && (
            <section className="tile tile--wide tile--notes">
              <p className="note" data-level="warn">
                هذه شروط لا يقيسها النظام من الملف ولا من سمة. اسأل العميل وسجّل جوابه عن كل شرط. الشرط الذي لم يُجب عنه لا يُحسب مستوفى، وتبقى الجهة عنده «بحاجة إلى تحقق».
              </p>
            </section>
          )}
          {view.lenders.map((lender) => (
            <section key={lender.id} className="tile tile--lender tile--asked">
              <h2 className="lender-name">{lender.name}</h2>
              {lender.products.map((product) => (
                <div key={product.id} className="asked-product">
                  <p className="product-name">
                    <b>{FINANCE_TYPE[product.financeType]}</b>
                    <small>{product.name}</small>
                  </p>
                  <ul className="asked-list">
                    {product.conditions.map((condition) => (
                      <Asked key={condition.id} clientId={view.client.id} condition={condition} mayAnswer={mayAnswer} now={now} />
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
