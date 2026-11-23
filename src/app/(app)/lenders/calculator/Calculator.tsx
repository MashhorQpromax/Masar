"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState, type CSSProperties } from "react";
import { conditionDetail, conditionExit, conditionTitle, CONDITION_LEVEL, EFFORT, wayDetail, waySteps, wayTitle } from "@/copy/advisor";
import { afterRetirementText, heldByText, largestOfferText, othersText, QUICK_VERDICT, RECORD_STANDING, refusingText, stepsDownText, takingText, upToText, WAYS_BASIS } from "@/copy/calculator";
import { SECTOR } from "@/copy/editor";
import { capacityWarningText, checkText, STUDY_VERDICT } from "@/copy/eligibility";
import { months, percent, plainMoney } from "@/copy/format";
import { BY_WORD, ELIGIBILITY, strictLines, strictRefusalLines } from "@/copy/funding";
import {
  advise,
  largestOffer,
  openOffers,
  QUICK_DEFAULTS,
  quickBasicSalary,
  quickProfile,
  quickVerdict,
  strictMatch,
  type Capacity,
  type Check as Asked,
  type Condition,
  type Match,
  type Product,
  type QuickFacts,
  type QuickFinanceType,
  type WayOut,
} from "@/domain/eligibility";
import { Check, NumberField, Segmented, SelectField } from "@/ui/fields";
import { ChevronIcon } from "@/ui/icons";
import { Num } from "@/ui/Num";

/** The salaries the slider covers. A salary outside them is typed. */
const SALARY_MIN = 3000;
const SALARY_MAX = 60000;
const SALARY_STEP = 500;
/** How many lenders, ways and conditions are shown before the rest is asked for. */
const LENDERS_SHOWN = 4;
const WAYS_SHOWN = 5;
const CONDITIONS_SHOWN = 5;

const CLIMB = "M250 108H208C184 108 180 65 156 65H140C116 65 112 22 88 22H74";

/** A road that climbs in steps to the amount. Its end turns coral when no lender takes the client. */
function ClimbArt({ none }: { none: boolean }) {
  return (
    <svg className="verdict-art fork" viewBox="0 0 260 130" fill="none" aria-hidden="true" data-none={none || undefined}>
      <path d={CLIMB} stroke="#1d4468" strokeWidth="16" strokeLinecap="round" />
      <path className="road-dash" d={CLIMB} stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      <circle className="climb-step" cx="250" cy="108" r="8" fill="#0f2a43" stroke="#34536f" strokeWidth="4" />
      <circle className="climb-step" cx="148" cy="65" r="8" fill="#0f2a43" stroke="#34536f" strokeWidth="4" />
      <circle className="fork-end" cx="58" cy="22" r="16" fill="#ffc233" />
    </svg>
  );
}

const wayKey = (way: WayOut): string => (way.code === "SETTLE" ? `SETTLE-${way.params.index}` : way.code);

/** The month's income in three parts: what is already owed, what a new installment may take, what is left. */
function Split({ capacity }: { capacity: Capacity }) {
  const { income, existingTotal: owed, available: room } = capacity;
  const left = Math.max(0, income - owed - room);
  const share = (part: number): CSSProperties => ({ flexBasis: `${Math.min(100, (part / income) * 100)}%` });
  return (
    <div className="split">
      <p className="split-head">
        <span>من دخله الشهري</span> <Num value={income} />
      </p>
      <div className="split-bar" aria-hidden="true">
        <span data-part="owed" data-none={owed <= 0 || undefined} style={share(owed)} />
        <span data-part="room" data-none={room <= 0 || undefined} style={share(room)} />
        <span data-part="left" data-none={left <= 0 || undefined} />
      </div>
      <dl className="split-legend">
        <div data-part="owed">
          <dt>التزاماته</dt>
          <dd>
            <Num value={owed} />
          </dd>
        </div>
        <div data-part="room">
          <dt>قسط جديد متاح</dt>
          <dd>
            <Num value={room} />
          </dd>
        </div>
        <div data-part="left">
          <dt>يبقى له</dt>
          <dd>
            <Num value={left} />
          </dd>
        </div>
      </dl>
      {room > 0 && <p className="split-rule">{heldByText(capacity)}</p>}
    </div>
  );
}

