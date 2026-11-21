import Link from "next/link";
import { notFound } from "next/navigation";
import { all } from "@/lib/db";
import { requireUser, can, maskId } from "@/lib/auth";
import { getClient, getObligations, studyFor, docProgress, products, lenderExperience, lenderRules } from "@/lib/data";
import StudyView from "@/components/study-view";
import OutcomeForm from "@/components/outcome-form";
import { fmt } from "@/lib/engine";
import {
  STATUS, STATUS_ORDER, FINANCE_TYPE, OUTCOME_DECISION, OUTCOME_CONDITIONS, REJECT_REASONS, SECTOR, SIMAH, BANKS, OBLIGATION_KIND, DOC_STATUS, DOC_CATEGORY, APP_STATUS, NOTE_KIND, ELIGIBILITY, AUDIT_ACTION,
} from "@/lib/labels";
import { Badge, EligBadge, PageHeader, Progress, StatusBadge, sar, dateAr, dateTimeAr, Empty } from "@/components/ui";
import ClientForm from "@/components/client-form";
import { UploadButton, RevealId } from "@/components/client-bits";
import {
  setStatus, setNextStep, recordOutcome, addObligation, deleteObligation, setDocStatus, addCustomDoc, createApplication, updateApplication, addNote, saveStudy, updateClient, deleteClient,
} from "@/app/actions";

export const dynamic = "force-dynamic";

