import type { Metadata } from "next";
import Link from "next/link";
import { AUDIT_AREA, auditAction, auditDetail, fromAddress, logDay, logDayKey, NOBODY } from "@/copy/audit";
import { timeText } from "@/copy/format";
import { AUDIT_AREA_NAMES, isAuditArea, isWatched, type AuditArea } from "@/domain/audit";
import { auditPeople, readAudit, type AuditLine, type AuditSubject } from "@/server/audit/log";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { BackIcon } from "@/ui/icons";
import { WhoFilter } from "./WhoFilter";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "سجل التدقيق · مسار" };

type Params = { area?: string | string[]; who?: string | string[]; before?: string | string[] };
type View = AuditArea | "watch" | null;

const one = (value: string | string[] | undefined): string => (Array.isArray(value) ? value[0] : value) ?? "";
const positive = (text: string): number | null => (/^\d{1,9}$/.test(text) && Number(text) > 0 ? Number(text) : null);

/** The address of the log with these choices. A choice that is not made is left out of it. */
function address(view: View, who: number | null, before?: number | null): string {
  const query = new URLSearchParams();
  if (view) query.set("area", view);
  if (who != null) query.set("who", String(who));
  if (before != null) query.set("before", String(before));
  const text = query.toString();
  return text ? `/audit?${text}` : "/audit";
}

/** Where an event's subject can be opened. An account has no page of its own. */
const doorTo = (subject: AuditSubject): string => (subject.kind === "client" ? `/clients/${subject.id}` : subject.kind === "deal" ? `/deals/${subject.id}` : subject.kind === "product" ? "/lenders" : "/users");

/** Everything that was done in the system and by whom, the newest first. For the person who answers for the office. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireActor("audit.view");
  const params = await searchParams;
  const typed = one(params.area);
  const view: View = typed === "watch" ? "watch" : isAuditArea(typed) ? typed : null;
  const who = positive(one(params.who));
  const before = positive(one(params.before));
  const now = new Date();

  const db = await getDb();
  const [{ lines, next }, people] = await Promise.all([
    readAudit(db, { area: view && view !== "watch" ? view : undefined, watched: view === "watch", userId: who ?? undefined, before: before ?? undefined }),
    auditPeople(db),
  ]);

  const days: { key: string; name: string; lines: AuditLine[] }[] = [];
  for (const line of lines) {
    const key = logDayKey(line.at);
    if (days.at(-1)?.key !== key) days.push({ key, name: logDay(line.at, now), lines: [] });
    days.at(-1)!.lines.push(line);
  }

  const views: { view: View; name: string }[] = [{ view: null, name: "الكل" }, { view: "watch", name: "يستحق نظرة" }, ...AUDIT_AREA_NAMES.map((area) => ({ view: area as View, name: AUDIT_AREA[area] }))];

  return (
    <>
      <header className="head">
        <div>
          <Link className="back" href="/account">
            <BackIcon />
            حسابي
          </Link>
          <h1 className="title">سجل التدقيق</h1>
          <p className="lede">كل ما جرى في مسار، ومن قام به.</p>
        </div>
      </header>

      <nav className="filters" aria-label="تصفية السجل">
        {views.map((item) => (
          <Link key={item.view ?? "all"} className="filter" href={address(item.view, who)} aria-current={item.view === view ? "true" : undefined} data-watch={item.view === "watch" || undefined}>
            {item.name}
          </Link>
        ))}
        <WhoFilter people={people} chosen={who} hrefs={Object.fromEntries([["", address(view, null)], ...people.map((person) => [String(person.id), address(view, person.id)])])} />
      </nav>

      {days.length === 0 ? (
        <div className="empty">
          <p className="text-body">{before ? "لا شيء أقدم من هذا." : "لا أحداث بهذا الاختيار."}</p>
        </div>
      ) : (
        <div className="log">
          {days.map((day, index) => (
            <section key={day.key} className="tile log-day" style={{ animationDelay: `${Math.min(index, 8) * 0.06}s` }}>
              <h2 className="log-date">{day.name}</h2>
              <ol className="events">
                {day.lines.map((line) => {
                  const detail = auditDetail(line.action, line.details);
                  // An event about the person who did it, a sign-in for one, does not name them twice.
                  const subject = line.subject && !(line.subject.kind === "user" && line.subject.id === line.who?.id) ? line.subject : null;
                  return (
                    <li key={line.id} className="event" data-watch={isWatched(line.action) || undefined}>
                      <time className="event-time" dateTime={line.at.toISOString()}>
                        {timeText(line.at)}
                      </time>
                      <i className="event-node" aria-hidden="true" />
                      <span className="event-who" data-nobody={!line.who || undefined}>
                        {line.who?.name ?? NOBODY}
                      </span>
                      <span className="event-what">
                        <b>{auditAction(line.action)}</b>
                        {detail && <span>{detail}</span>}
                      </span>
                      <span className="event-about">
                        {subject && (
                          <Link href={doorTo(subject)}>
                            {subject.name}
                            {"fileNo" in subject && subject.fileNo && <small className="num">{subject.fileNo}</small>}
                          </Link>
                        )}
                        {line.action === "login_failed" && line.ip && <small>{fromAddress(line.ip)}</small>}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}

      {next != null && (
        <p className="log-more">
          <Link className="btn btn--white" href={address(view, who, next)}>
            الأقدم
          </Link>
        </p>
      )}
      {before != null && next == null && days.length > 0 && <p className="rows-more">هذا أول السجل.</p>}
    </>
  );
}