function LenderRow({ match }: { match: Match }) {
  const steps = match.retirement && match.retirement.after < match.installment ? match.retirement.after : null;
  const read = strictMatch(match);
  // The installment after retirement stands under the installment, so here it is only named.
  const say = (check: Asked): string => (check.code === "RETIRES_IN_TERM" && steps != null ? stepsDownText(check.params.months) : checkText(check));
  const lines = strictLines(read, say);
  return (
    <li className="route">
      <div className="route-who">
        <b>{match.product.lenderName}</b>
        <small>{match.product.name}</small>
        <span className="route-state" data-result={read.eligibility}>
          {ELIGIBILITY[read.eligibility]}
        </span>
      </div>
      <dl className="route-figures">
        <div>
          <dt>القسط الشهري</dt>
          <dd>
            <Num value={match.installment} />
          </dd>
          {steps != null && <small>{afterRetirementText(steps)}</small>}
        </div>
        <div>
          <dt>المدة</dt>
          <dd>{months(match.tenor)}</dd>
        </div>
        <div>
          <dt>النسبة الفعلية</dt>
          <dd>{percent(match.apr)}</dd>
        </div>
      </dl>
      <p className="route-keep">
        <small>المبلغ</small>
        <Num value={match.offerPrincipal} />
        {match.maxPrincipal > match.offerPrincipal && <small>{upToText(match.maxPrincipal)}</small>}
      </p>
      {lines.length > 0 && (
        <ul className="route-notes">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Way({ way }: { way: WayOut }) {
  return (
    <details className="lift">
      <summary>
        <span className="lift-what">
          <b>{wayTitle(way)}</b>
          <small>{EFFORT[way.effort]}</small>
        </span>
        <span className="lift-gain">
          {way.gain > 0 ? (
            <>
              <b className="num">+{plainMoney(way.gain)}</b>
              <small>
                إلى <Num value={way.amount} />
              </small>
            </>
          ) : way.lifts ? (
            <>
              <b>{STUDY_VERDICT[way.verdictAfter]}</b>
              <small>
                {way.gain === 0 ? (
                  "بالمبلغ نفسه"
                ) : (
                  <>
                    المبلغ <Num value={way.amount} />
                  </>
                )}
              </small>
            </>
          ) : (
            <>
              <b className="num">{plainMoney(way.amount)}</b>
              <small>المبلغ بعدها</small>
            </>
          )}
        </span>
        <ChevronIcon />
      </summary>
      <div className="lift-more">
        <p>{wayDetail(way)}</p>
        <ol>
          {waySteps(way).map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
    </details>
  );
}

function MayAsk({ condition }: { condition: Condition }) {
  const exit = conditionExit(condition);
  return (
    <details className="cond">
      <summary>
        <span className="note" data-level={condition.level}>
          <span>
            {conditionTitle(condition)}
            {condition.level !== "info" && <small>{CONDITION_LEVEL[condition.level]}</small>}
          </span>
        </span>
        <ChevronIcon />
      </summary>
      <div className="cond-more">
        <p>{conditionDetail(condition)}</p>
        {exit && (
          <p>
            <b>ما العمل:</b> {exit}
          </p>
        )}
      </div>
    </details>
  );
}

/** A first answer from a few facts. The engine runs here, on the lenders' terms, as each number is typed. */
export function Calculator({ products, kinds, first }: { products: Product[]; kinds: Record<QuickFinanceType, string>; first: QuickFinanceType }) {
  const [facts, setFacts] = useState<QuickFacts>({ ...QUICK_DEFAULTS, financeType: first });
  const set =
    <K extends keyof QuickFacts>(key: K) =>
    (value: QuickFacts[K]) =>
      setFacts((before) => ({ ...before, [key]: value }));

  // The slider moves faster than the answer needs to follow.
  const settled = useDeferredValue(facts);
  const answer = useMemo(() => advise(quickProfile(settled), products), [settled, products]);

  const mortgage = facts.financeType === "mortgage";
  const salary = facts.totalSalary ?? 0;
  const onSlider = Math.min(SALARY_MAX, Math.max(SALARY_MIN, salary));
  const assumedBasic = quickBasicSalary({ totalSalary: facts.totalSalary, basicSalary: null });

  const asked = !!settled.totalSalary;
  const open = openOffers(answer);
  const closed = answer.matches.filter((match) => match.verdict === "fail");
  const top = largestOffer(answer);
  const verdict = quickVerdict(answer);
  // The figure beside the result is the named lender's own: a confirmed result is never said with an unconfirmed lender's amount.
  const best = top?.maxPrincipal ?? 0;
  // A yes on an employee's word says so where the result is said, not only in the lender's row.
  const named = top ? strictMatch(top) : null;
  const byWord = !!named && (named.eligibility === "eligible" || named.eligibility === "conditional") && named.strength === "verbal";
  const ways = answer.ways.slice(0, WAYS_SHOWN);
  const conditions = answer.conditions.filter((condition) => condition.code !== "ONE_AT_A_TIME").slice(0, CONDITIONS_SHOWN);
  const figure = plainMoney(best);

  return (
    <div className="calc">
      <p className="calc-bar" data-verdict={asked && top ? "go" : "short"} aria-hidden="true">
        <span>{asked ? (top ? "حتى" : QUICK_VERDICT[verdict]) : "اكتب الراتب"}</span>
        {asked && top && (
          <b key={figure} className="num tick">
            {figure}
          </b>
        )}
      </p>

      <aside className="tile calc-form" aria-label="بيانات العميل">
        <div className="calc-salary">
          <NumberField label="الراتب الإجمالي" money max={999_999} value={facts.totalSalary} onChange={set("totalSalary")} />
          <input
            className="calc-range"
            type="range"
            aria-label="الراتب الإجمالي"
            min={SALARY_MIN}
            max={SALARY_MAX}
            step={SALARY_STEP}
            value={onSlider}
            style={{ "--fill": `${((onSlider - SALARY_MIN) / (SALARY_MAX - SALARY_MIN)) * 100}%` } as CSSProperties}
            onChange={(event) => set("totalSalary")(Number(event.target.value))}
          />
        </div>

        {Object.keys(kinds).length > 1 && <Segmented label="نوع التمويل" value={facts.financeType} onChange={set("financeType")} options={kinds} />}

        <div className="fields">
          <NumberField label="أقساطه الحالية" money placeholder="0" value={facts.installments} onChange={set("installments")} />
          <NumberField label="العمر" suffix="سنة" grouped={false} max={99} value={facts.age} onChange={set("age")} />
          <SelectField label="جهة العمل" value={facts.sector} onChange={set("sector")} options={SECTOR} />
          <SelectField label="سجله في سمة" value={facts.simah} onChange={set("simah")} options={RECORD_STANDING} />
          {mortgage && (
            <>
              <NumberField label="قيمة العقار" money value={facts.propertyValue} onChange={set("propertyValue")} />
              <NumberField label="دخل المتضامن" money placeholder="لا يوجد" value={facts.coIncome} onChange={set("coIncome")} />
            </>
          )}
        </div>

        <details className="calc-more">
          <summary>
            تفاصيل أكثر
            <ChevronIcon />
          </summary>
          <div className="fields">
            <NumberField label="قسط عقاري قائم" money placeholder="0" value={facts.mortgageInstallment} onChange={set("mortgageInstallment")} />
            <NumberField label="مدة الخدمة" suffix="شهراً" max={600} value={facts.serviceMonths} onChange={set("serviceMonths")} />
            <NumberField
              label="الراتب الأساسي"
              money
              placeholder={assumedBasic ? plainMoney(assumedBasic) : undefined}
              value={facts.basicSalary}
              onChange={set("basicSalary")}
            />
            <NumberField label="المبلغ المطلوب" money placeholder="الأقصى" value={facts.requestedAmount} onChange={set("requestedAmount")} />
            <NumberField label="المدة" suffix="شهراً" max={420} placeholder="الأقصى" value={facts.requestedTenor} onChange={set("requestedTenor")} />
          </div>
          <div className="calc-checks">
            <Check label="مستفيد من الدعم السكني" checked={facts.housingSupport} onChange={set("housingSupport")} />
            {mortgage && <Check label="يملك مسكناً غيره" checked={facts.secondHome} onChange={set("secondHome")} />}
            <Check label="مقيم غير سعودي" checked={facts.resident} onChange={set("resident")} />
          </div>
        </details>
      </aside>

      <div className="calc-out">
        <section className="tile tile--verdict calc-verdict" data-verdict={asked && top ? "go" : "short"}>
          <ClimbArt none={asked && !top} />
          <div className="verdict-text" aria-live="polite">
            <p className="label">تقدير أولي</p>
            {!asked ? (
              <>
                <h2 className="verdict-say">اكتب الراتب</h2>
                <p className="calc-at">الراتب الإجمالي يكفي لتقدير أول.</p>
              </>
            ) : (
              <>
                <h2 className="verdict-say">{QUICK_VERDICT[verdict]}</h2>
                {top ? (
                  <>
                    <p className="verdict-keep">
                      <span>حتى</span>{" "}
                      <b key={figure} className="num tick">
                        {figure}
                      </b>{" "}
                      <span>ريال</span>
                    </p>
                    <p className="calc-at">{largestOfferText(top)}</p>
                    {byWord && <p className="calc-at">{BY_WORD}</p>}
                  </>
                ) : (
                  <p className="calc-at">{answer.matches.length ? "لا جهة تقبل بهذه الأرقام. ما يمنع كل جهة مكتوب تحتها." : "لا منتج من هذا النوع في قائمة الجهات."}</p>
                )}
              </>
            )}
          </div>
          {asked && answer.capacity.income > 0 && <Split capacity={answer.capacity} />}
          {asked &&
            answer.capacity.warnings.map((warning) => (
              <p key={warning} className="result-note">
                {capacityWarningText(warning)}
              </p>
            ))}
        </section>

        {asked && answer.matches.length > 0 && (
          <section className="tile calc-lenders">
            <p className="label">{takingText(open.length)}</p>
            {open.length > 0 && (
              <ol className="routes">
                {open.slice(0, LENDERS_SHOWN).map((match) => (
                  <LenderRow key={match.product.id} match={match} />
                ))}
              </ol>
            )}
            {open.length > LENDERS_SHOWN && (
              <details className="more calc-rest">
                <summary>{othersText(open.length - LENDERS_SHOWN)}</summary>
                <ol className="routes">
                  {open.slice(LENDERS_SHOWN).map((match) => (
                    <LenderRow key={match.product.id} match={match} />
                  ))}
                </ol>
              </details>
            )}
            {closed.length > 0 && (
              <details className="more routes-closed" open={open.length === 0 || undefined}>
                <summary>{refusingText(closed.length)}</summary>
                <div>
                  {closed.map((match) => {
                    const read = strictMatch(match);
                    const why = strictRefusalLines(read, checkText);
                    return (
                      <p key={match.product.id} className="note" data-level={read.eligibility === "not_eligible" ? "block" : "ask"}>
                        <span>
                          <b>{match.product.lenderName}</b> {match.product.name} · {ELIGIBILITY[read.eligibility]}
                          {why.length ? `: ${why.join(" ")}` : ""}
                        </span>
                      </p>
                    );
                  })}
                </div>
              </details>
            )}
            <p className="calc-terms">
              الأرقام تقدير على الشروط المسجلة لكل جهة، وليست عرضاً منها.{" "}
              <Link className="note-link" href="/lenders">
                شروط الجهات
              </Link>
            </p>
          </section>
        )}

        {asked && (ways.length > 0 || conditions.length > 0) && (
          <div className="calc-pair">
            {ways.length > 0 && (
              <section className="tile calc-ways">
                <p className="label">{ways.some((way) => way.gain > 0) ? "طرق لرفع المبلغ" : "طرق لنتيجة أفضل"}</p>
                <p className="calc-basis">{WAYS_BASIS}</p>
                {ways.map((way) => (
                  <Way key={wayKey(way)} way={way} />
                ))}
              </section>
            )}
            {conditions.length > 0 && (
              <section className="tile tile--notes calc-asks">
                <p className="label">قد تطلب الجهة</p>
                {conditions.map((condition) => (
                  <MayAsk key={condition.code} condition={condition} />
                ))}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
