import Link from "next/link";
import { all } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { WA } from "@/lib/wa-cloud";
import { PageHeader, Empty, Callout, Badge, dateTimeAr, plain } from "@/components/ui";

export const dynamic = "force-dynamic";

type Row = { phone: string; client_id: number | null; full_name: string | null; name: string | null; body: string | null; direction: string; created_at: string; n_in: number };

export default async function InboxPage() {
  await requireUser();
  const rows = await all<Row>(`
    SELECT m.phone, m.client_id, c.full_name, m.name, m.body, m.direction, m.created_at,
      (SELECT COUNT(*) FROM wa_messages x WHERE x.phone = m.phone AND x.direction = 'in' AND x.created_at >= datetime('now', '-7 days')) n_in
    FROM wa_messages m LEFT JOIN clients c ON c.id = m.client_id
    WHERE m.id IN (SELECT MAX(id) FROM wa_messages GROUP BY phone)
    ORDER BY m.id DESC LIMIT 200`);
  return (
    <>
      <PageHeader title="المحادثات" sub="واتساب رقم الشركة" />
      {!WA.configured && <div className="mb-5"><Callout tone="amber" title="ربط واتساب للأعمال لم يُفعّل بعد">تظهر الرسائل هنا تلقائياً بعد إضافة بيانات Meta.</Callout></div>}
      <div className="card overflow-hidden">
        {rows.length === 0 ? <Empty art="chat" title="لا محادثات بعد" /> : (
          <ul>
            {rows.map((r) => {
              const waitingReply = r.direction === "in";
              const href = r.client_id ? `/clients/${r.client_id}?tab=wa` : `/clients/new?phone=0${r.phone.replace(/^966/, "")}${r.name ? `&name=${encodeURIComponent(r.name)}` : ""}`;
              return (
                <li key={r.phone} className="border-b border-slate-100 last:border-0">
                  <Link href={href} className="flex items-center gap-3.5 px-5 py-3.5 hover:bg-slate-50/70 transition-colors">
                    <div className={`size-10 shrink-0 rounded-full grid place-items-center font-display font-bold text-sm ${r.client_id ? "bg-brand-800 text-gold-soft" : "bg-slate-100 text-slate-500"}`}>{(r.full_name ?? r.name ?? "؟").slice(0, 1)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm truncate ${waitingReply ? "font-bold" : "font-semibold"}`}>{r.full_name ?? r.name ?? <span className="num" dir="ltr">+{r.phone}</span>}</span>
                        {!r.client_id && <Badge tone="amber">رقم جديد</Badge>}
                      </div>
                      <div className={`text-[13px] truncate mt-0.5 ${waitingReply ? "text-ink" : "text-slate-500"}`}>{r.direction === "out" ? "أنت: " : ""}{plain(r.body)}</div>
                    </div>
                    <div className="text-end shrink-0">
                      <div className="text-[11px] text-slate-400">{dateTimeAr(r.created_at)}</div>
                      {waitingReply && <span className="mt-1 inline-block size-2.5 rounded-full bg-brand-600" title="بانتظار ردك" />}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
