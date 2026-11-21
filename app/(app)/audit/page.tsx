import Link from "next/link";
import { all } from "@/lib/db";
import { requirePage } from "@/lib/auth";
import { AUDIT_ACTION } from "@/lib/labels";
import { PageHeader, dateTimeAr, Badge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Audit({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  await requirePage("audit.view");
  const { action } = await searchParams;
  const rows = await all<{ id: number; action: string; entity: string | null; entity_id: number | null; details: string | null; ip: string | null; created_at: string; name: string | null; full_name: string | null }>(
    `SELECT a.*, u.name, c.full_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN clients c ON a.entity = 'client' AND c.id = a.entity_id
     ${action ? "WHERE a.action = ?" : ""} ORDER BY a.id DESC LIMIT 300`, ...(action ? [action] : []),
  );
  const sensitive = new Set(["client_view_pii", "doc_download", "export", "client_delete", "login_failed"]);
  return (
    <>
      <PageHeader title="سجل التدقيق" sub="كل وصول وتعديل على بيانات العملاء — آخر 300 حدث" />
      <form className="card p-3 mb-4 flex gap-2">
        <select name="action" defaultValue={action ?? ""} className="input w-auto"><option value="">كل الأحداث</option>{Object.entries(AUDIT_ACTION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="btn-ghost">تصفية</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[800px]">
          <thead><tr>{["الوقت", "المستخدم", "الحدث", "الملف", "تفاصيل", "IP"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td className="td text-xs whitespace-nowrap">{dateTimeAr(r.created_at)}</td>
              <td className="td text-sm">{r.name ?? "—"}</td>
              <td className="td">{sensitive.has(r.action) ? <Badge tone="amber">{AUDIT_ACTION[r.action] ?? r.action}</Badge> : <span className="text-sm">{AUDIT_ACTION[r.action] ?? r.action}</span>}</td>
              <td className="td text-sm">{r.full_name ? <Link href={`/clients/${r.entity_id}`} className="text-brand-700 hover:underline">{r.full_name}</Link> : "—"}</td>
              <td className="td text-xs text-slate-500 max-w-72 truncate num" dir="auto">{r.details}</td>
              <td className="td text-xs num text-slate-400">{r.ip}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}
