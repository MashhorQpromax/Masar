import { agoText, excerpt, firstName, MESSAGE_STATUS, MESSAGE_TYPE } from "@/copy/messages";
import type { ThreadMessage } from "@/server/messages/service";
import { WaText } from "./WaText";

/** A message longer than this is folded in the conversation, and opens whole when asked. */
const LONG = 280;

/** One message of a conversation, as a bubble on its side: the office's on one, the other person's across. */
export function ThreadBubble({ message, from, now }: { message: ThreadMessage; from: string; now: Date }) {
  const out = message.direction === "out";
  const template = message.type === "template";
  const kind = MESSAGE_TYPE[message.type];
  const body = template ? null : message.body;
  const failed = message.status === "failed";
  return (
    <li data-dir={message.direction} data-bad={failed || undefined}>
      <div className="thread-bubble">
        {template && <p className="thread-kind">{MESSAGE_TYPE.template} برابط ملفه</p>}
        {body && body.length > LONG ? (
          <details className="thread-long">
            <summary>
              <span>{excerpt({ type: message.type, body }, 150)}</span>
              <b>اقرأها كاملة</b>
            </summary>
            <WaText text={body} />
          </details>
        ) : (
          body && <WaText text={body} />
        )}
        {message.fileId != null && (
          <a className="file" href={`/files/${message.fileId}`} target="_blank" rel="noreferrer">
            <span>
              <small>{kind ?? "ملف"}</small>
              <bdi>افتحه</bdi>
            </span>
          </a>
        )}
        {message.fileId == null && !body && !template && <p className="thread-kind">{message.error ? `${kind ?? "ملف"} لم يُحفظ. اطلبه من العميل مرة أخرى.` : (kind ?? "رسالة")}</p>}
      </div>
      <small className="thread-meta">
        {out ? (message.by ? firstName(message.by) : "المكتب") : from}
        {out && message.status && MESSAGE_STATUS[message.status] ? ` · ${MESSAGE_STATUS[message.status]}` : ""} · {agoText(message.at, now)}
      </small>
    </li>
  );
}
