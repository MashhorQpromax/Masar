import Link from "next/link";
import { all } from "@/lib/db";
import { requireUser, can } from "@/lib/auth";
import { docProgressMap } from "@/lib/data";
import { STATUS, STATUS_ORDER, FINANCE_TYPE } from "@/lib/labels";
import { EligBadge, PageHeader, Progress, StatusBadge, sar, Empty } from "@/components/ui";
import { Icon } from "@/components/icon";

export const dynamic = "force-dynamic";

export default async function Clients({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const where: string[] = [];
  const params: unknown[] = [];
  if (sp.q) { where.push("(c.full_name LIKE ? OR c.file_no LIKE ? OR c.phone LIKE ? OR c.employer LIKE ?)"); params.push(...Array(4).fill(`%${sp.q}%`)); }
  if (sp.elig) { where.push("c.eligibility = ?"); params.push(sp.elig); }
  if (sp.type) { where.push("c.finance_type = ?"); params.push(sp.type); }
  const all_ = await all<{ id: number; file_no: string; full_name: string; finance_type: keyof typeof FINANCE_TYPE; requested_amount: number | null; status: string; eligibility: string; next_step: string | null }>(
    `SELECT c.id, c.file_no, c.full_name, c.finance_type, c.requested_amount, c.status, c.eligibility, c.next_step FROM clients c ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY c.updated_at DESC`,
    ...params,
  );
  const rows = sp.status ? all_.filter((r) => r.status === sp.status) : all_;
  const prog = await docProgressMap(rows.map((r) => r.id));
  const link = (status?: string) => { const p = new URLSearchParams(); if (sp.q) p.set("q", sp.q); if (status) p.set("status", status); const s = p.toString(); return s ? `/clients?${s}` : "/clients"; };
  return (
    <>
      <PageHeader title="العملاء" actions={can(u, "client.create") && <Link href="/clients/new" className="btn-primary"><Icon name="plus" className="size-4" />عميل جديد</Link>} />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="seg overflow-x-auto max-w-full">
          <Link href={link()} className={`seg-item ${!sp.status ? "seg-on" : ""}`}>الكل<span className="num text-[11px] text-slate-400">{all_.length}</span></Link>
          {STATUS_ORDER.map((k) => <Link key={k} href={link(k)} className={`seg-item ${sp.status === k ? "seg-on" : ""}`}>{STATUS[k].label}<span className="num text-[11px] text-slate-400">{all_.filter((r) => r.status === k).length}</span></Link>)}
        </div>
        <form className="relative flex-1 min-w-52 ms-auto max-w-sm">
          {sp.status && <input type="hidden" name="status" value={sp.status} />}
          <Icon name="search" className="size-4 text-slate-400 absolute start-3 top-3 pointer-events-none" />
          <input name="q" defaultValue={sp.q} placeholder="اسم، رقم ملف، جوال" className="input ps-9" />
        </form>
      </div>
      {rows.length === 0 ? (
        <div className="card"><Empty art={sp.q ? "search" : "path"} title={sp.q ? "لا نتائج مطابقة" : "لا ملفات هنا بعد"} action={!sp.q && can(u, "client.create") ? <Link href="/clients/new" className="btn-primary">فتح أول ملف</Link> : undefined} /></div>
      ) : (
        <div className="card overflow-hidden">
          <div className="hidden md:grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.5fr)_auto_auto_120px_minmax(0,1.8fr)] gap-x-5 px-5 border-b border-slate-200/70">
            {["العميل", "التمويل", "الحالة", "الأهلية", "المستندات", "الخطوة القادمة"].map((h, i) => <div key={h} className={`text-[11px] font-semibold text-slate-500 py-2.5 ${i === 2 ? "w-32" : i === 3 ? "w-32" : ""}`}>{h}</div>)}
          </div>
          <ul>
            {rows.map((r) => {
              const d = prog.get(r.id) ?? { pct: 0, required: 0, requiredDone: 0 };
              return (
                <li key={r.id} className="border-b border-slate-100 last:border-0">
                  <Link href={`/clients/${r.id}`} className="grid grid-cols-[1fr_auto] md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.5fr)_auto_auto_120px_minmax(0,1.8fr)] gap-x-5 gap-y-2 items-center px-5 py-3.5 hover:bg-slate-50/70 transition-colors">
                    <div className="min-w-0"><div className="font-semibold text-sm truncate">{r.full_name}</div><div className="num text-[11px] text-slate-400 text-start">{r.file_no}</div></div>
                    <div className="min-w-0 hidden md:block"><div className="text-[13px] truncate">{FINANCE_TYPE[r.finance_type]}</div><div className="num text-xs text-slate-500 text-start">{sar(r.requested_amount)}</div></div>
                    <div className="md:w-32"><StatusBadge s={r.status} /></div>
                    <div className="hidden md:block w-32"><EligBadge e={r.eligibility} /></div>
                    <div className="hidden md:flex items-center gap-2"><Progress pct={d.pct} tone={d.pct === 100 ? "green" : "brand"} /><span className="text-[11px] num text-slate-500">{d.requiredDone}/{d.required}</span></div>
                    <div className="col-span-2 md:col-span-1 text-xs text-slate-600 truncate">{r.next_step ?? <span className="text-slate-300">—</span>}</div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
