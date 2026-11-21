import Link from "next/link";
import { all, get } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { docProgressMap } from "@/lib/data";
import { STATUS, STATUS_ORDER, FINANCE_TYPE, AUDIT_ACTION } from "@/lib/labels";
import { EligBadge, PageHeader, Progress, Stat, sar, dateAr, dateTimeAr, DOT } from "@/components/ui";

export const dynamic = "force-dynamic";

interface Row { id: number; file_no: string; full_name: string; finance_type: keyof typeof FINANCE_TYPE; requested_amount: number | null; status: string; eligibility: string; next_step: string | null; next_step_due: string | null; owner_name: string | null; updated_at: string }

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ mine?: string; denied?: string }> }) {
  const u = await requireUser();
  const { mine, denied } = await searchParams;
  const rows = await all<Row>(
    `SELECT c.id, c.file_no, c.full_name, c.finance_type, c.requested_amount, c.status, c.eligibility, c.next_step, c.next_step_due, c.updated_at, u.name owner_name
     FROM clients c LEFT JOIN users u ON u.id = c.owner_id ${mine ? "WHERE c.owner_id = ?" : ""} ORDER BY c.updated_at DESC`,
    ...(mine ? [u.id] : []),
  );
  const prog = await docProgressMap(rows.map((r) => r.id));
  const by = (s: string) => rows.filter((r) => r.status === s);
  const active = rows.filter((r) => !["approved", "rejected"].includes(r.status));
  const pipeline = active.reduce((s, r) => s + (r.requested_amount || 0), 0);
  const approvedAmt = (await get<{ s: number }>("SELECT COALESCE(SUM(amount),0) s FROM applications WHERE status IN ('approved','disbursed')"))?.s ?? 0;
  const deals = await all<{ stage: string; capital: number | null; fee: number | null }>("SELECT stage, capital, fee FROM deals");
  const openDeals = deals.filter((d) => d.stage !== "closed" && d.stage !== "lost");
  const deployed = deals.filter((d) => !["study", "agreement", "recovered", "closed", "lost"].includes(d.stage)).reduce((a, d) => a + (d.capital ?? 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const due = active.filter((r) => r.next_step && r.next_step_due).sort((a, b) => a.next_step_due!.localeCompare(b.next_step_due!)).slice(0, 6);
  const activity = await all<{ action: string; created_at: string; name: string | null; full_name: string | null; entity_id: number | null }>(
    `SELECT a.action, a.created_at, u.name, c.full_name, a.entity_id FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN clients c ON a.entity = 'client' AND c.id = a.entity_id WHERE a.action NOT IN ('login','logout','login_failed') ORDER BY a.id DESC LIMIT 8`,
  );

  return (
    <>
      <PageHeader
        title={`أهلاً ${u.name.split(" ")[0]} 👋`}
        sub={new Date().toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long" })}
        actions={<>
          <Link href={mine ? "/" : "/?mine=1"} className="btn-ghost">{mine ? "كل العملاء" : "عملائي فقط"}</Link>
          <Link href="/clients/new" className="btn-primary">+ عميل جديد</Link>
        </>}
      />
      {denied && <div className="mb-6 rounded-xl bg-rose-50 text-rose-700 px-4 py-3 text-sm">ليست لديك صلاحية لفتح تلك الصفحة.</div>}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <Stat label="ملفات نشطة" value={active.length} hint={`من أصل ${rows.length} ملف`} />
        <Stat label="بانتظار مستندات" value={by("awaiting_docs").length} tone="orange" hint="تحتاج متابعة مع العميل" />
        <Stat label="حجم التمويل قيد العمل" value={sar(pipeline)} tone="blue" hint="ريال — مجموع المبالغ المطلوبة" />
        <Stat label="تمويل معتمد" value={sar(approvedAmt)} tone="green" hint="ريال — موافقات وصرف" />
      </div>

      <Link href="/deals" className="card p-5 mb-8 flex flex-wrap items-center gap-x-8 gap-y-2 hover:ring-brand-300">
        <span className="font-bold">💼 الصفقات</span>
        <span className="text-sm text-slate-500">مفتوحة <b className="num text-slate-800">{openDeals.length}</b></span>
        <span className="text-sm text-slate-500">رأس مال موظّف <b className="num text-orange-700">{sar(deployed)}</b></span>
        <span className="text-sm text-slate-500">أتعاب متوقعة <b className="num text-brand-700">{sar(openDeals.reduce((a, d) => a + (d.fee ?? 0), 0))}</b></span>
        <span className="text-sm text-brand-700 ms-auto">لوحة الصفقات ←</span>
      </Link>

      <h2 className="font-bold mb-3">مسار الملفات</h2>
      <div className="flex gap-4 overflow-x-auto pb-4 mb-6 snap-x">
        {STATUS_ORDER.map((s) => (
          <div key={s} className="min-w-[260px] flex-1 snap-start">
            <div className="flex items-center gap-2 mb-2 px-1">
              <span className={`size-2 rounded-full ${DOT[STATUS[s].tone]}`} />
              <span className="text-sm font-bold">{STATUS[s].label}</span>
              <span className="text-xs text-slate-400 num">{by(s).length}</span>
            </div>
            <div className="space-y-2.5 rounded-2xl bg-slate-100/70 p-2.5 min-h-32">
              {by(s).map((r) => {
                const d = prog.get(r.id) ?? { pct: 0, required: 0, requiredDone: 0 };
                return (
                  <Link key={r.id} href={`/clients/${r.id}`} className="card block p-3.5 hover:ring-2 hover:ring-brand-200 transition">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-sm leading-6">{r.full_name}</div>
                      <span className="text-[10px] text-slate-400 num">{r.file_no}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">{FINANCE_TYPE[r.finance_type]} · <span className="num">{sar(r.requested_amount)}</span> ر.س</div>
                    <div className="mt-2.5 flex items-center gap-2"><EligBadge e={r.eligibility} /></div>
                    <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
                      <span>المستندات</span><Progress pct={d.pct} tone={d.pct === 100 ? "green" : "brand"} /><span className="num">{d.pct}%</span>
                    </div>
                    {r.next_step && <div className="mt-2.5 text-xs bg-slate-50 rounded-lg px-2 py-1.5 text-slate-600">⏭ {r.next_step}</div>}
                  </Link>
                );
              })}
              {by(s).length === 0 && <div className="text-xs text-slate-400 text-center py-6">لا يوجد</div>}
            </div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <h3 className="font-bold mb-4">الخطوات القادمة</h3>
          <ul className="space-y-3">
            {due.map((r) => (
              <li key={r.id} className="flex items-center gap-3">
                <span className={`text-xs font-bold rounded-lg px-2 py-1 num ${r.next_step_due! < today ? "bg-rose-50 text-rose-700" : r.next_step_due === today ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{dateAr(r.next_step_due)}</span>
                <Link href={`/clients/${r.id}`} className="flex-1 min-w-0"><div className="text-sm font-semibold truncate">{r.next_step}</div><div className="text-xs text-slate-500">{r.full_name} · {r.owner_name}</div></Link>
              </li>
            ))}
            {due.length === 0 && <li className="text-sm text-slate-500">لا توجد خطوات مجدولة</li>}
          </ul>
        </div>
        <div className="card p-5">
          <h3 className="font-bold mb-4">آخر النشاطات</h3>
          <ul className="space-y-3">
            {activity.map((a, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="mt-1.5 size-1.5 rounded-full bg-brand-500 shrink-0" />
                <div className="flex-1"><span className="font-semibold">{a.name ?? "النظام"}</span> {AUDIT_ACTION[a.action] ?? a.action}{a.full_name && <> — <Link className="text-brand-700 hover:underline" href={`/clients/${a.entity_id}`}>{a.full_name}</Link></>}</div>
                <span className="text-xs text-slate-400 whitespace-nowrap">{dateTimeAr(a.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
