"use client";

import { useEffect, useState, useTransition } from "react";
import { messageError } from "@/copy/messages";
import type { MessageKind } from "@/domain/messages";
import { CheckIcon, CopyIcon } from "@/ui/icons";
import { noteOwnSend, sendFromOffice } from "./actions";

export interface Choice {
  kind: MessageKind;
  label: string;
  hint: string;
  /** The message as written for this deal. Empty for a reply in the person's own words. */
  text: string;
  /** The same message with the lender named, when there is one to name. */
  named?: string;
  /** Written for the client. The other kind carries the company's numbers. */
  forClient: boolean;
}

const DONE: Record<string, string> = {
  text: "أُرسلت من رقم الشركة.",
  template: "وصله قالب المتابعة برابط ملفه. الرسالة الكاملة تُرسل بعد رده.",
  noted: "سُجلت في الملف.",
  copied: "نُسخت الرسالة.",
};

/**
 * Writing to the client: choose what to say, read it, change a word if needed, send. The message is
 * already written from the deal, so most of the time the only thing to do is send it.
 */
export function Composer({
  dealId,
  choices,
  start,
  phone,
  maySend,
  api,
  windowOpen,
  demo,
}: {
  dealId: number;
  choices: Choice[];
  start: MessageKind;
  /** The client's number as WhatsApp takes it. */
  phone: string | null;
  maySend: boolean;
  /** The company's own number is connected. */
  api: boolean;
  windowOpen: boolean;
  /** Invented clients: their numbers are made up, so nothing is addressed to them. */
  demo: boolean;
}) {
  const [kind, setKind] = useState<MessageKind>(start);
  const [named, setNamed] = useState(false);
  const choice = choices.find((entry) => entry.kind === kind) ?? choices[0]!;
  const written = named && choice.named ? choice.named : choice.text;
  const [text, setText] = useState(written);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, startBusy] = useTransition();

  // Another choice, or the lender's name, writes the message again.
  useEffect(() => setText(written), [written]);

  const empty = text.trim().length === 0;
  const toClient = choice.forClient;
  // A made-up number may be a stranger's real one. The demo opens WhatsApp with no one chosen.
  const link = `https://wa.me/${toClient && !demo ? (phone ?? "") : ""}?text=${encodeURIComponent(text)}`;

  function report(answer: { error?: string; done?: string }) {
    setSaid(answer.error ? { ok: false, text: messageError(answer.error) } : { ok: true, text: DONE[answer.done ?? "noted"] ?? DONE.noted! });
  }

  function send() {
    startBusy(async () => report(await sendFromOffice(dealId, kind, text)));
  }

  function opened() {
    // The person sends it from their own WhatsApp. What goes to the client is kept in the file.
    if (toClient && maySend && !demo) startBusy(async () => report(await noteOwnSend(dealId, kind, text)));
  }

  function copy() {
    void navigator.clipboard?.writeText(text).then(() => setSaid({ ok: true, text: DONE.copied! }));
  }

  return (
    <div className="composer">
      {choices.length > 1 && (
        <div className="seg" role="radiogroup" aria-label="ماذا نقول">
          {choices.map((entry) => (
            <button
              key={entry.kind}
              type="button"
              role="radio"
              aria-checked={entry.kind === kind}
              title={entry.hint}
              onClick={() => {
                setKind(entry.kind);
                setSaid(null);
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}

      <div className="bubble">
        <textarea
          className="bubble-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-label="نص الرسالة"
          placeholder={kind === "reply" ? "اكتب ردك هنا" : ""}
          dir="auto"
          rows={kind === "reply" ? 5 : 12}
          maxLength={4096}
          readOnly={!maySend && toClient}
        />
        <p className="bubble-foot">
          {toClient ? choice.hint : "فيها أتعابنا ورأس المال. لشريك أو ممول، وليست للعميل."}
          {choice.named && (
            <label className="check">
              <input type="checkbox" checked={named} onChange={(event) => setNamed(event.target.checked)} />
              اذكر اسم الجهة
            </label>
          )}
        </p>
      </div>

      <div className="actions">
        {toClient && api && maySend && (
          <button type="button" className="btn btn--coral" onClick={send} disabled={busy || empty || !phone}>
            أرسل من رقم الشركة
          </button>
        )}
        {(!toClient || maySend) && (
          <a
            className={toClient && api ? "btn btn--ghost" : "btn btn--coral"}
            href={link}
            target="_blank"
            rel="noreferrer"
            aria-disabled={empty || (toClient && !phone)}
            onClick={(event) => {
              if (empty || (toClient && !phone)) event.preventDefault();
              else opened();
            }}
          >
            افتح في واتساب
          </a>
        )}
        <button type="button" className="btn btn--ghost" onClick={copy} disabled={empty}>
          <CopyIcon size={16} />
          انسخ
        </button>
      </div>

      {said ? (
        <p key={said.text} role="status" className="said" data-bad={said.ok ? undefined : true}>
          {said.ok && <CheckIcon size={16} />}
          {said.text}
        </p>
      ) : toClient && demo ? (
        <p className="composer-say">عرض ببيانات وهمية: يفتح واتساب بلا رقم، ولا يُرسل شيء ولا يُسجل.</p>
      ) : toClient && !phone ? (
        <p className="composer-say">رقم جوال العميل غير مسجل. أضفه في بيانات العميل لتراسله.</p>
      ) : toClient && api ? (
        <p className="composer-say">{windowOpen ? "العميل كتب لنا خلال يوم، فتصله الرسالة كما هي." : "العميل لم يكتب منذ يوم، فيصله أولاً قالب المتابعة برابط ملفه."}</p>
      ) : null}
    </div>
  );
}
