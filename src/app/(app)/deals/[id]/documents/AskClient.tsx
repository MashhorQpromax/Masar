"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "@/ui/icons";

/**
 * The message that asks the client for what the file still owes. One tap copies it; when the client's
 * number is known, another opens their WhatsApp chat with the message already written.
 */
export function AskClient({ text, phone }: { text: string; phone: string | null }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    });
  }

  return (
    <div className="actions">
      {phone && (
        <a className="btn btn--navy" href={`https://wa.me/${phone}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
          اطلبها في واتساب
        </a>
      )}
      <button type="button" className={phone ? "btn btn--ghost" : "btn btn--navy"} onClick={copy}>
        {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
        <span aria-live="polite">{copied ? "نُسخ الطلب" : "انسخ الطلب"}</span>
      </button>
    </div>
  );
}
