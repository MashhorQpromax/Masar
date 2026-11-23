import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { STAGE } from "@/copy/deal";
import { BY_OFFICE, FILE_KIND, fileTitle, owedBrief, PAPER_CATEGORY, PAPER_STATUS, paperLabel, TRAY } from "@/copy/documents";
import { counted, ltr } from "@/copy/format";
import { can } from "@/domain/auth";
import { INBOX_PAPER, PAPER_CATEGORIES, PAPER_MAX_FILES, SIMAH_PAPER, type Paper, type PaperStatus } from "@/domain/documents";
import { clientReachable, messageGate } from "@/domain/messages";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { getPapers } from "@/server/documents/service";
import { BackIcon, CheckIcon, CloseIcon } from "@/ui/icons";
import { SubmitButton } from "@/ui/SubmitButton";
import { AddPaper } from "./AddPaper";
import { PaperUpload } from "@/ui/PaperUpload";
import { dropPaper, fileUnder, judgePaper, removeFile, uploadPaperFile } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "المستندات · مسار" };

const OPTIONAL = { one: "مستند اختياري", two: "مستندان اختياريان", few: "مستندات اختيارية", many: "مستنداً اختيارياً" };
const VISIBLE_OWED = 4;
const SHEET_ORDER: Record<PaperStatus, number> = { verified: 0, received: 1, rejected: 2, missing: 3 };

/**
 * The file as a row of sheets, one for each paper it needs: gold when it was verified, white when it
 * arrived, an outline while it is still owed. The drawing is the count.
 */
function Sheets({ states }: { states: PaperStatus[] }) {
  const sheets = [...states].sort((a, b) => SHEET_ORDER[a] - SHEET_ORDER[b]);
  return (
    <ol className="sheets" aria-hidden="true">
      {sheets.map((status, index) => (
        <li key={index} data-status={status} style={{ animationDelay: `${0.3 + index * 0.05}s` } as CSSProperties}>
          {status === "verified" && <CheckIcon size={20} />}
        </li>
      ))}
    </ol>
  );
}

