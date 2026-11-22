import Link from "next/link";
import { all } from "@/lib/db";
import { requirePage } from "@/lib/auth";
import { AUDIT_ACTION } from "@/lib/labels";
import { PageHeader, dateTimeAr, Badge, Empty } from "@/components/ui";
import { AutoSelect } from "@/components/client-bits";

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
      <PageHeader title="سجل التدقيق" sub="آخر 300 حدث" actions={
        <form><AutoSelect name="action" label="نوع الحدث" defaultValue={action ?? ""} options={[["", "كل الأحداث"], ...Object.entries(AUDIT_ACTION)]} /></form>
      } />
      <div className="card overflow-hidden">
        {rows.length === 0 ? <Empty art="search" title="لا أحداث" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead><tr>{["الوقت", "المستخدم", "الحدث", "الملف", "التفاصيل"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/60">
                  <td className="td text-xs whitespace-nowrap text-slate-500">{dateTimeAr(r.created_at)}</td>
                  <td className="td">{r.name ?? "—"}</td>
                  <td className="td">{sensitive.has(r.action) ? <Badge tone="amber">{AUDIT_ACTION[r.action] ?? r.action}</Badge> : (AUDIT_ACTION[r.action] ?? r.action)}</td>
                  <td className="td">{r.full_name ? <Link href={`/clients/${r.entity_id}`} className="text-brand-700 hover:underline">{r.full_name}</Link> : "—"}</td>
                  <td className="td text-xs text-slate-500 max-w-72 truncate" dir="auto" title={[r.details, r.ip].filter(Boolean).join(" · ")}>{r.details}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
