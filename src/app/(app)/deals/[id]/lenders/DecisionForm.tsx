"use client";

import { useState, useTransition } from "react";
import { askText, DECISION, knowledgeError, PART, refusalText } from "@/copy/knowledge";
import { ASKS, REFUSALS, type Ask, type Decision, type Refusal } from "@/domain/knowledge";
import { Check, NumberField, Segmented, SelectField, TextField } from "@/ui/fields";
import { CheckIcon } from "@/ui/icons";
import { saveDecision, type DecisionAnswer } from "./actions";

type Part = "mortgage" | "personal";
const UNSAID = "unsaid";
/** The answer was said, not written: no paper holds it. */
const SAID = "said";

/** Where the form starts for one part of the deal: the lender the deal is on, and the amount it expects. */
export interface PartStart {
  lenderId: number | null;
  amount: number | null;
}

/**
 * What a lender answered for this client. It is kept as experience about the lender, and an approved
 * amount can become the deal's own figure in the same step.
 */
export function DecisionForm({
  dealId,
  lenders,
  parts,
  mayAmend,
  papers,
}: {
  dealId: number;
  lenders: { id: number; name: string }[];
  parts: Partial<Record<Part, PartStart>>;
  mayAmend: boolean;
  /** The papers of the client's file that can hold the lender's answer in writing. */
  papers: { id: number; name: string }[];
}) {
  const offered = (Object.keys(PART) as Part[]).filter((part) => parts[part]);
  /** The lender the deal is on for a part. Only its amount goes on the deal without being asked. */
  const dealOn = (part: Part, lender: string): boolean => mayAmend && parts[part]?.lenderId != null && lender === `l${parts[part].lenderId}`;
  const [part, setPart] = useState<Part>(offered[0] ?? "mortgage");
  const [lender, setLender] = useState(`l${parts[offered[0] ?? "mortgage"]?.lenderId ?? lenders[0]?.id ?? 0}`);
  const [decision, setDecision] = useState<Decision>("approved");
  const [amount, setAmount] = useState<number | null>(parts[offered[0] ?? "mortgage"]?.amount ?? null);
  const [asks, setAsks] = useState<Ask[]>([]);
  const [reason, setReason] = useState<Refusal | typeof UNSAID>(UNSAID);
  const [note, setNote] = useState("");
  const [paper, setPaper] = useState(SAID);
  const [onDeal, setOnDeal] = useState(() => dealOn(part, lender));
  const [answer, setAnswer] = useState<DecisionAnswer>({});
  const [busy, start] = useTransition();
  const touched = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setAnswer({});
  };

  const refused = decision === "rejected";
  const lenderOptions = Object.fromEntries(lenders.map((l) => [`l${l.id}`, l.name])) as Record<string, string>;
  const partOptions = Object.fromEntries(offered.map((p) => [p, PART[p]])) as Record<Part, string>;
  const paperOptions = { [SAID]: "لا رد مكتوب", ...Object.fromEntries(papers.map((p) => [`d${p.id}`, p.name])) } as Record<string, string>;
  const reasonOptions = { [UNSAID]: "لم تذكر السبب", ...Object.fromEntries(REFUSALS.map((code) => [code, refusalText(code)])) } as Record<Refusal | typeof UNSAID, string>;
  const ready = refused || (amount != null && amount > 0);

  return (
    <form
      className="ruling-form"
      onSubmit={(event) => {
        event.preventDefault();
        start(async () => {
          const said = await saveDecision(dealId, {
            lenderId: Number(lender.slice(1)),
            part,
            decision,
            approvedAmount: refused ? null : amount,
            asks: refused ? [] : asks,
            reason: refused && reason !== UNSAID ? reason : null,
            note: note || null,
            onDeal: !refused && mayAmend && onDeal,
            replyPaperId: paper === SAID ? null : Number(paper.slice(1)),
          });
          setAnswer(said);
          if (said.saved) {
            setAsks([]);
            setNote("");
            setReason(UNSAID);
            setPaper(SAID);
          }
        });
      }}
    >
      <div className="ruling-main">
        <div className="ruling-pair">
          <SelectField
            label="الجهة"
            value={lender}
            onChange={(next) => {
              setLender(next);
              setOnDeal(dealOn(part, next));
              setAnswer({});
            }}
            options={lenderOptions}
          />
          {offered.length > 1 && (
            <div className="field">
              <span className="field-label">التمويل</span>
              <Segmented
                label="التمويل"
                value={part}
                onChange={(next) => {
                  const on = parts[next]?.lenderId ? `l${parts[next].lenderId}` : lender;
                  setPart(next);
                  setAmount(parts[next]?.amount ?? null);
                  setLender(on);
                  setOnDeal(dealOn(next, on));
                  setAnswer({});
                }}
                options={partOptions}
              />
            </div>
          )}
        </div>
        <div className="ruling-pair">
          <div className="field">
            <span className="field-label">ما قررته</span>
            <Segmented label="قرار الجهة" value={decision} onChange={touched(setDecision)} options={DECISION} />
          </div>
          {refused ? (
            <SelectField label="سبب الرفض" value={reason} onChange={touched(setReason)} options={reasonOptions} />
          ) : (
            <NumberField label="المبلغ المعتمد" money max={10_000_000_000} value={amount} onChange={touched(setAmount)} />
          )}
        </div>
      </div>
      <div className="ruling-more">
        {!refused && (
          <fieldset className="ruling-asks">
            <legend className="field-label">ما طلبته</legend>
            {ASKS.map((code) => (
              <label key={code} className="ask-chip">
                <input type="checkbox" checked={asks.includes(code)} onChange={(event) => touched(setAsks)(event.target.checked ? [...asks, code] : asks.filter((a) => a !== code))} />
                <span>{askText(code)}</span>
              </label>
            ))}
          </fieldset>
        )}
        <SelectField label="الرد المكتوب" value={paper} onChange={touched(setPaper)} options={paperOptions} />
        <TextField label="ملاحظة" value={note} onChange={touched(setNote)} placeholder={refused ? "ما قالته الجهة" : "ما يفيد من يقدّم لها بعدك"} maxLength={500} />
      </div>
      <div className="ruling-save">
        {!refused && mayAmend && <Check label="احسب الصفقة على هذا المبلغ" checked={onDeal} onChange={touched(setOnDeal)} />}
        <button type="submit" className="btn btn--navy" disabled={busy || !ready} aria-busy={busy}>
          سجّل القرار
        </button>
        {answer.error ? (
          <p key={answer.error} role="alert" className="said" data-bad>
            {knowledgeError(answer.error)}
          </p>
        ) : (
          answer.saved &&
          !busy && (
            <p role="status" className="said">
              <CheckIcon size={16} />
              سُجّل القرار
            </p>
          )
        )}
      </div>
    </form>
  );
}
