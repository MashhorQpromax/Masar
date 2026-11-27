import Link from "next/link";
import type { CSSProperties } from "react";
import { BY_OFFICE, FILE_KIND, fileTitle, PAPER_CATEGORY, PAPER_STATUS, paperLabel, statedLine, TRAY } from "@/copy/documents";
import { counted, ltr } from "@/copy/format";
import { INBOX_PAPER, PAPER_CATEGORIES, PAPER_MAX_FILES, SIMAH_PAPER, statesOf, type Checklist, type Paper, type PaperStatus } from "@/domain/documents";
import type { Nationality } from "@/domain/eligibility";
import type { Sector } from "@/domain/shared/sector";
import { CheckIcon, CloseIcon } from "@/ui/icons";
import { PaperUpload } from "@/ui/PaperUpload";
import { SubmitButton } from "@/ui/SubmitButton";
import { AddPaper } from "./AddPaper";
import { PaperFigures } from "./PaperFigures";
import { dropPaper, fileUnder, judgePaper, removeFile, uploadPaperFile } from "./actions";

const OPTIONAL = { one: "مستند اختياري", two: "مستندان اختياريان", few: "مستندات اختيارية", many: "مستنداً اختيارياً" };

const SHEET_ORDER: Record<PaperStatus, number> = { verified: 0, received: 1, rejected: 2, missing: 3 };

/**
 * The file as a row of sheets, one for each paper it needs: gold when it was verified, white when it
 * arrived, an outline while it is still owed. The drawing is the count.
 */
