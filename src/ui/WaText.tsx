import { waRuns } from "@/copy/messages";

/** A message as WhatsApp shows it: *bold*, _soft_, and its own line breaks. */
export function WaText({ text }: { text: string }) {
  return (
    <p className="wa-text" dir="auto">
      {waRuns(text).map((run, index) => (run.mark === "bold" ? <b key={index}>{run.text}</b> : run.mark === "soft" ? <i key={index}>{run.text}</i> : run.text))}
    </p>
  );
}
