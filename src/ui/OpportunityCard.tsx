import { ELIGIBILITY, routeDoubtLines, routeFindingText } from "@/copy/funding";
import { NET_DEFICIT } from "@/copy/net";
import {
  assumptionLabel,
  assumptionSource,
  cardLenders,
  CONFIDENCE,
  COST_SAY,
  financingDiffText,
  FOOTING,
  OPPORTUNITY_CLASS,
  reasonText,
  ROAD,
  SETTLE_WARNING,
  SETTLED_BEFORE,
  waitLines,
} from "@/copy/opportunity";
import type { OpportunityCard as Card } from "@/domain/opportunity";
import { Certain } from "./Certain";
import { Num } from "./Num";

/**
 * One opportunity, read in the order the office decides on it: whether the lenders take the client,
 * what it costs, what the office takes, what the client keeps, and the verdict. Beneath, how far each
 * thing it rests on can be relied on, and where it comes from. The screen and the saved report both
 * draw it from the same card, so they agree to the riyal.
 */
export function OpportunityCard({ card, rank, open, plan }: { card: Card; rank: number; open: boolean; plan?: string | null }) {
  const names = cardLenders(card);
  const short = card.net.net < 0;
  const lines = [...card.blockers, ...card.actions].map((finding) => routeFindingText(finding, card));
  const doubts = card.class === "theoretical" ? routeDoubtLines(card) : [];
  return (
    <article className="opp" data-class={card.class} data-chosen={card.chosen || undefined} aria-label={`${names.main} · ${OPPORTUNITY_CLASS[card.class]}`}>
      <header className="opp-head">
        <span className="opp-rank num" aria-hidden="true">
          {rank}
        </span>
        <div className="opp-who">
          <h3>{names.main}</h3>
          {names.also && <small>{names.also}</small>}
        </div>
        <div className="opp-tags">
          {card.chosen && <span className="opp-chosen">الخطة المختارة{plan ? ` · ${plan}` : ""}</span>}
          <span className="opp-class" data-class={card.class}>
            {OPPORTUNITY_CLASS[card.class]}
          </span>
          <span className="opp-confidence" data-confidence={card.confidence}>
            {CONFIDENCE[card.confidence]}
          </span>
        </div>
      </header>

      <ol className="opp-road" aria-label="طريق القرار">
        <li data-step="eligibility" data-result={card.eligibility}>
          <span className="opp-step">{ROAD.eligibility}</span>
          <b>{ELIGIBILITY[card.eligibility]}</b>
        </li>
        <li data-step="cost">
          <span className="opp-step">{ROAD.cost}</span>
          <Num value={card.cost} />
          <small>{COST_SAY}</small>
        </li>
        <li data-step="fee">
          <span className="opp-step">{ROAD.fee}</span>
          <Num value={card.fee} />
        </li>
        <li data-step="net" data-deficit={short || undefined}>
          <span className="opp-step">{short ? NET_DEFICIT : ROAD.net}</span>
          <Num value={Math.abs(card.net.net)} />
          <Certain value={card.net.certainty} />
        </li>
        <li data-step="verdict" data-class={card.class}>
          <span className="opp-step">{ROAD.verdict}</span>
          <b>{OPPORTUNITY_CLASS[card.class]}</b>
        </li>
      </ol>

      <dl className="opp-figures">
        <div>
          <dt>التمويل الجديد</dt>
          <dd>
            <Num value={card.financing} />
            <small className="opp-diff" data-sign={Math.sign(card.financingDiff)}>
              {financingDiffText(card.financingDiff)}
            </small>
          </dd>
        </div>
        <div>
          <dt>القسط الشهري</dt>
          <dd>
            <Num value={card.monthly} />
          </dd>
        </div>
      </dl>

      <div className="opp-why">
        {card.reasons.map((reason, index) => (
          <p key={`r${index}`} data-first={index === 0 || undefined}>
            {reasonText(reason)}
          </p>
        ))}
        {lines.map((line, index) => (
          <p key={`l${index}`} className="opp-line">
            {line}
          </p>
        ))}
        {doubts.slice(0, 4).map((line, index) => (
            <p key={`d${index}`} className="opp-line" data-doubt>
              {line}
            </p>
          ))}
      </div>

      {card.settlement && (
        <div className="opp-settle" role="note">
          <p>{card.settlement.pays ? SETTLE_WARNING : SETTLED_BEFORE}</p>
          {waitLines(card.settlement).length > 0 && (
            <ul>
              {waitLines(card.settlement).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <details className="opp-sources" open={open}>
        <summary>مصدر كل افتراض</summary>
        <ul>
          {card.assumptions.map((a, index) => (
            <li key={index} data-footing={a.footing}>
              <span className="opp-footing">{FOOTING[a.footing]}</span>
              <div>
                <b>{assumptionLabel(a)}</b>
                <small>{assumptionSource(a)}</small>
              </div>
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}