export default async function DocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireActor();
  const dealId = Number((await params).id);
  if (!Number.isInteger(dealId) || dealId <= 0) notFound();
  const view = await getPapers(await getDb(), { dealId });
  if (!view) notFound();

  const { deal, client, who, list, ended } = view;
  const mayUpload = can(me.role, "doc.upload") && !ended;
  const mayVerify = can(me.role, "doc.verify") && !ended;
  const mayOpen = can(me.role, "client.view_pii");

  const name = (paper: Paper) => paperLabel(paper, who);
  const required = list.papers.filter((paper) => paper.required);
  const owed = required.filter((paper) => paper.status === "missing" || paper.status === "rejected");
  const arrived = list.required - list.missing;
  // An optional paper nobody sent stays out of the way until someone wants it.
  const idle = (paper: Paper) => !paper.required && paper.files.length === 0;
  // What arrived by WhatsApp is not a paper yet. It has its own place at the top, where each file is put under one.
  const tray = list.papers.find((paper) => paper.code === INBOX_PAPER);
  const shown = list.papers.filter((paper) => !idle(paper) && paper !== tray);
  const homes = list.papers.filter((paper) => paper !== tray && paper.code !== SIMAH_PAPER && paper.asked);
  const optional = list.papers.filter(idle);
  // The client is asked for what is theirs to bring. What the office brings itself is the office's next step.
  const fromClient = owed.filter((paper) => paper.by === "client");
  const fromOffice = owed.filter((paper) => paper.by === "office");
  // A client the office does not write to is not asked for anything either.
  const mayAsk = mayUpload && clientReachable(messageGate({ stage: deal.stage, verdict: view.verdict }));

  const row = (paper: Paper) => {
    const label = name(paper);
    const simah = paper.code === SIMAH_PAPER;
    const hasFiles = paper.files.length > 0;
    return (
      <li key={paper.code} className="paper" data-status={paper.status}>
        <div className="paper-what">
          <b>{label}</b>
          <span className="paper-state" data-status={paper.status}>
            {PAPER_STATUS[paper.status]}
          </span>
          {paper.by === "office" && paper.status !== "verified" && <small>{BY_OFFICE}</small>}
          {!paper.required && <small>{paper.asked ? "اختياري" : "غير مطلوب الآن"}</small>}
          {paper.status === "rejected" && paper.note && <p className="paper-why">{paper.note}</p>}
        </div>
        <div className="paper-files">
          {paper.files.map((file, index) => {
            // A file's name can carry the client's own. Who may not open the file does not read its name either.
            const title = mayOpen ? fileTitle(file.name) : `ملف ${ltr(index + 1)}`;
            return (
              <span key={file.id} className="file">
                {mayOpen ? (
                  <a href={`/files/${file.id}`} target="_blank" rel="noreferrer">
                    <small>{FILE_KIND[file.kind]}</small>
                    <bdi>{title}</bdi>
                  </a>
                ) : (
                  <span>
                    <small>{FILE_KIND[file.kind]}</small>
                    <bdi>{title}</bdi>
                  </span>
                )}
                {mayUpload && !simah && (
                  <form action={removeFile}>
                    <input type="hidden" name="dealId" value={deal.id} />
                    <input type="hidden" name="fileId" value={file.id} />
                    <button type="submit" className="file-remove" aria-label={`احذف ${title}`}>
                      <CloseIcon size={14} />
                    </button>
                  </form>
                )}
              </span>
            );
          })}
          {mayUpload && !simah && hasFiles && paper.files.length < PAPER_MAX_FILES && <PaperUpload send={uploadPaperFile.bind(null, deal.id, paper.code)} name={label} look="more" />}
        </div>
        <div className="paper-do">
          {simah ? (
            mayOpen && (
              <Link className="btn btn--soft" href={`/clients/${client.id}/credit`}>
                {paper.status === "verified" ? "السجل الائتماني" : "ارفعه ليُقرأ"}
              </Link>
            )
          ) : (
            <>
              {mayVerify && hasFiles && paper.id != null && paper.status !== "verified" && (
                <form action={judgePaper}>
                  <input type="hidden" name="dealId" value={deal.id} />
                  <input type="hidden" name="paperId" value={paper.id} />
                  <input type="hidden" name="verdict" value="verified" />
                  <SubmitButton className="btn btn--navy">سليم</SubmitButton>
                </form>
              )}
              {mayVerify && hasFiles && paper.id != null && paper.status !== "rejected" && (
                <details className="send-back">
                  <summary className="btn btn--ghost">أعده</summary>
                  <form action={judgePaper}>
                    <input type="hidden" name="dealId" value={deal.id} />
                    <input type="hidden" name="paperId" value={paper.id} />
                    <input type="hidden" name="verdict" value="rejected" />
                    <input className="field-input" name="note" required minLength={2} maxLength={200} placeholder="لماذا يُعاد؟" aria-label={`سبب إعادة ${label}`} autoComplete="off" />
                    <SubmitButton className="btn btn--soft">أعده للعميل</SubmitButton>
                  </form>
                </details>
              )}
              {mayUpload && !hasFiles && <PaperUpload send={uploadPaperFile.bind(null, deal.id, paper.code)} name={label} look="soft" />}
              {mayUpload && paper.category === "extra" && !hasFiles && paper.id != null && (
                <form action={dropPaper}>
                  <input type="hidden" name="dealId" value={deal.id} />
                  <input type="hidden" name="paperId" value={paper.id} />
                  <SubmitButton className="btn btn--ghost">احذفه</SubmitButton>
                </form>
              )}
            </>
          )}
        </div>
      </li>
    );
  };

  return (
    <>
      <div className="head">
        <div>
          <Link className="back" href={`/deals/${deal.id}`}>
            <BackIcon />
            ملف الصفقة
          </Link>
          <h1 className="title">المستندات</h1>
        </div>
        <div className="head-side">
          <p className="where">
            <span className="num">{client.fileNo}</span> · <b>{client.fullName}</b> · {STAGE[deal.stage]}
          </p>
        </div>
      </div>

      <div className="bento">
        <section className="tile tile--verdict" data-verdict={list.missing ? "short" : "go"}>
          <div className="verdict-text">
            <p className="label">ملف العميل</p>
            <h2 className="verdict-say">{list.missing ? "ينقصه" : "مكتمل"}</h2>
            <p className="verdict-keep">
              <b className="num">{list.missing || arrived}</b> <span>من {ltr(list.required)}</span>
            </p>
          </div>
          <Sheets states={required.map((paper) => paper.status)} />
          <dl className="route-figures">
            <div>
              <dt>المطلوب</dt>
              <dd className="num">{list.required}</dd>
            </div>
            <div>
              <dt>وصل</dt>
              <dd className="num">{arrived}</dd>
            </div>
            <div>
              <dt>تحققنا منه</dt>
              <dd className="num">{list.verified}</dd>
            </div>
          </dl>
        </section>

        {ended ? (
          <section className="tile tile--next" data-quiet="true">
            <div>
              <p className="label">الحالة</p>
              <h2>الصفقة انتهت</h2>
              <p className="due">المستندات محفوظة للاطلاع.</p>
            </div>
          </section>
        ) : fromClient.length > 0 ? (
          <section className="tile tile--next">
            <div>
              <p className="label">الخطوة التالية</p>
              <h2>اطلب الناقص من العميل</h2>
              <p className="due">{owedBrief(fromClient.map(name))}</p>
            </div>
            {mayAsk && (
              <div className="actions">
                <Link className="btn btn--navy" href={`/deals/${deal.id}/messages?kind=papers`}>
                  اطلبها من العميل
                </Link>
              </div>
            )}
          </section>
        ) : fromOffice.length > 0 ? (
          <section className="tile tile--next">
            <div>
              <p className="label">الخطوة التالية</p>
              <h2>أكمل أوراق الصفقة</h2>
              <p className="due">{owedBrief(fromOffice.map(name))}</p>
            </div>
          </section>
        ) : list.toCheck > 0 ? (
          <section className="tile tile--next" data-quiet="true">
            <div>
              <p className="label">الخطوة التالية</p>
              <h2>راجع ما وصل</h2>
              <p className="due">كل المطلوب وصل. افتح كل مستند وقل إنه سليم أو أعده.</p>
            </div>
          </section>
        ) : (
          <section className="tile tile--next" data-quiet="true">
            <div>
              <p className="label">الحالة</p>
              <h2>الملف جاهز</h2>
              <p className="due">كل المطلوب وصل وتحققنا منه.</p>
            </div>
          </section>
        )}

        <section className="tile tile--notes tile--five">
          <p className="label">{owed.length ? "ما ينقص" : list.toCheck ? "ينتظر المراجعة" : "لا شيء ناقص"}</p>
          {(owed.length ? [...fromClient, ...fromOffice] : list.papers.filter((paper) => paper.status === "received")).slice(0, VISIBLE_OWED).map((paper) => (
            <p key={paper.code} className="note" data-level={paper.status === "received" ? "warn" : "block"}>
              <span>
                {name(paper)}
                {paper.status === "rejected" && paper.note ? `، يُعاد: ${paper.note}` : ""}
                {paper.by === "office" && paper.status !== "received" ? ` (${BY_OFFICE})` : ""}
              </span>
            </p>
          ))}
          {owed.length > VISIBLE_OWED && (
            <p className="note">
              <span>و{counted(owed.length - VISIBLE_OWED, { one: "مستند آخر", two: "مستندان آخران", few: "مستندات أخرى", many: "مستنداً آخر" })} في القائمة.</span>
            </p>
          )}
          {!owed.length && !list.toCheck && (
            <p className="note" data-level="good">
              <span>يكبر الملف مع تقدم الصفقة: كل محطة تطلب أوراقها حين تصلها.</span>
            </p>
          )}
        </section>

        <section className="tile tile--wide">
          {tray && (
            <div className="papers-group tray">
              <h2 className="label">{TRAY}</h2>
              <p className="tray-say">{mayUpload ? "افتح كل ملف ثم ضعه تحت مستنده." : "ملفات أرسلها العميل وتنتظر من يضعها تحت مستنداتها."}</p>
              <ul className="papers">
                {tray.files.map((file, index) => {
                  const title = mayOpen ? fileTitle(file.name) : `ملف ${ltr(index + 1)}`;
                  return (
                    <li key={file.id} className="paper">
                      <div className="paper-files">
                        <span className="file">
                          {mayOpen ? (
                            <a href={`/files/${file.id}`} target="_blank" rel="noreferrer">
                              <small>{FILE_KIND[file.kind]}</small>
                              <bdi>{title}</bdi>
                            </a>
                          ) : (
                            <span>
                              <small>{FILE_KIND[file.kind]}</small>
                              <bdi>{title}</bdi>
                            </span>
                          )}
                        </span>
                      </div>
                      {mayUpload && (
                        <form action={fileUnder} className="tray-put">
                          <input type="hidden" name="dealId" value={deal.id} />
                          <input type="hidden" name="fileId" value={file.id} />
                          <select className="field-input" name="code" required defaultValue="" aria-label={`المستند الذي يوضع تحته ${title}`}>
                            <option value="" disabled>
                              أي مستند هذا؟
                            </option>
                            {homes.map((paper) => (
                              <option key={paper.code} value={paper.code}>
                                {name(paper)}
                              </option>
                            ))}
                          </select>
                          <SubmitButton className="btn btn--navy">ضعه هنا</SubmitButton>
                        </form>
                      )}
                      {mayUpload && (
                        <form action={removeFile}>
                          <input type="hidden" name="dealId" value={deal.id} />
                          <input type="hidden" name="fileId" value={file.id} />
                          <SubmitButton className="btn btn--ghost">احذفه</SubmitButton>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {PAPER_CATEGORIES.filter((category) => shown.some((paper) => paper.category === category)).map((category) => (
            <div key={category} className="papers-group">
              <h2 className="label">{PAPER_CATEGORY[category]}</h2>
              <ul className="papers">{shown.filter((paper) => paper.category === category).map(row)}</ul>
            </div>
          ))}
          {optional.length > 0 && (
            <details className="more papers-more">
              <summary>{counted(optional.length, OPTIONAL)}</summary>
              <ul className="papers">{optional.map(row)}</ul>
            </details>
          )}
          {mayUpload && (
            <details className="more papers-more">
              <summary>أضف مستنداً تطلبه جهة بعينها</summary>
              <AddPaper dealId={deal.id} />
            </details>
          )}
        </section>
      </div>
    </>
  );
}
