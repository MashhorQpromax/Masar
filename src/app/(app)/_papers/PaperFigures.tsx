"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { conflictWay, factValue, paperError, STATED_FIELD } from "@/copy/documents";
import { groupDigits, numberText } from "@/copy/format";
import type { Stated } from "@/domain/documents";
import type { PaperFact } from "@/domain/eligibility";
import { SubmitButton } from "@/ui/SubmitButton";
import { relyOn, stateFigures, verifyPaper, type PaperAnswer } from "./actions";

/** A figure as it starts in its field: an amount with its separators, a year as it is. */
const typedOf = (fact: PaperFact, value: number | undefined): string => (value == null ? "" : fact === "birthYear" ? String(value) : groupDigits(String(value)));

/**
 * The figures a paper states, written down by the person who checks it. With `verify` the same step
 * says the paper is good; without it, it corrects what was written from a paper already checked.
 * The fields start empty when the paper is checked: the figure is typed from the paper, not from the file.
 * What was typed stays in the fields when it is refused, beside the reason.
 */
export function PaperFigures({ home, paperId, name, facts, stated, verify }: { home: string; paperId: number; name: string; facts: readonly PaperFact[]; stated: Stated; verify: boolean }) {
  const [answer, send] = useActionState<PaperAnswer, FormData>((verify ? verifyPaper : stateFigures).bind(null, home, paperId), {});
  const box = useRef<HTMLDetailsElement>(null);
  const written = facts.some((fact) => stated[fact] != null);
  const start = (): Partial<Record<PaperFact, string>> => Object.fromEntries(facts.map((fact) => [fact, verify ? "" : typedOf(fact, stated[fact])]));
  const [draft, setDraft] = useState(start);

  // The fields follow what is kept: after a save, and after a change made from elsewhere.
  const kept = JSON.stringify(stated);
  useEffect(() => {
    setDraft(start());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kept]);
  useEffect(() => {
    if (!answer.done) return;
    if (box.current) box.current.open = false;
    setDraft(start());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer]);

  return (
    <details ref={box} className="send-back paper-figures">
      <summary className={verify ? "btn btn--navy" : "btn btn--ghost"}>{verify ? "سليم" : written ? "صحّح ما كُتب" : "اكتب ما فيه"}</summary>
      <form action={send}>
        {facts.map((fact, index) => (
          <label key={fact} className="figure">
            <span>{STATED_FIELD[fact]}</span>
            <input
              className="field-input num"
              dir="ltr"
              name={fact}
              inputMode="numeric"
              autoComplete="off"
              // The first figure is the one the paper is asked for.
              required={verify && index === 0}
              value={draft[fact] ?? ""}
              maxLength={fact === "birthYear" ? 4 : 12}
              onChange={(event) => {
                const plain = numberText(event.target.value, fact === "birthYear" ? 0 : 2);
                setDraft((before) => ({ ...before, [fact]: fact === "birthYear" ? plain : groupDigits(plain) }));
              }}
              aria-label={`${STATED_FIELD[fact]}: ${name}`}
            />
          </label>
        ))}
        <SubmitButton className="btn btn--navy">{verify ? "سليم" : "احفظ"}</SubmitButton>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            if (box.current) box.current.open = false;
            setDraft(start());
          }}
        >
          إلغاء
        </button>
        <p className="figure-say">اكتب الرقم كما في المستند نفسه، لا كما في الملف.</p>
        {answer.error && (
          <p key={answer.error} role="alert" className="said" data-bad>
            {paperError(answer.error)}
          </p>
        )}
      </form>
    </details>
  );
}

/** One fact in dispute, with the way out of it: the file takes what the papers say. */
export function RelyOn({ home, paperId, fact, value, paper, papersAgree, may }: { home: string; paperId: number; fact: PaperFact; value: number; paper: string; papersAgree: boolean; may: boolean }) {
  const [answer, send] = useActionState<PaperAnswer, FormData>(relyOn.bind(null, home, paperId, fact), {});
  return (
    <form action={send} className="rely">
      <p className="rely-way">{conflictWay({ papersAgree })}</p>
      {may && papersAgree && (
        <SubmitButton className="btn btn--navy">
          اعتمد ما في {paper}: {factValue(fact, value)}
        </SubmitButton>
      )}
      {answer.error && (
        <p key={answer.error} role="alert" className="said" data-bad>
          {paperError(answer.error)}
        </p>
      )}
    </form>
  );
}
