import Link from "next/link";
import { all } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { docProgress } from "@/lib/data";
import { STATUS, ELIGIBILITY, FINANCE_TYPE, SECTOR } from "@/lib/labels";
import { EligBadge, PageHeader, Progress, StatusBadge, sar, dateAr, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Clients({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const where: string[] = [];
  const params: unknown[] = [];
  if (sp.q) { where.push("(c.full_name LIKE ? OR c.file_no LIKE ? OR c.phone LIKE ? OR c.employer LIKE ?)"); params.push(...Array(4).fill(`%${sp.q}%`)); }
  if (sp.status) { where.push("c.status = ?"); params.push(sp.status); }
  if (sp.elig) { where.push("c.eligibility = ?"); params.push(sp.elig); }
  if (sp.type) { where.push("c.finance_type = ?"); params.push(sp.type); }
  const rows = all<{ id: number; file_no: string; full_name: string; phone: string | null; sector: keyof typeof SECTOR; finance_type: keyof typeof FINANCE_TYPE; requested_amount: number | null; status: string; eligibility: string; next_step: string | null; owner_name: string | null; updated_at: string }>(
    `SELECT c.*, u.name owner_name FROM clients c LEFT JOIN users u ON u.id = c.owner_id ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY c.updated_at DESC`,
    ...params,
  );
  return (
    <>
      <PageHeader title="العملاء" sub={`${rows.length} ملف`} actions={<Link href="/clients/new" className="btn-primary">+ عميل جديد</Link>} />
      <form className="card p-3 mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={sp.q} placeholder="بحث بالاسم، رقم الملف، الجوال، جهة العمل…" className="input flex-1 min-w-56" />
        <select name="status" defaultValue={sp.status ?? ""} className="input w-auto"><option value="">كل الحالات</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <select name="elig" defaultValue={sp.elig ?? ""} className="input w-auto"><option value="">كل الأهلية</option>{Object.entries(ELIGIBILITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <select name="type" defaultValue={sp.type ?? ""} className="input w-auto"><option value="">كل الأنواع</option>{Object.entries(FINANCE_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="btn-ghost">تصفية</button>
      </form>
      {rows.length === 0 ? <Empty>لا يوجد عملاء مطابقون</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead><tr>{["الملف", "العميل", "نوع التمويل", "المبلغ", "الحالة", "الأهلية", "المستندات", "الخطوة القادمة", "المسؤول", "آخر تحديث"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => {
                const d = docProgress(r.id);
                return (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="td num text-slate-500 text-xs">{r.file_no}</td>
                    <td className="td"><Link href={`/clients/${r.id}`} className="font-semibold hover:text-brand-700">{r.full_name}</Link><div className="text-xs text-slate-500">{SECTOR[r.sector]}</div></td>
                    <td className="td">{FINANCE_TYPE[r.finance_type]}</td>
                    <td className="td num">{sar(r.requested_amount)}</td>
                    <td className="td"><StatusBadge s={r.status} /></td>
                    <td className="td"><EligBadge e={r.eligibility} /></td>
                    <td className="td w-28"><div className="flex items-center gap-2"><Progress pct={d.pct} tone={d.pct === 100 ? "green" : "brand"} /><span className="text-xs num">{d.requiredDone}/{d.required}</span></div></td>
                    <td className="td text-xs text-slate-600 max-w-56 truncate">{r.next_step ?? "—"}</td>
                    <td className="td text-xs">{r.owner_name}</td>
                    <td className="td text-xs text-slate-500">{dateAr(r.updated_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
