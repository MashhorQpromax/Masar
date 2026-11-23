import type { ReactNode } from "react";
import { dayOf } from "@/copy/format";
import { acceptedText, askText, DECISION, ratioText, refusalText, RULE_KIND, similarText } from "@/copy/knowledge";
import { FEW_DECISIONS, type Experience, type Rule } from "@/domain/knowledge";
import type { DecisionLine } from "@/server/knowledge/service";
import { Num } from "./Num";

/** More answers than this are drawn as one bar instead of a stop for each. */
const STOPS_SHOWN = 14;

/**
 * What a lender answered so far: a stop for each answer, lit when it said yes, then how its amounts
 * compare and what it asks for. With `similar`, the answers to clients like the one on screen are said too.
 */
export function AnswerRow({ name, e, similar = false }: { name: string; e: Experience; similar?: boolean }) {
  return (
    <li className="answer">
      <div className="answer-who">
        <b>{name}</b>
        <small>
          {acceptedText(e)}
          {e.n < FEW_DECISIONS && " · قليل للحكم"}
        </small>
        {similar && e.similarN > 0 && e.similarN < e.n && <small>{similarText(e)}</small>}
      </div>
      {e.n <= STOPS_SHOWN ? (
        <p className="answer-stops" aria-hidden="true">
          {Array.from({ length: e.n }, (_, index) => (
            <i key={index} data-yes={index < e.approved || undefined} style={{ animationDelay: `${0.25 + index * 0.05}s` }} />
          ))}
        </p>
      ) : (
        <p className="answer-bar" aria-hidden="true">
          <i style={{ flexGrow: e.approved }} data-yes />
          <i style={{ flexGrow: e.rejected }} />
        </p>
      )}
      <p className="answer-ratio">{e.ratio != null && ratioText(e.ratio)}</p>
      {(e.conditions.length > 0 || e.reasons.length > 0) && (
        <ul className="answer-chips">
          {e.conditions.slice(0, 4).map(([code, times]) => (
            <li key={`ask-${code}`}>
              تطلب {askText(code)}
              {times > 1 && <b className="num">{times}</b>}
            </li>
          ))}
          {e.reasons.slice(0, 3).map(([code, times]) => (
            <li key={`no-${code}`} data-no>
              ترفض بسبب {refusalText(code)}
              {times > 1 && <b className="num">{times}</b>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Something a person wrote down about a lender. `meta` is the small line under it, and what follows it is what can be done with it. */
export function NoteRow({ rule, meta, children }: { rule: Rule; meta: string; children?: ReactNode }) {
  return (
    <li className="know-note">
      <span className="know-kind" data-kind={rule.kind}>
        {RULE_KIND[rule.kind]}
      </span>
      <div className="know-text">
        <b>{rule.title}</b>
        {rule.body && <p>{rule.body}</p>}
        <small>{meta}</small>
      </div>
      {children}
    </li>
  );
}

/**
 * One answer a lender gave: when, which lender, what it decided, the amount against what was expected,
 * and what it asked for or why it refused. `sub` is the line under the lender's name.
 */
export function DecisionRow({ line, now, sub }: { line: DecisionLine; now: Date; sub: string }) {
  const said = line.decision === "rejected" ? (line.reason ? refusalText(line.reason) : "") : line.asks.map(askText).join("، ");
  return (
    <li className="latest">
      <time>{dayOf(line.createdAt, now)}</time>
      <div className="latest-who">
        <b>{line.lenderName}</b>
        <small>{sub}</small>
      </div>
      <span className="decision" data-decision={line.decision}>
        {DECISION[line.decision]}
      </span>
      <p className="latest-sums">
        {line.approvedAmount != null ? (
          <>
            <Num value={line.approvedAmount} />
            {line.estimatedAmount != null && line.estimatedAmount !== line.approvedAmount && (
              <small>
                من تقدير <Num value={line.estimatedAmount} />
              </small>
            )}
          </>
        ) : (
          line.estimatedAmount != null && (
            <small>
              تقديرنا <Num value={line.estimatedAmount} />
            </small>
          )
        )}
      </p>
      {(said || line.note) && (
        <p className="latest-said">
          {said}
          {said && line.note ? ". " : ""}
          {line.note}
        </p>
      )}
    </li>
  );
}
