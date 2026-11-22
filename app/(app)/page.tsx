import Link from "next/link";
import { all, get } from "@/lib/db";
import { requireUser, can } from "@/lib/auth";
import { STATUS, STATUS_ORDER, AUDIT_ACTION } from "@/lib/labels";
import { PageHeader, Metric, MetricStrip, Empty, SectionTitle, Callout, dateAr, dateTimeAr, DOT } from "@/components/ui";
import { Icon } from "@/components/icon";
import { CountUp } from "@/components/count-up";

export const dynamic = "force-dynamic";

interface Row { id: number; full_name: string; status: string; next_step: string | null; next_step_due: string | null; owner_name: string | null }

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ mine?: string; denied?: string }> }) {
  const u = await requireUser();
  const { mine, denied } = await searchParams;
  const rows = await all<Row>(
    `SELECT c.id, c.full_name, c.status, c.next_step, c.next_step_due, u.name owner_name
     FROM clients c LEFT JOIN users u ON u.id = c.owner_id ${mine ? "WHERE c.owner_id = ?" : ""} ORDER BY c.updated_at DESC`,
    ...(mine ? [u.id] : []),
  );
  const by = (s: string) => rows.filter((r) => r.status === s);
  const active = rows.filter((r) => !["approved", "rejected"].includes(r.status));
  const deals = await all<{ stage: string; capital: number | null; fee: number | null }>("SELECT stage, capital, fee FROM deals");
  const openDeals = deals.filter((d) => d.stage !== "closed" && d.stage !== "lost");
  const deployed = deals.filter((d) => !["study", "agreement", "recovered", "closed", "lost"].includes(d.stage)).reduce((a, d) => a + (d.capital ?? 0), 0);
  const expected = openDeals.reduce((a, d) => a + (d.fee ?? 0), 0);
  const waiting = Number((await get<{ n: number }>("SELECT COUNT(*) n FROM wa_messages m WHERE m.id IN (SELECT MAX(id) FROM wa_messages GROUP BY phone) AND m.direction = 'in'"))?.n ?? 0);
  const today = new Date().toISOString().slice(0, 10);
  const due = active.filter((r) => r.next_step && r.next_step_due).sort((a, b) => a.next_step_due!.localeCompare(b.next_step_due!)).slice(0, 6);
  const noStep = active.filter((r) => !r.next_step).slice(0, Math.max(0, 6 - due.length));
  const activity = await all<{ action: string; created_at: string; name: string | null; full_name: string | null; entity_id: number | null }>(
    `SELECT a.action, a.created_at, u.name, c.full_name, a.entity_id FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN clients c ON a.entity = 'client' AND c.id = a.entity_id WHERE a.action NOT IN ('login','logout','login_failed') ORDER BY a.id DESC LIMIT 7`,
  );
  const hour = (new Date().getUTCHours() + 3) % 24;
  const max = Math.max(1, ...STATUS_ORDER.map((s) => by(s).length));

  return (
    <>
      <PageHeader
        title={`${hour < 12 ? "صباح الخير" : "مساء الخير"}، ${u.name.split(" ")[0]}`}
        sub={new Date().toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Riyadh" })}
        actions={<>
          <div className="seg"><Link href="/" className={`seg-item ${!mine ? "seg-on" : ""}`}>الكل</Link><Link href="/?mine=1" className={`seg-item ${mine ? "seg-on" : ""}`}>ملفاتي</Link></div>
          {can(u, "client.create") && <Link href="/clients/new" className="btn-primary"><Icon name="plus" className="size-4" />عميل جديد</Link>}
        </>}
      />
      {denied && <div className="mb-5"><Callout tone="red">ليست لديك صلاحية لفتح تلك الصفحة.</Callout></div>}

      <div className="stagger space-y-6">
        <MetricStrip>
          <Metric label="ملفات نشطة" value={<CountUp value={active.length} />} hint={`من ${rows.length} ملف`} />
          <Metric label="صفقات مفتوحة" value={<CountUp value={openDeals.length} />} hint={<Link href="/deals" className="hover:text-ink">لوحة الصفقات</Link>} />
          <Metric label="رأس مال موظّف" value={<CountUp value={deployed} />} unit="ر.س" />
          <Metric label="أتعاب متوقعة" value={<CountUp value={expected} />} unit="ر.س" tone="brand" />
        </MetricStrip>

        <div className="card p-5 sm:p-6">
          <SectionTitle action={<Link href="/clients" className="text-xs font-semibold text-slate-500 hover:text-ink inline-flex items-center gap-1">كل العملاء<Icon name="arrow-left" className="size-3.5" /></Link>}>مسار الملفات</SectionTitle>
          <div className="grid grid-cols-5 gap-2 sm:gap-4">
            {STATUS_ORDER.map((s, i) => {
              const n = by(s).length;
              return (
                <Link key={s} href={`/clients?status=${s}`} className="group min-w-0">
                  <div className="h-16 flex items-end">
                    <div className={`w-full rounded-t-[10px] rounded-b-[3px] origin-bottom ${DOT[STATUS[s].tone]} ${n ? "opacity-90 group-hover:opacity-100" : "opacity-25"} transition-opacity`} style={{ height: `${Math.max(6, (n / max) * 100)}%`, animation: `rise .6s var(--ease-out) ${i * 70}ms both` }} />
                  </div>
                  <div className="mt-2.5 figure text-xl font-semibold leading-none">{n}</div>
                  <div className="mt-1 text-[11.5px] text-slate-500 group-hover:text-ink transition-colors leading-4">{STATUS[s].label}</div>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="grid lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 card overflow-hidden">
            <div className="px-5 sm:px-6 pt-5"><SectionTitle>يحتاج انتباهك</SectionTitle></div>
            {waiting === 0 && due.length === 0 && noStep.length === 0 ? (
              <Empty art="path" title="لا شيء عاجل">كل الملفات تسير في مسارها.</Empty>
            ) : (
              <ul className="pb-2">
                {waiting > 0 && (
                  <li><Link href="/inbox" className="flex items-center gap-3 px-5 sm:px-6 py-3 hover:bg-slate-50 transition-colors">
                    <span className="size-9 rounded-[11px] bg-brand-50 text-brand-700 grid place-items-center"><Icon name="chat" /></span>
                    <span className="flex-1 text-sm font-semibold"><span className="num">{waiting}</span> {waiting === 1 ? "محادثة بانتظار ردك" : "محادثات بانتظار ردك"}</span>
                    <Icon name="chevron-left" className="size-4 text-slate-300" />
                  </Link></li>
                )}
                {due.map((r) => {
                  const late = r.next_step_due! < today, now = r.next_step_due === today;
                  return (
                    <li key={r.id}><Link href={`/clients/${r.id}`} className="flex items-center gap-3 px-5 sm:px-6 py-3 hover:bg-slate-50 transition-colors">
                      <span className={`size-9 rounded-[11px] grid place-items-center ${late ? "bg-rose-50 text-rose-700" : now ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}><Icon name={late ? "alert" : "clock"} /></span>
                      <span className="flex-1 min-w-0"><span className="block text-sm font-semibold truncate">{r.next_step}</span><span className="block text-xs text-slate-500 truncate">{r.full_name}</span></span>
                      <span className={`text-xs font-semibold whitespace-nowrap ${late ? "text-rose-700" : now ? "text-amber-700" : "text-slate-500"}`}>{late ? "متأخر · " : now ? "اليوم · " : ""}{dateAr(r.next_step_due)}</span>
                    </Link></li>
                  );
                })}
                {noStep.map((r) => (
                  <li key={r.id}><Link href={`/clients/${r.id}`} className="flex items-center gap-3 px-5 sm:px-6 py-3 hover:bg-slate-50 transition-colors">
                    <span className="size-9 rounded-[11px] bg-slate-100 text-slate-500 grid place-items-center"><Icon name="compass" /></span>
                    <span className="flex-1 min-w-0"><span className="block text-sm font-semibold truncate">{r.full_name}</span><span className="block text-xs text-slate-500">بلا خطوة قادمة</span></span>
                    <Icon name="chevron-left" className="size-4 text-slate-300" />
                  </Link></li>
                ))}
              </ul>
            )}
          </div>

          <div className="lg:col-span-2 card p-5 sm:p-6">
            <SectionTitle>آخر النشاط</SectionTitle>
            {activity.length === 0 ? <div className="text-sm text-slate-500">لا نشاط بعد.</div> : (
              <ol className="relative">
                <span className="absolute top-2 bottom-2 start-[3px] w-px bg-slate-200" />
                {activity.map((a, i) => (
                  <li key={i} className="relative ps-5 pb-4 last:pb-0">
                    <span className="absolute start-0 top-[7px] size-[7px] rounded-full bg-gold ring-4 ring-white" />
                    <div className="text-[13px] leading-5"><span className="font-semibold">{a.name ?? "النظام"}</span> <span className="text-slate-600">{AUDIT_ACTION[a.action] ?? a.action}</span>{a.full_name && <> · <Link className="font-medium hover:text-brand-700" href={`/clients/${a.entity_id}`}>{a.full_name}</Link></>}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{dateTimeAr(a.created_at)}</div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
