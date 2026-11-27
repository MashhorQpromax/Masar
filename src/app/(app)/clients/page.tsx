import type { Metadata } from "next";
import Link from "next/link";
import { filesCount, fileStateText, foundText, phoneText } from "@/copy/clients";
import { STAGE } from "@/copy/deal";
import { dayShort, initial, ltr } from "@/copy/format";
import { PROJECT_VERDICT_SHORT, projectLine } from "@/copy/project";
import { can } from "@/domain/auth";
import { fileState } from "@/domain/clients";
import { stationsFor } from "@/domain/deal";
import { requireActor } from "@/server/auth/actor";
import { listClients } from "@/server/clients/directory";
import { getDb } from "@/server/db/client";
import { PlusIcon, SearchIcon } from "@/ui/icons";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "العملاء · مسار" };

const SHOWN = 60;

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const me = await requireActor();
  const maySeeNumbers = can(me.role, "client.view_pii");
  const mayOpen = can(me.role, "client.create");
  const typed = (await searchParams).q;
  const q = (Array.isArray(typed) ? typed[0] : typed)?.trim().slice(0, 80) ?? "";
  const { rows, total } = await listClients(await getDb(), { q, byPhone: maySeeNumbers, limit: SHOWN });

  return (
    <>
      <div className="head">
        <div>
          <h1 className="title">العملاء</h1>
          <p className="lede">
            {q ? foundText(total, q) : total ? `${filesCount(total)}، آخرها حركة أولاً.` : "لا ملفات بعد."}
            {q && (
              <>
                {" "}
                <Link className="lede-link" href="/clients">
                  اعرض الجميع
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="head-side head-side--find">
          <form className="search" action="/clients" role="search">
            <SearchIcon />
            <input name="q" defaultValue={q} placeholder={maySeeNumbers ? "اسم، رقم ملف أو جوال" : "اسم أو رقم ملف"} aria-label="ابحث في العملاء" autoComplete="off" enterKeyHint="search" maxLength={80} />
            <button type="submit">ابحث</button>
          </form>
          {mayOpen && (
            <Link className="edit-link" data-soft href="/projects/new">
              <PlusIcon size={16} />
              مشروع جديد
            </Link>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          <p className="text-body">{q ? "جرّب جزءاً من الاسم، أو رقم الملف." : "يظهر هنا كل من فُتح له ملف."}</p>
        </div>
      ) : (
        <div className="rows">
          {rows.map((person, index) => {
            const state = fileState(person.deal?.stage ?? null);
            const stations = person.deal ? stationsFor(person.deal.structure) : [];
            const position = state.kind === "open" ? stations.indexOf(state.station) : -1;
            return (
              <Link key={person.id} className="row row--person" href={`/clients/${person.id}`} style={{ animationDelay: `${Math.min(index, 12) * 0.05}s` }}>
                <span className="row-who" data-tone={state.kind === "rejected" ? "bad" : undefined}>
                  <span className="avatar" aria-hidden="true">
                    {initial(person.name)}
                  </span>
                  <span>
                    <b>{person.name}</b>
                    <small className="num">{person.fileNo}</small>
                  </span>
                </span>
                <span>
                  {person.project ? (
                    <>
                      <span className="state" data-kind={person.project.rejected ? "rejected" : "project"}>
                        {person.project.rejected ? "مشروع مرفوض" : "مشروع"}
                      </span>
                      {!person.project.rejected && <small>{PROJECT_VERDICT_SHORT[person.project.verdict]}</small>}
                    </>
                  ) : state.kind === "open" ? (
                    <>
                      <span className="dots" role="img" aria-label={`المحطة ${ltr(position + 1)} من ${ltr(stations.length)}`}>
                        {stations.map((key, i) => (
                          <i key={key} data-state={i < position ? "done" : i === position ? "current" : undefined} />
                        ))}
                      </span>
                      {fileStateText(state)}
                      <small>{STAGE[state.stage]}</small>
                    </>
                  ) : (
                    <span className="state" data-kind={state.kind}>
                      {fileStateText(state)}
                    </span>
                  )}
                </span>
                <span className="row-where">
                  {person.project ? projectLine({ projectType: person.project.type, city: null, district: null }) || "-" : (person.employer ?? "-")}
                  <small>{person.project ? [person.project.district, person.project.city].filter(Boolean).join("، ") : (person.city ?? "")}</small>
                </span>
                {maySeeNumbers && <span className="row-phone num">{phoneText(person.phone) || "-"}</span>}
                <span className="row-when">
                  <small>آخر حركة</small>
                  {dayShort(person.movedAt)}
                </span>
              </Link>
            );
          })}
        </div>
      )}
      {total > rows.length && <p className="rows-more">يظهر أحدث {ltr(rows.length)} ملفاً من {ltr(total)}. ابحث للوصول إلى غيرها.</p>}
    </>
  );
}
