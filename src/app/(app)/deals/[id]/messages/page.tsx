import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { STAGE } from "@/copy/deal";
import { owedBrief, paperLabel } from "@/copy/documents";
import { counted, dayShort } from "@/copy/format";
import { approvalApartText } from "@/copy/opportunity";
import { agoText, CLIENT_STEP, excerpt, firstName, GATE_REASON, internalText, MESSAGE_KIND, MESSAGE_TYPE, OFFER_WAITS, offerText, papersText, progressText, studyText, type MessageExtras } from "@/copy/messages";
import { can } from "@/domain/auth";
import { clientReachable, isClientMessage, isMessageKind, type MessageKind } from "@/domain/messages";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { approvalNotes } from "@/server/knowledge/service";
import { linkPath, linkSecret, siteOrigin, whatsapp } from "@/server/messages/request";
import { getMessages } from "@/server/messages/service";
import { BackIcon } from "@/ui/icons";
import { SubmitButton } from "@/ui/SubmitButton";
import { ThreadBubble } from "@/ui/ThreadBubble";
import { makeLink, needsNoAnswer, shutLinks } from "./actions";
import { Composer, type Choice } from "./Composer";
import { CopyLink } from "./CopyLink";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "الرسائل · مسار" };

const TIMES = { one: "مرة واحدة", two: "مرتين", few: "مرات", many: "مرة" };
export default async function MessagesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ kind?: string | string[] }> }) {
  // The conversation is the client's own words and number: only who may see a client's details reads it.
  const me = await requireActor("client.view_pii");
  const dealId = Number((await params).id);
  if (!Number.isInteger(dealId) || dealId <= 0) notFound();
  const now = new Date();
  const db = await getDb();
  const view = await getMessages(db, { dealId, secret: linkSecret(), now });
  if (!view) notFound();

  const { deal, client, who, gate, facts, offer, steps, owed, link, thread } = view;
  const first = firstName(client.fullName);
  const maySend = can(me.role, "client.edit");
  const toClient = clientReachable(gate);
  // A lender's written approval at another amount than the deal's: said beside what the client is about to be told.
  const apart = toClient && !gate.reason && deal.stage !== "closed" ? await approvalNotes(db, view, now) : [];
  const origin = await siteOrigin();
  const url = link && origin ? `${origin}${linkPath(link.token)}` : null;

  const owedNames = owed.map((paper) => ({ label: paperLabel(paper, who), note: paper.status === "rejected" ? paper.note : null }));
  const extras: MessageExtras = { first, staff: me.demo ? null : firstName(me.name), owed: owedNames, link: url };
  const named = facts.financing.some((part) => part.lender);

  const written: Record<MessageKind, () => Pick<Choice, "text" | "named">> = {
    study: () => ({ text: studyText(facts, extras), named: named ? studyText(facts, { ...extras, nameLender: true }) : undefined }),
    // The gate opens the final offer only while the fee plan stands approved, so there is one to write.
    offer: () => ({ text: offer ? offerText(facts, offer, extras) : "", named: offer && named ? offerText(facts, offer, { ...extras, nameLender: true }) : undefined }),
    papers: () => ({ text: papersText(extras) }),
    progress: () => ({ text: progressText(facts, steps, extras) }),
    reply: () => ({ text: "" }),
    internal: () => ({ text: internalText({ clientName: client.fullName, fileNo: client.fileNo, input: view.input, study: view.study }) }),
  };
  const choices: Choice[] = gate.allowed.map((kind) => ({ kind, ...MESSAGE_KIND[kind], ...written[kind](), forClient: isClientMessage(kind) }));

  const last = thread.at(-1);
  const waiting = toClient && view.waiting;
  const wroteBefore = thread.some((message) => message.direction === "out");
  const allowed = (kind: MessageKind) => gate.allowed.includes(kind);
  const asked = [(await searchParams).kind].flat()[0];
  const start: MessageKind =
    asked && isMessageKind(asked) && allowed(asked)
      ? asked
      : waiting && allowed("reply")
        ? "reply"
        : owed.length > 0 && allowed("papers")
          ? "papers"
          : !wroteBefore && allowed("study")
            ? "study"
            : allowed("progress")
              ? "progress"
              : gate.allowed[0]!;

  return (
    <>
      <div className="head">
        <div>
          <Link className="back" href={`/deals/${deal.id}`}>
            <BackIcon />
            ملف الصفقة
          </Link>
          <h1 className="title">الرسائل</h1>
        </div>
        <div className="head-side">
          <p className="where">
            <span className="num">{client.fileNo}</span> · <b>{client.fullName}</b> · {STAGE[deal.stage]}
          </p>
        </div>
      </div>

      <div className="bento bento--compose">
        <section className="tile tile--verdict tile--compose">
          <div>
            <p className="label">{toClient ? "واتساب" : "للمكتب فقط"}</p>
            <h2 className="compose-title">{toClient ? `رسالة إلى ${first}` : "ملخص داخلي"}</h2>
            {toClient && gate.reason && <p className="composer-say">{GATE_REASON[gate.reason]}</p>}
            {toClient && !gate.reason && !offer && <p className="composer-say">{OFFER_WAITS}</p>}
            {apart.map((one) => (
              <p className="composer-say" key={one.part}>
                {approvalApartText(one)}
              </p>
            ))}
          </div>
          <Composer key={start} dealId={deal.id} choices={choices} start={start} phone={view.phone} maySend={maySend} api={whatsapp() !== null} windowOpen={view.windowOpen} demo={me.demo} />
        </section>

        {!toClient ? (
          <section className="tile tile--next" data-quiet="true">
            <div>
              <p className="label">الحالة</p>
              <h2>لا نراسل هذا العميل</h2>
              <p className="due">{gate.reason ? GATE_REASON[gate.reason] : ""}</p>
            </div>
          </section>
        ) : waiting && last ? (
          <section className="tile tile--next">
            <div>
              <p className="label">الخطوة التالية</p>
              <h2>رد على {first}</h2>
              <p className="due">
                {last.body ? `كتب ${agoText(last.at, now)}: «${excerpt(last, 110)}»` : `أرسل ${MESSAGE_TYPE[last.type] ?? "ملفاً"} ${agoText(last.at, now)}.`}
              </p>
            </div>
            {maySend && (
              <form action={needsNoAnswer} className="actions">
                <input type="hidden" name="dealId" value={deal.id} />
                <SubmitButton className="btn btn--ghost">لا يحتاج رداً</SubmitButton>
              </form>
            )}
          </section>
        ) : owed.length > 0 && allowed("papers") ? (
          <section className="tile tile--next">
            <div>
              <p className="label">الخطوة التالية</p>
              <h2>اطلب الناقص من {first}</h2>
              <p className="due">{owedBrief(owedNames.map((paper) => paper.label))}</p>
            </div>
          </section>
        ) : !wroteBefore && allowed("study") ? (
          <section className="tile tile--next">
            <div>
              <p className="label">الخطوة التالية</p>
              <h2>أرسل له ملخص الدراسة</h2>
              <p className="due">لم نكتب له بعد. الرسالة جاهزة بأرقام ملفه.</p>
            </div>
          </section>
        ) : (
          <section className="tile tile--next" data-quiet="true">
            <div>
              <p className="label">الحالة</p>
              <h2>{first} على اطلاع</h2>
              <p className="due">{last ? `آخر رسالة ${agoText(last.at, now)}.` : "لا شيء ينتظره منا الآن."} أخبره كلما تقدم الملف محطة.</p>
            </div>
          </section>
        )}

        <section className="tile tile--share" data-off={link ? undefined : true}>
          <div className="share-text">
            <p className="label">صفحة العميل</p>
            {link ? (
              <>
                <div>
                  <h2 className="share-state">{link.views > 0 ? `فتحها ${counted(link.views, TIMES)}` : "لم يفتحها بعد"}</h2>
                  <p className="share-say">
                    {link.lastViewAt ? `آخر مرة ${agoText(link.lastViewAt, now)}. ` : ""}صالحة حتى {dayShort(link.expiresAt)}.
                  </p>
                </div>
                {url && <CopyLink url={url} />}
                <div className="actions">
                  {url && (
                    <a className="btn btn--soft" href={url} target="_blank" rel="noreferrer">
                      افتحها كما يراها
                    </a>
                  )}
                  {maySend && !me.demo && (
                    <form action={shutLinks}>
                      <input type="hidden" name="dealId" value={deal.id} />
                      <SubmitButton className="btn btn--ghost">أغلق الرابط</SubmitButton>
                    </form>
                  )}
                </div>
              </>
            ) : toClient ? (
              <>
                <div>
                  <h2 className="share-state">لا رابط مفتوحاً</h2>
                  <p className="share-say">صفحة خاصة يتابع منها ملفه ويرفع مستنداته، بلا حساب ولا كلمة مرور.</p>
                </div>
                {maySend && !me.demo && (
                  <form action={makeLink} className="actions">
                    <input type="hidden" name="dealId" value={deal.id} />
                    <SubmitButton className="btn btn--navy">أنشئ رابطاً</SubmitButton>
                  </form>
                )}
              </>
            ) : (
              <div>
                <h2 className="share-state">مغلقة</h2>
                <p className="share-say">عميل لا نراسله لا يُفتح له رابط.</p>
              </div>
            )}
          </div>
          {/* The client's page in small: the same six steps they see, where their file stands now. */}
          <div className="share-phone" aria-hidden="true">
            <b>{first ? `أهلاً ${first}` : "أهلاً بك"}</b>
            <ol>
              {steps.map((step) => (
                <li key={step.key} data-state={step.state}>
                  <i />
                  <span>{CLIENT_STEP[step.key]}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* A client the office does not write to has a conversation only if one was had before. */}
        {(toClient || thread.length > 0) && (
          <section className="tile tile--wide">
            <h2 className="label">المحادثة</h2>
            {thread.length === 0 ? (
              <p className="thread-none">لا رسائل بعد. ما ترسله من هنا وما يكتبه العميل لرقم الشركة يظهر في هذا المكان.</p>
            ) : (
              <ol className="thread">
                {thread.map((message) => (
                  <ThreadBubble key={message.id} message={message} from={first} now={now} />
                ))}
              </ol>
            )}
          </section>
        )}
      </div>
    </>
  );
}
