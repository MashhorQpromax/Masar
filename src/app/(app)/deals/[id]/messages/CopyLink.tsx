"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "@/ui/icons";

/** The client's link, shown short, with one press to copy it whole. */
export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    });
  }

  return (
    <div className="share-url">
      <bdi dir="ltr">{url.replace(/^https?:\/\//, "")}</bdi>
      <button type="button" className="link-copy" onClick={copy} aria-live="polite">
        {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
        {copied ? "نُسخ" : "انسخ"}
      </button>
    </div>
  );
}