const TABS = [
  ["overview", "نظرة عامة"],
  ["study", "دراسة الأهلية"],
  ["docs", "المستندات"],
  ["apps", "الطلبات لدى الجهات"],
  ["notes", "المراسلات والسجل"],
  ["edit", "تعديل البيانات"],
] as const;

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const u = await requireUser();
  const id = Number((await params).id);
  const c = await getClient(id);
  if (!c) notFound();
  const tab = (await searchParams).tab ?? "overview";
  const s = await studyFor(c);
  const exp = await lenderExperience(c.finance_type, c.sector, c.total_salary ?? c.basic_salary);
  const rules = await lenderRules(c.finance_type);
  const obligations = await getObligations(id);
  const dp = await docProgress(id);
  const docs = await all<{ id: number; code: string; label: string; category: keyof typeof DOC_CATEGORY; required: number; status: keyof typeof DOC_STATUS; file_name: string | null; size: number | null; uploaded_at: string | null; uploader: string | null }>(
    "SELECT d.*, u.name uploader FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE client_id = ? ORDER BY required DESC, id", id,
  );
  const apps = await all<{ id: number; lender_name: string | null; product_name: string | null; amount: number | null; tenor: number | null; installment: number | null; ref_no: string | null; status: keyof typeof APP_STATUS; submitted_at: string | null; decided_at: string | null; note: string | null }>(
    "SELECT a.*, l.name lender_name FROM applications a LEFT JOIN lenders l ON l.id = a.lender_id WHERE client_id = ? ORDER BY a.id DESC", id,
  );
  const notes = await all<{ id: number; kind: keyof typeof NOTE_KIND; body: string; name: string | null; created_at: string }>(
    "SELECT n.*, u.name FROM notes n LEFT JOIN users u ON u.id = n.user_id WHERE client_id = ? ORDER BY n.id DESC", id,
  );
  const history = await all<{ action: string; details: string | null; name: string | null; created_at: string }>(
    "SELECT a.action, a.details, a.created_at, u.name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE entity = 'client' AND entity_id = ? ORDER BY a.id DESC LIMIT 60", id,
  );
  const lastStudy = await all<{ verdict: string; analyst_opinion: string | null; name: string; created_at: string }>(
    "SELECT s.verdict, s.analyst_opinion, s.created_at, u.name FROM studies s JOIN users u ON u.id = s.user_id WHERE client_id = ? ORDER BY s.id DESC LIMIT 3", id,
  );
  const lenders = await all<{ id: number; name: string }>("SELECT id, name FROM lenders WHERE active = 1 ORDER BY name");
  const outcomes = new Map((await all<{ application_id: number; decision: keyof typeof OUTCOME_DECISION; approved_amount: number | null; conditions: string; reason: string | null }>(
    "SELECT application_id, decision, approved_amount, conditions, reason FROM outcomes WHERE client_id = ? AND application_id IS NOT NULL", id,
  )).map((o) => [o.application_id, o]));
  const edit = can(u, "client.edit");
  const age = c.birth_year ? new Date().getFullYear() - c.birth_year : null;

  return (
    <>
      <PageHeader
        back={{ href: "/clients", label: "العملاء" }}
        title={<span className="flex flex-wrap items-center gap-3">{c.full_name} <span className="text-sm font-medium text-slate-400 num">{c.file_no}</span></span>}
        sub={<span className="flex flex-wrap items-center gap-2 mt-1"><StatusBadge s={c.status} /><EligBadge e={c.eligibility} /><span>· {FINANCE_TYPE[c.finance_type]} · <span className="num">{sar(c.requested_amount)}</span> ريال · المسؤول: {c.owner_name ?? "—"}</span></span>}
        actions={<>
          <Link href={`/clients/${id}/report`} className="btn-ghost">📄 تقرير الدراسة</Link>
          {edit && (
            <form action={setStatus.bind(null, id)} className="flex gap-2">
              <select name="status" defaultValue={c.status} className="input w-auto">{STATUS_ORDER.map((k) => <option key={k} value={k}>{STATUS[k].emoji} {STATUS[k].label}</option>)}</select>
              <button className="btn-primary">تحديث الحالة</button>
            </form>
          )}
        </>}
      />

      <div className="no-print flex gap-1 overflow-x-auto border-b border-slate-200 mb-6">
        {TABS.filter(([k]) => k !== "edit" || edit).map(([k, l]) => (
          <Link key={k} href={`?tab=${k}`} className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap ${tab === k ? "border-brand-600 text-brand-800" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            {l}{k === "docs" && <span className="ms-1.5 text-xs num text-slate-400">{dp.requiredDone}/{dp.required}</span>}{k === "apps" && apps.length > 0 && <span className="ms-1.5 text-xs num text-slate-400">{apps.length}</span>}
          </Link>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <div className="card p-5 grid sm:grid-cols-3 gap-4">
              <Big label="القسط الشهري المتاح" v={fmt(s.capacity.available)} unit="ريال" tone="brand" />
              <Big label="أفضل مبلغ ممكن" v={fmt(s.matches.find((m) => m.verdict !== "fail")?.maxPrincipal ?? 0)} unit="ريال" />
              <Big label="نسبة الالتزامات الحالية" v={`${s.capacity.currentDbr}%`} unit={`من الدخل ${fmt(s.capacity.income)}`} />
            </div>
            <div className="card p-5">
              <h3 className="font-bold mb-4">ملخص العميل</h3>
              <dl className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-sm">
                <KV k="رقم الهوية" v={can(u, "client.view_pii") ? <RevealId clientId={id} masked={maskId(c.national_id)} /> : maskId(c.national_id)} />
                <KV k="الجوال" v={<span className="num">{c.phone ?? "—"}</span>} />
                <KV k="العمر" v={age ? `${age} سنة` : "—"} />
                <KV k="جهة العمل" v={c.employer} />
                <KV k="القطاع" v={SECTOR[c.sector]} />
                <KV k="مدة الخدمة" v={c.service_months != null ? `${c.service_months} شهر` : "—"} />
                <KV k="الراتب الأساسي / الإجمالي" v={<span className="num">{sar(c.basic_salary)} / {sar(c.total_salary)}</span>} />
                <KV k="بنك الراتب" v={c.salary_bank ? BANKS[c.salary_bank] : "—"} />
                <KV k="سمة" v={<Badge tone={c.simah === "clean" ? "green" : c.simah === "unknown" ? "slate" : "red"}>{SIMAH[c.simah]}</Badge>} />
                <KV k="الغرض" v={c.purpose} />
                <KV k="المدة المرغوبة" v={c.requested_tenor ? `${c.requested_tenor} شهر` : "—"} />
                <KV k="مستفيد سكني" v={c.housing_support ? "نعم" : "لا"} />
              </dl>
            </div>
            <div className="card p-5">
              <h3 className="font-bold mb-4">الالتزامات الحالية</h3>
              {obligations.length === 0 ? <p className="text-sm text-slate-500 mb-4">لا توجد التزامات مسجلة</p> : (
                <table className="w-full mb-4"><thead><tr>{["النوع", "الجهة", "القسط الشهري", "المتبقي", ""].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                  <tbody>{obligations.map((o) => (
                    <tr key={o.id}><td className="td">{OBLIGATION_KIND[o.kind]}</td><td className="td">{o.lender ?? "—"}</td><td className="td num">{sar(o.monthly)}</td><td className="td num">{sar(o.remaining)}</td>
                      <td className="td text-left">{edit && <form action={deleteObligation.bind(null, id, o.id)}><button className="text-xs text-rose-600 hover:underline">حذف</button></form>}</td></tr>
                  ))}</tbody></table>
              )}
              {edit && (
                <form action={addObligation.bind(null, id)} className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <select name="kind" className="input">{Object.entries(OBLIGATION_KIND).map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select>
                  <input name="lender" placeholder="الجهة" className="input" />
                  <input name="monthly" placeholder="القسط" className="input" inputMode="decimal" required />
                  <input name="remaining" placeholder="المتبقي" className="input" inputMode="decimal" />
                  <button className="btn-ghost">+ إضافة</button>
                </form>
              )}
            </div>
          </div>
          <div className="space-y-4">
            <div className="card p-5">
              <h3 className="font-bold mb-3">الخطوة القادمة</h3>
              <form action={setNextStep.bind(null, id)} className="space-y-2">
                <textarea name="next_step" defaultValue={c.next_step ?? ""} rows={2} className="input" disabled={!edit} />
                <input type="date" name="next_step_due" defaultValue={c.next_step_due ?? ""} className="input" disabled={!edit} />
                {edit && <button className="btn-ghost btn-sm w-full">حفظ</button>}
              </form>
            </div>
            <div className="card p-5">
              <div className="flex items-center justify-between mb-2"><h3 className="font-bold">اكتمال المستندات</h3><span className="num text-sm font-bold">{dp.pct}%</span></div>
              <Progress pct={dp.pct} tone={dp.pct === 100 ? "green" : "brand"} />
              <ul className="mt-4 space-y-1.5 text-sm">
                {docs.filter((d) => d.required && (d.status === "missing" || d.status === "rejected")).map((d) => <li key={d.id} className="flex gap-2 text-slate-600"><span className="text-rose-500">●</span>{d.label}</li>)}
              </ul>
              <Link href="?tab=docs" className="text-xs font-semibold text-brand-700 mt-3 inline-block">إدارة المستندات ←</Link>
            </div>
            <div className="card p-5">
              <h3 className="font-bold mb-3">التوصيات</h3>
              <ol className="list-decimal ps-5 space-y-2 text-sm leading-6 text-slate-700">{s.recommendations.slice(0, 4).map((r, i) => <li key={i}>{r}</li>)}</ol>
            </div>
          </div>
        </div>
      )}

      {tab === "study" && (
        <div className="space-y-4">
          <StudyView s={s} exp={exp} rules={rules} requested={c.requested_amount} />
          <div className="grid lg:grid-cols-3 gap-4">
            <ListCard title="نقاط القوة" items={s.strengths} icon="✅" />
            <ListCard title="المخاطر ونقاط الضعف" items={s.risks} icon="⚠️" />
            <ListCard title="التوصيات" items={s.recommendations} icon="💡" />
          </div>

          <div className="card p-5">
            <h3 className="font-bold mb-3">رأي المحلل واعتماد الدراسة</h3>
            {lastStudy.map((st, i) => (
              <div key={i} className="mb-3 rounded-xl bg-slate-50 p-3 text-sm"><div className="flex items-center gap-2 mb-1"><EligBadge e={st.verdict} /><span className="text-xs text-slate-500">{st.name} · {dateTimeAr(st.created_at)}</span></div>{st.analyst_opinion}</div>
            ))}
            {can(u, "study.approve") ? (
              <form action={saveStudy.bind(null, id)} className="grid sm:grid-cols-[200px_1fr_auto] gap-2 items-start">
                <select name="verdict" defaultValue={s.verdict} className="input">{Object.entries(ELIGIBILITY).map(([k, v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}</select>
                <textarea name="opinion" rows={2} className="input" placeholder="رأي المحلل، الشروط، أي استثناء عن حكم المحرك…" />
                <button className="btn-primary">اعتماد الدراسة</button>
              </form>
            ) : <p className="text-sm text-slate-500">اعتماد الدراسة متاح للمحلل الائتماني والمدير.</p>}
          </div>
        </div>
      )}

      {tab === "docs" && (
        <div className="space-y-4">
          {Object.entries(DOC_CATEGORY).map(([cat, label]) => {
            const list = docs.filter((d) => d.category === cat);
            if (!list.length) return null;
            return (
              <div key={cat} className="card overflow-hidden">
                <div className="px-5 py-3 bg-slate-50/80 border-b border-slate-100 font-bold text-sm">{label}</div>
                <ul>
                  {list.map((d) => (
                    <li key={d.id} className="px-5 py-3.5 border-b border-slate-100 last:border-0 flex flex-wrap items-center gap-3">
                      <div className="flex-1 min-w-52">
                        <div className="font-semibold text-sm">{d.label} {d.required ? <span className="text-rose-500 text-xs">مطلوب</span> : <span className="text-slate-400 text-xs">اختياري</span>}</div>
                        {d.file_name && <div className="text-xs text-slate-500 mt-0.5">📎 <a className="text-brand-700 hover:underline" href={`/api/files/${d.id}`} target="_blank">{d.file_name}</a> · <span className="num">{Math.round((d.size ?? 0) / 1024)} KB</span> · {d.uploader} · {dateAr(d.uploaded_at)}</div>}
                      </div>
                      <Badge tone={DOC_STATUS[d.status].tone}>{DOC_STATUS[d.status].label}</Badge>
                      {can(u, "doc.upload") && <UploadButton clientId={id} docId={d.id} hasFile={!!d.file_name} />}
                      {can(u, "doc.verify") && d.status === "received" && (
                        <>
                          <form action={setDocStatus.bind(null, id, d.id, "verified")}><button className="btn-ghost btn-sm text-emerald-700">✓ تحقق</button></form>
                          <form action={setDocStatus.bind(null, id, d.id, "rejected")}><button className="btn-ghost btn-sm text-rose-700">إعادة</button></form>
                        </>
                      )}
                      {can(u, "doc.upload") && d.status === "missing" && <form action={setDocStatus.bind(null, id, d.id, "received")}><button className="btn-ghost btn-sm" title="استُلم ورقياً">استلام ورقي</button></form>}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {can(u, "doc.upload") && (
            <form action={addCustomDoc.bind(null, id)} className="card p-4 flex flex-wrap gap-2">
              <input name="label" placeholder="مستند إضافي تطلبه جهة معينة…" className="input flex-1 min-w-56" required />
              <select name="category" className="input w-auto">{Object.entries(DOC_CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <button className="btn-ghost">+ إضافة للقائمة</button>
            </form>
          )}
          <p className="text-xs text-slate-500">🔒 الملفات تحفظ خارج المجلد العام بأسماء عشوائية، ولا تُنزّل إلا لمستخدم مسجل، وكل تنزيل يُسجل في سجل التدقيق. الأنواع: PDF، JPG، PNG حتى 10MB.</p>
        </div>
      )}

      {tab === "apps" && (
        <div className="space-y-4">
          {apps.length === 0 ? <Empty>لم يُقدَّم أي طلب بعد. استخدم الدراسة لاختيار الجهة الأنسب ثم سجّل الطلب هنا.</Empty> : (
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead><tr>{["الجهة", "المنتج", "المبلغ", "المدة", "القسط", "رقم الطلب", "تاريخ التقديم", "الحالة", "تحديث", "نتيجة الجهة"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                <tbody>{apps.map((a) => (
                  <tr key={a.id}>
                    <td className="td font-semibold">{a.lender_name}</td><td className="td">{a.product_name}</td><td className="td num">{sar(a.amount)}</td><td className="td num">{a.tenor ?? "—"}</td><td className="td num">{sar(a.installment)}</td>
                    <td className="td num text-xs">{a.ref_no ?? "—"}</td><td className="td text-xs">{dateAr(a.submitted_at)}</td>
                    <td className="td"><Badge tone={APP_STATUS[a.status].tone} dot>{APP_STATUS[a.status].label}</Badge>{a.note && <div className="text-xs text-slate-500 mt-1 max-w-48">{a.note}</div>}</td>
                    <td className="td">{can(u, "app.manage") && (
                      <form action={updateApplication.bind(null, id, a.id)} className="flex gap-1">
                        <select name="status" defaultValue={a.status} className="input h-8 text-xs w-auto">{Object.entries(APP_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
                        <button className="btn-ghost btn-sm">حفظ</button>
                      </form>
                    )}</td>
                    <td className="td">{outcomes.has(a.id) ? <OutcomeBadge o={outcomes.get(a.id)!} /> : can(u, "app.manage") && <OutcomeForm action={recordOutcome.bind(null, id, a.id)} amount={a.amount} tenor={a.tenor} />}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {can(u, "app.manage") && (
            <div className="card p-5">
              <h3 className="font-bold mb-1">تسجيل طلب جديد</h3>
              <p className="text-xs text-slate-500 mb-4">اختر من المقترحات لتعبئة البيانات تلقائياً:</p>
              <div className="flex flex-wrap gap-2 mb-4">
                {s.matches.filter((m) => m.verdict !== "fail").slice(0, 4).map((m) => (
                  <form key={m.product.id} action={createApplication.bind(null, id)}>
                    <input type="hidden" name="lender_id" value={m.product.lenderId} /><input type="hidden" name="product_name" value={m.product.name} />
                    <input type="hidden" name="amount" value={m.offerPrincipal} /><input type="hidden" name="tenor" value={m.tenor} /><input type="hidden" name="installment" value={m.installment} />
                    <button className="btn-ghost btn-sm">+ {m.product.lenderName} — <span className="num">{sar(m.offerPrincipal)}</span></button>
                  </form>
                ))}
              </div>
              <form action={createApplication.bind(null, id)} className="grid sm:grid-cols-4 gap-3">
                <select name="lender_id" className="input" required><option value="">الجهة…</option>{lenders.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
                <input name="product_name" placeholder="المنتج" className="input" />
                <input name="amount" placeholder="المبلغ" className="input" inputMode="decimal" />
                <input name="tenor" placeholder="المدة (شهر)" className="input" inputMode="numeric" />
                <input name="installment" placeholder="القسط" className="input" inputMode="decimal" />
                <input name="ref_no" placeholder="رقم الطلب لدى الجهة" className="input" />
                <select name="status" className="input" defaultValue="submitted"><option value="draft">مسودة</option><option value="submitted">مقدم</option></select>
                <input name="note" placeholder="ملاحظة" className="input" />
                <button className="btn-primary sm:col-span-4">تسجيل الطلب</button>
              </form>
            </div>
          )}
        </div>
      )}

      {tab === "notes" && (
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          <div className="card p-5">
            <h3 className="font-bold mb-4">المراسلات والملاحظات</h3>
            {edit && (
              <form action={addNote.bind(null, id)} className="space-y-2 mb-5">
                <div className="flex gap-2"><select name="kind" className="input w-32">{Object.entries(NOTE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                <textarea name="body" rows={3} className="input" placeholder="ماذا حدث؟ ما الذي اتُّفق عليه؟" required />
                <button className="btn-primary btn-sm">إضافة</button>
              </form>
            )}
            <ul className="space-y-3">
              {notes.map((n) => (
                <li key={n.id} className="rounded-xl bg-slate-50 p-3">
                  <div className="flex items-center gap-2 text-xs text-slate-500 mb-1"><Badge tone="brand">{NOTE_KIND[n.kind]}</Badge>{n.name} · {dateTimeAr(n.created_at)}</div>
                  <div className="text-sm leading-6 whitespace-pre-wrap">{n.body}</div>
                </li>
              ))}
            </ul>
          </div>
          <div className="card p-5">
            <h3 className="font-bold mb-4">سجل الملف</h3>
            <ol className="relative border-s border-slate-200 ms-2 space-y-4">
              {history.map((h, i) => (
                <li key={i} className="ms-4">
                  <span className="absolute -start-1.5 mt-1.5 size-3 rounded-full bg-white border-2 border-brand-500" />
                  <div className="text-sm"><b>{h.name ?? "النظام"}</b> {AUDIT_ACTION[h.action] ?? h.action} {h.action === "client_status" && h.details && (() => { const d = JSON.parse(h.details); return <span className="text-slate-500">({STATUS[d.from as keyof typeof STATUS]?.label} ← {STATUS[d.to as keyof typeof STATUS]?.label})</span>; })()}</div>
                  <div className="text-xs text-slate-400">{dateTimeAr(h.created_at)}</div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {tab === "edit" && edit && (
        <>
          <ClientForm action={updateClient.bind(null, id)} products={await products()} obligations={obligations.map((o) => ({ kind: o.kind, monthly: o.monthly }))}
            initial={Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v == null ? "" : (v as string | number)]))} />
          {can(u, "client.delete") && (
            <form action={deleteClient.bind(null, id)} className="card p-4 mt-6 border-rose-200 flex items-center justify-between gap-3">
              <div className="text-sm"><b className="text-rose-700">حذف الملف نهائياً</b><div className="text-xs text-slate-500">يحذف الملف ومستنداته (حق العميل في الإتلاف). لا يمكن التراجع.</div></div>
              <button className="btn bg-rose-600 text-white hover:bg-rose-700">حذف</button>
            </form>
          )}
        </>
      )}
    </>
  );
}

function Big({ label, v, unit, tone }: { label: string; v: string; unit?: string; tone?: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl font-bold num text-start mt-1 ${tone === "brand" ? "text-brand-700" : ""}`}>{v}</div>
      {unit && <div className="text-[11px] text-slate-400 mt-0.5 leading-4">{unit}</div>}
    </div>
  );
}
function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return <div><dt className="text-xs text-slate-500">{k}</dt><dd className="font-semibold mt-0.5">{v || "—"}</dd></div>;
}
function ListCard({ title, items, icon }: { title: string; items: string[]; icon: string }) {
  return (
    <div className="card p-5">
      <h3 className="font-bold mb-3">{title}</h3>
      {items.length === 0 ? <p className="text-sm text-slate-400">—</p> : <ul className="space-y-2 text-sm leading-6">{items.map((x, i) => <li key={i} className="flex gap-2"><span>{icon}</span><span>{x}</span></li>)}</ul>}
    </div>
  );
}

function OutcomeBadge({ o }: { o: { decision: keyof typeof OUTCOME_DECISION; approved_amount: number | null; conditions: string; reason: string | null } }) {
  const conds = JSON.parse(o.conditions || "[]") as string[];
  return (
    <div className="space-y-1">
      <Badge tone={OUTCOME_DECISION[o.decision].tone}>{OUTCOME_DECISION[o.decision].label}</Badge>
      {o.approved_amount ? <div className="text-xs num">{sar(o.approved_amount)}</div> : null}
      {o.reason && <div className="text-xs text-rose-700">{REJECT_REASONS[o.reason] ?? o.reason}</div>}
      {conds.length > 0 && <div className="text-[11px] text-slate-500 max-w-48">{conds.map((k) => OUTCOME_CONDITIONS[k] ?? k).join("، ")}</div>}
    </div>
  );
}