export function Sheets({ states }: { states: PaperStatus[] }) {
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

/**
 * Every paper of a file, group by group: what arrived by WhatsApp first, then each paper with its
 * files and what may be done with it, the optional ones nobody sent folded away, and a place to add
 * a paper by name. The same list serves a deal's client and a project's own file.
 */
export function PapersList({
  home,
  clientId,
  list,
  who,
  file = "deal",
  may,
  disputed,
}: {
  /** Whose papers these are, as the forms carry it: "d12" for a deal, "p7" for a project's file. */
  home: string;
  clientId: number;
  list: Checklist;
  who: { sector: Sector; nationality: Nationality };
  file?: "deal" | "project";
  may: { upload: boolean; verify: boolean; open: boolean };
  /** The checked papers whose figures the file disputes. */
  disputed?: ReadonlySet<number>;
}) {
  const { upload: mayUpload, verify: mayVerify, open: mayOpen } = may;
  const name = (paper: Paper) => paperLabel(paper, who, file);
  // An optional paper nobody sent stays out of the way until someone wants it.
  const idle = (paper: Paper) => !paper.required && paper.files.length === 0;
  // What arrived by WhatsApp is not a paper yet. It has its own place at the top, where each file is put under one.
  const tray = list.papers.find((paper) => paper.code === INBOX_PAPER);
  const shown = list.papers.filter((paper) => !idle(paper) && paper !== tray);
  const homes = list.papers.filter((paper) => paper !== tray && paper.code !== SIMAH_PAPER && paper.asked);
  const optional = list.papers.filter(idle);

  const row = (paper: Paper) => {
    const label = name(paper);
    const simah = paper.code === SIMAH_PAPER;
    const hasFiles = paper.files.length > 0;
    // The figures this paper states, which whoever checks it writes down.
    const states = statesOf(paper.code);
    const said = statedLine(paper.stated);
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
          {paper.status === "verified" && states.length > 0 && (
            <p className="paper-stated" data-conflict={(paper.id != null && disputed?.has(paper.id)) || undefined} data-empty={!said || undefined}>
              {said || "لم يُكتب ما فيه، فلا يثبت به رقم."}
            </p>
          )}
        </div>
        <div className="paper-files">
          {paper.files.map((kept, index) => {
            // A file's name can carry the client's own. Who may not open the file does not read its name either.
            const title = mayOpen ? fileTitle(kept.name) : `ملف ${ltr(index + 1)}`;
            return (
              <span key={kept.id} className="file">
                {mayOpen ? (
                  <a href={`/files/${kept.id}`} target="_blank" rel="noreferrer">
                    <small>{FILE_KIND[kept.kind]}</small>
                    <bdi>{title}</bdi>
                  </a>
                ) : (
                  <span>
                    <small>{FILE_KIND[kept.kind]}</small>
                    <bdi>{title}</bdi>
                  </span>
                )}
                {mayUpload && !simah && (
                  <form action={removeFile}>
                    <input type="hidden" name="home" value={home} />
                    <input type="hidden" name="fileId" value={kept.id} />
                    <button type="submit" className="file-remove" aria-label={`احذف ${title}`}>
                      <CloseIcon size={14} />
                    </button>
                  </form>
                )}
              </span>
            );
          })}
          {mayUpload && !simah && hasFiles && paper.files.length < PAPER_MAX_FILES && <PaperUpload send={uploadPaperFile.bind(null, home, paper.code)} name={label} look="more" />}
        </div>
        <div className="paper-do">
          {simah ? (
            mayOpen && (
              <Link className="btn btn--soft" href={`/clients/${clientId}/credit`}>
                {paper.status === "verified" ? "السجل الائتماني" : "ارفعه ليُقرأ"}
              </Link>
            )
          ) : (
            <>
              {mayVerify && hasFiles && paper.id != null && paper.status !== "verified" && states.length === 0 && (
                <form action={judgePaper}>
                  <input type="hidden" name="home" value={home} />
                  <input type="hidden" name="paperId" value={paper.id} />
                  <input type="hidden" name="verdict" value="verified" />
                  <SubmitButton className="btn btn--navy">سليم</SubmitButton>
                </form>
              )}
              {mayVerify && hasFiles && paper.id != null && states.length > 0 && (
                <PaperFigures key={paper.status} home={home} paperId={paper.id} name={label} facts={states} stated={paper.stated} verify={paper.status !== "verified"} />
              )}
              {mayVerify && hasFiles && paper.id != null && paper.status !== "rejected" && (
                <details className="send-back">
                  <summary className="btn btn--ghost">أعده</summary>
                  <form action={judgePaper}>
                    <input type="hidden" name="home" value={home} />
                    <input type="hidden" name="paperId" value={paper.id} />
                    <input type="hidden" name="verdict" value="rejected" />
                    <input className="field-input" name="note" required minLength={2} maxLength={200} placeholder="لماذا يُعاد؟" aria-label={`سبب إعادة ${label}`} autoComplete="off" />
                    <SubmitButton className="btn btn--soft">أعده للعميل</SubmitButton>
                  </form>
                </details>
              )}
              {mayUpload && !hasFiles && <PaperUpload send={uploadPaperFile.bind(null, home, paper.code)} name={label} look="soft" />}
              {mayUpload && paper.category === "extra" && !hasFiles && paper.id != null && (
                <form action={dropPaper}>
                  <input type="hidden" name="home" value={home} />
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
    <section className="tile tile--wide">
      {tray && (
        <div className="papers-group tray">
          <h2 className="label">{TRAY}</h2>
          <p className="tray-say">{mayUpload ? "افتح كل ملف ثم ضعه تحت مستنده." : "ملفات أرسلها العميل وتنتظر من يضعها تحت مستنداتها."}</p>
          <ul className="papers">
            {tray.files.map((kept, index) => {
              const title = mayOpen ? fileTitle(kept.name) : `ملف ${ltr(index + 1)}`;
              return (
                <li key={kept.id} className="paper">
                  <div className="paper-files">
                    <span className="file">
                      {mayOpen ? (
                        <a href={`/files/${kept.id}`} target="_blank" rel="noreferrer">
                          <small>{FILE_KIND[kept.kind]}</small>
                          <bdi>{title}</bdi>
                        </a>
                      ) : (
                        <span>
                          <small>{FILE_KIND[kept.kind]}</small>
                          <bdi>{title}</bdi>
                        </span>
                      )}
                    </span>
                  </div>
                  {mayUpload && (
                    <form action={fileUnder} className="tray-put">
                      <input type="hidden" name="home" value={home} />
                      <input type="hidden" name="fileId" value={kept.id} />
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
                      <input type="hidden" name="home" value={home} />
                      <input type="hidden" name="fileId" value={kept.id} />
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
          <AddPaper home={home} />
        </details>
      )}
    </section>
  );
}
