import type { Metadata } from "next";
import Link from "next/link";
import { SECTOR } from "@/copy/editor";
import { FINANCE_TYPE } from "@/copy/eligibility";
import { counted, dayOf } from "@/copy/format";
import { allAcceptedText, DECISIONS_COUNT, NOTES } from "@/copy/knowledge";
import { can } from "@/domain/auth";
import { FINANCE_TYPES, type FinanceType, type Sector } from "@/domain/eligibility";
import { experience, rulesByLender } from "@/domain/knowledge";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { getKnowledge } from "@/server/knowledge/service";
import { AnswerRow, DecisionRow, NoteRow } from "@/ui/knowledge";
import { SubmitButton } from "@/ui/SubmitButton";
import { LendersNav } from "../LendersNav";
import { removeNote } from "./actions";
import { NoteForm } from "./NoteForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "الخبرة · مسار" };

/** The kinds of finance the office deals in most come first. */
const KIND_ORDER: FinanceType[] = ["mortgage", "personal", ...FINANCE_TYPES.filter((kind) => kind !== "mortgage" && kind !== "personal")];
const NOTE_KINDS: FinanceType[] = ["mortgage", "personal", "auto"];

const sectorText = (sector: string): string => SECTOR[sector as Sector] ?? "";

/**
 * What the office knows about its lenders beyond their terms: what each one actually answered, and the
 * notes people wrote down. It names no client.
 */
export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const me = await requireActor();
  const mayWrite = can(me.role, "client.edit");
  const mayRemove = can(me.role, "lender.manage");
  const view = await getKnowledge(await getDb());
  const now = new Date();

  const kinds = KIND_ORDER.filter((kind) => view.facts.some((fact) => fact.financeType === kind));
  const asked = (await searchParams).kind;
  const kind = kinds.find((k) => k === asked) ?? kinds[0] ?? null;
  const nameOf = new Map(view.lenders.map((lender) => [lender.id, lender.name]));
  const answers = kind ? [...experience(view.facts, kind).values()].sort((a, b) => b.n - a.n) : [];
  const groups = rulesByLender(view.rules);

  return (
    <>
      <div className="head">
        <div>
          <h1 className="title">الخبرة</h1>
        </div>
        <div className="head-side">
          <p className="where">
            {view.rules.length ? counted(view.rules.length, NOTES) : "لا ملاحظات"} · <b>{view.facts.length ? counted(view.facts.length, DECISIONS_COUNT) : "لا قرارات مسجلة"}</b>
          </p>
          {mayWrite && (
            <a className="btn btn--soft know-jump" href="#new-note">
              أضف ملاحظة
            </a>
          )}
        </div>
      </div>
      <LendersNav current="/lenders/knowledge" />

      <div className="know">
        <div className="know-main">
          <section className="tile know-answers">
            <div className="know-top">
              <div>
                <p className="label">ما قررته الجهات</p>
                {answers.length > 0 && <h2 className="know-sum">{allAcceptedText({ n: answers.reduce((n, e) => n + e.n, 0), approved: answers.reduce((n, e) => n + e.approved, 0) })}</h2>}
              </div>
              {kinds.length > 1 && (
                <nav className="know-kinds" aria-label="نوع التمويل">
                  {kinds.map((k) => (
                    <Link key={k} href={`/lenders/knowledge?kind=${k}`} aria-current={k === kind ? "true" : undefined} scroll={false}>
                      {FINANCE_TYPE[k]}
                    </Link>
                  ))}
                </nav>
              )}
            </div>
            {answers.length ? (
              <ol className="answers">
                {answers.map((e) => (
                  <AnswerRow key={e.lenderId} name={nameOf.get(e.lenderId) ?? ""} e={e} />
                ))}
              </ol>
            ) : (
              <p className="know-none">لم يُسجَّل قرار جهة بعد. سجّله من صفحة جهات التمويل في ملف الصفقة، فتظهر هنا نسبة قبول كل جهة وما تطلبه.</p>
            )}
            {view.recent.length > 0 && (
              <details className="more know-latest">
                <summary>آخر القرارات</summary>
                <ol>
                  {view.recent.map((line) => (
                    <DecisionRow key={line.id} line={line} now={now} sub={[line.financeType && FINANCE_TYPE[line.financeType], sectorText(line.sector)].filter(Boolean).join(" · ")} />
                  ))}
                </ol>
              </details>
            )}
          </section>

          {groups.map((group) => (
            <section key={group.lenderId ?? "all"} className="tile know-group" data-every={group.lenderId == null || undefined}>
              <h2 className="lender-name">
                {group.lenderName ?? "كل الجهات"}
                <small>{counted(group.rules.length, NOTES)}</small>
              </h2>
              <ul className="know-notes">
                {group.rules.map((rule) => (
                  <NoteRow key={rule.id} rule={rule} meta={[rule.financeType && FINANCE_TYPE[rule.financeType], rule.author, rule.author && dayOf(rule.createdAt, now)].filter(Boolean).join(" · ")}>
                    {mayRemove && (
                      <details className="know-remove">
                        <summary aria-label={`حذف: ${rule.title}`}>حذف</summary>
                        <form action={removeNote}>
                          <input type="hidden" name="ruleId" value={rule.id} />
                          <SubmitButton className="btn btn--soft">نعم، احذفها</SubmitButton>
                        </form>
                      </details>
                    )}
                  </NoteRow>
                ))}
              </ul>
            </section>
          ))}
          {!groups.length && (
            <section className="empty">
              <h2>لا ملاحظات بعد</h2>
              <p>اكتب ما تعرفه عن كل جهة: ما تطلبه خارج شروطها، وما نجح معها.</p>
            </section>
          )}
        </div>

        {mayWrite && (
          <aside id="new-note" className="tile know-side" aria-label="ملاحظة جديدة">
            <p className="label">أضف ملاحظة</p>
            <NoteForm lenders={view.lenders} kinds={NOTE_KINDS} />
          </aside>
        )}
      </div>
    </>
  );
}
