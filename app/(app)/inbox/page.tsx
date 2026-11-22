import Link from "next/link";
import { all } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { WA } from "@/lib/wa-cloud";
import { PageHeader, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

type Row = { phone: string; client_id: number | null; full_name: string | null; name: string | null; body: string | null; direction: string; created_at: string; n_in: number };

export default async function InboxPage() {
  await requireUser();
  // آخر رسالة لكل رقم، مع عدد الرسائل الواردة خلال 7 أيام
  const rows = await all<Row>(`
    SELECT m.phone, m.client_id, c.full_name, m.name, m.body, m.direction, m.created_at,
      (SELECT COUNT(*) FROM wa_messages x WHERE x.phone = m.phone AND x.direction = 'in' AND x.created_at >= datetime('now', '-7 days')) n_in
    FROM wa_messages m LEFT JOIN clients c ON c.id = m.client_id
    WHERE m.id IN (SELECT MAX(id) FROM wa_messages GROUP BY phone)
    ORDER BY m.id DESC LIMIT 200`);
  return (
    <>
      <PageHeader title="صندوق واتساب" sub="آخر المحادثات مع العملاء على رقم الشركة. الرسائل من أرقام غير مسجلة تظهر هنا لتضيفها كعميل." />
      {!WA.configured && (
        <div className="mb-4 rounded-xl bg-amber-50 ring-1 ring-amber-200 p-4 text-sm text-amber-900">
          ربط واتساب للأعمال غير مفعّل بعد. بعد إضافة بيانات Meta في إعدادات الموقع تبدأ الرسائل بالظهور هنا تلقائياً.
        </div>
      )}
      {rows.length === 0 ? <Empty>لا توجد محادثات بعد</Empty> : (
        <div className="card divide-y divide-slate-100">
          {rows.map((r) => {
            const inner = (
              <div className="flex items-start gap-3 p-4 hover:bg-slate-50">
                <div className={`size-10 shrink-0 rounded-full grid place-items-center font-bold ${r.client_id ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>{(r.full_name ?? r.name ?? "؟").slice(0, 1)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold truncate">{r.full_name ?? r.name ?? "رقم غير مسجل"}</span>
                    {!r.client_id && <span className="rounded-full bg-amber-100 text-amber-800 px-2 text-[11px]">غير مسجل</span>}
                    <span className="ms-auto text-xs text-slate-400 num" dir="ltr">{r.created_at.slice(5, 16)}</span>
                  </div>
                  <div className="text-xs text-slate-400 num" dir="ltr">+{r.phone}</div>
                  <div className="text-sm text-slate-600 truncate">{r.direction === "out" ? "أنت: " : ""}{r.body}</div>
                </div>
                {r.n_in > 0 && <span className="rounded-full bg-emerald-600 text-white text-xs px-2 py-0.5 num">{r.n_in}</span>}
              </div>
            );
            return r.client_id
              ? <Link key={r.phone} href={`/clients/${r.client_id}?tab=wa`} className="block">{inner}</Link>
              : <Link key={r.phone} href={`/clients/new?phone=0${r.phone.replace(/^966/, "")}${r.name ? `&name=${encodeURIComponent(r.name)}` : ""}`} className="block">{inner}</Link>;
          })}
        </div>
      )}
    </>
  );
}
