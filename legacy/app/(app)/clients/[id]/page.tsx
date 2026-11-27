import Link from "next/link";
import { notFound } from "next/navigation";
import { all } from "@/lib/db";
import { requireUser, can, maskId } from "@/lib/auth";
import { getClient, getObligations, studyFor, docProgress, products, lenderExperience, lenderRules, latestCredit, projectFor, dealFor, waContextFor, activeShareLink } from "@/lib/data";
import WhatsAppPanel from "@/components/whatsapp-panel";
import { WA, windowOpen } from "@/lib/wa-cloud";
import { headers } from "next/headers";
import DealEditor from "@/components/deal-editor";
import { STAGE_LABEL, stagesFor } from "@/lib/deal";
import CreditView from "@/components/credit-view";
import ProjectView from "@/components/project-view";
import StudyView from "@/components/study-view";
import OutcomeForm from "@/components/outcome-form";
import { fmt } from "@/lib/engine";
import {
  STATUS, STATUS_ORDER, FINANCE_TYPE, OUTCOME_DECISION, OUTCOME_CONDITIONS, REJECT_REASONS, SECTOR, SIMAH, BANKS, OBLIGATION_KIND, DOC_STATUS, DOC_CATEGORY, APP_STATUS, NOTE_KIND, ELIGIBILITY, AUDIT_ACTION,
} from "@/lib/labels";
import { Badge, EligBadge, PageHeader, Progress, sar, dateAr, dateTimeAr, Empty, Callout, Fold, Metric, MetricStrip, StageBar, SectionTitle, plain } from "@/components/ui";
import { Icon } from "@/components/icon";
import ClientForm from "@/components/client-form";
import { UploadButton, RevealId, SimahUpload, AutoSelect, MoreMenu, ConfirmButton } from "@/components/client-bits";
import {
  setStatus, setNextStep, saveDeal, setDealStage, createShareLink, revokeShareLinks, logWhatsapp, waSendDirect, rejectDeal, reopenDeal, recordOutcome, addObligation, deleteObligation, setDocStatus, addCustomDoc, createApplication, updateApplication, addNote, saveStudy, updateClient, deleteClient,
} from "@/app/actions";

export const dynamic = "force-dynamic";

// خمسة أقسام بدل تسعة تبويبات. مفاتيح التبويبات القديمة تبقى صالحة في الروابط.
const GROUPS = [
  { key: "deal", label: "الصفقة", icon: "bridge", tabs: ["deal"] },
  { key: "overview", label: "الملخص", icon: "user", tabs: ["overview", "edit"] },
  { key: "study", label: "الدراسة", icon: "compass", tabs: ["study", "credit", "apps"] },
  { key: "docs", label: "المستندات", icon: "folder", tabs: ["docs"] },
  { key: "talk", label: "التواصل", icon: "chat", tabs: ["wa", "notes"] },
] as const;
const SUB: Record<string, [string, string][]> = {
  study: [["study", "الأهلية"], ["credit", "سمة"], ["apps", "الطلبات"]],
  talk: [["wa", "واتساب"], ["notes", "الملاحظات والسجل"]],
};

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const u = await requireUser();
  const id = Number((await params).id);
  const c = await getClient(id);
  if (!c) notFound();
  const rawTab = (await searchParams).tab ?? (c.finance_type === "project" ? "overview" : "deal");
  const tab = rawTab === "whatsapp" ? "wa" : rawTab;
  const deal = c.finance_type === "project" ? null : await dealFor(c);
  const share = await activeShareLink(id);
  const hh = await headers();
  const host = hh.get("x-forwarded-host") ?? hh.get("host") ?? "masarfin.com";
  const shareUrl = share ? `${hh.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}/s/${share.token}` : null;
  const wa = tab === "wa" ? await waContextFor(c, u.name, null) : null;
  const waApi = tab === "wa" ? {
    configured: WA.configured,
    window: WA.configured ? await windowOpen(id) : { open: false, lastIn: null },
    thread: await all<{ id: number; direction: "in" | "out"; type: string; body: string | null; status: string | null; error: string | null; created_at: string; doc_id: number | null; who: string | null }>(
      "SELECT m.id, m.direction, m.type, m.body, m.status, m.error, m.created_at, m.doc_id, u.name who FROM wa_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.client_id = ? ORDER BY m.id DESC LIMIT 60", id),
  } : null;
  const s = await studyFor(c);
  const cr = await latestCredit(id);
  const pj = projectFor(c);
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

  const group = GROUPS.find((g) => (g.tabs as readonly string[]).includes(tab)) ?? GROUPS[1];
  const stages = deal ? stagesFor(deal.input.structure).filter(([k]) => k !== "lost" && k !== "closed") : [];
  const stageAt = deal ? Math.max(0, stages.findIndex(([k]) => k === deal.stage)) : 0;
  const missing = docs.filter((d) => d.required && (d.status === "missing" || d.status === "rejected"));

  return (
    <>
      <PageHeader
        back={{ href: "/clients", label: "العملاء" }}
        eyebrow={<span className="flex items-center gap-2"><span className="num">{c.file_no}</span><span className="text-slate-300">·</span>{FINANCE_TYPE[c.finance_type]}{c.requested_amount ? <><span className="text-slate-300">·</span><span className="num">{sar(c.requested_amount)}</span></> : null}</span>}
        title={c.full_name}
        sub={<span className="flex flex-wrap items-center gap-2"><EligBadge e={c.eligibility} />{c.owner_name && <span className="text-xs">المسؤول: {c.owner_name}</span>}</span>}
        actions={<>
          {edit ? (
            <form action={setStatus.bind(null, id)}><AutoSelect name="status" label="حالة الملف" defaultValue={c.status} options={STATUS_ORDER.map((k) => [k, STATUS[k].label])} className="font-semibold" /></form>
          ) : <Badge tone={STATUS[c.status as keyof typeof STATUS]?.tone} dot>{STATUS[c.status as keyof typeof STATUS]?.label}</Badge>}
          <MoreMenu items={[...(edit ? [{ href: `/clients/${id}?tab=edit`, label: "تعديل البيانات", icon: "edit" }] : []), { href: `/clients/${id}/report`, label: "تقرير الدراسة", icon: "print" }]} />
        </>}
      />

      <div className="no-print mb-6 space-y-3">
        <div className="seg overflow-x-auto max-w-full">
          {GROUPS.filter((g) => g.key !== "deal" || deal).map((g) => (
            <Link key={g.key} href={`?tab=${g.tabs[0]}`} scroll={false} className={`seg-item ${group.key === g.key ? "seg-on" : ""}`}>
              <Icon name={g.icon} className="size-4" />{g.label}
              {g.key === "docs" && <span className="num text-[11px] text-slate-400">{dp.requiredDone}/{dp.required}</span>}
            </Link>
          ))}
        </div>
        {SUB[group.key] && (
          <div className="flex gap-5 border-b border-slate-200/70 px-1">
            {SUB[group.key].map(([k, l]) => (
              <Link key={k} href={`?tab=${k}`} scroll={false} className={`relative pb-2.5 text-[13px] font-semibold transition-colors ${tab === k ? "text-ink" : "text-slate-500 hover:text-ink"}`}>
                {l}{k === "apps" && apps.length > 0 && <span className="ms-1.5 num text-[11px] text-slate-400">{apps.length}</span>}
                {tab === k && <span className="absolute -bottom-px inset-x-0 h-0.5 rounded-full bg-gold" />}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div key={tab} className="animate-rise">
      {tab === "deal" && deal && (
        <div className="space-y-4">
          {(c.status === "rejected" || deal.stage === "lost") ? (
            <Callout tone="red" icon="x-circle" title="الملف مرفوض" action={edit && <form action={reopenDeal.bind(null, id)}><button className="btn-ghost btn-sm">إعادة فتح</button></form>}>
              {[...deal.log].reverse().find((g) => g.stage === "lost")?.note ?? "متوقف"}. رسائل العميل ورابطه موقوفة.
            </Callout>
          ) : deal.saved && deal.study.verdict === "short" ? (
            <div className="rounded-xl bg-rose-50 text-rose-900 px-4 py-3.5 space-y-3">
              <div className="flex gap-3 text-sm"><Icon name="x-circle" className="size-[18px] mt-0.5" /><div className="leading-6"><b>الصفقة لا تقفل، العجز <span className="num">{sar(Math.max(0, -deal.study.clientNet))}</span>.</b> {deal.study.breakEvenDiscount ? `يسدّه خصم نحو ${deal.study.breakEvenDiscount}% على التنفيذ والتعثرات، أو تقييم أعلى.` : "يسدّه تقييم أعلى أو تمويل أكبر."}</div></div>
              {edit && (
                <form action={rejectDeal.bind(null, id)} className="flex flex-wrap gap-2">
                  <input name="reason" className="input flex-1 min-w-48" placeholder={`سبب الرفض، افتراضياً: عجز ${fmt(Math.max(0, -deal.study.clientNet))}`} />
                  <button className="btn-danger">اعتماد الرفض</button>
                </form>
              )}
            </div>
          ) : null}

          <div className="card p-5">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
              <div><div className="eyebrow">المرحلة</div><div className="mt-1 font-bold text-[15px]">{STAGE_LABEL[deal.stage]}</div></div>
              {deal.saved ? <div className="num text-xs text-slate-500">{deal.stage === "lost" || deal.stage === "closed" ? "" : `${stageAt + 1} من ${stages.length}`}</div> : <div className="text-xs text-amber-700">تبدأ المراحل بعد أول حفظ للدراسة</div>}
            </div>
            <div className="mt-3"><StageBar total={stages.length} at={deal.stage === "closed" ? stages.length : stageAt} lost={deal.stage === "lost"} /></div>
            {edit && deal.saved && (
              <form action={setDealStage.bind(null, id)} className="mt-4 flex flex-wrap gap-2">
                <select name="stage" aria-label="المرحلة التالية" defaultValue={(() => { const ss = stagesFor(deal.input.structure); return ss[Math.min(ss.length - 3, ss.findIndex(([x]) => x === deal.stage) + 1)][0]; })()} className="input w-auto max-w-full">{stagesFor(deal.input.structure).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <input name="note" className="input flex-1 min-w-40" placeholder="ملاحظة (اختياري)" />
                <button className="btn-ghost">نقل المرحلة</button>
              </form>
            )}
            {deal.log.length > 0 && (
              <details className="group mt-3">
                <summary className="cursor-pointer list-none inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-ink"><Icon name="chevron-down" className="size-3.5 transition-transform group-open:rotate-180" />سجل المراحل</summary>
                <ul className="mt-2 space-y-1.5 text-xs text-slate-500">{[...deal.log].reverse().slice(0, 10).map((g, i) => <li key={i}><span className="num">{g.at}</span> · <b className="text-ink">{STAGE_LABEL[g.stage]}</b> · {g.by}{g.note ? ` · ${g.note}` : ""}</li>)}</ul>
              </details>
            )}
          </div>
          <DealEditor clientId={id} initial={deal.input} borrower={deal.borrower} credit={deal.credit} canEdit={edit} save={saveDeal} banks={BANKS} />
        </div>
      )}

      {tab === "wa" && wa && (
        <WhatsAppPanel clientId={id} phone={c.phone} ctx={wa} initialLink={shareUrl} linkInfo={share ? { expires: share.expires_at, views: share.views, lastView: share.last_view_at } : null}
          createLink={createShareLink} revokeLinks={revokeShareLinks} log={logWhatsapp} canEdit={edit} api={waApi!} sendDirect={waSendDirect} />
      )}

      {tab === "overview" && (
        <div className="space-y-4">
          {!pj && (
            <MetricStrip cols={3}>
              <Metric label="القسط الشهري المتاح" value={fmt(s.capacity.available)} unit="ر.س" tone="brand" />
              <Metric label="أفضل مبلغ ممكن" value={fmt(s.matches.find((m) => m.verdict !== "fail")?.maxPrincipal ?? 0)} unit="ر.س" />
              <Metric label="الاستقطاع الحالي" value={`${s.capacity.currentDbr}%`} hint={<>من دخل <span className="num">{fmt(s.capacity.income)}</span></>} />
            </MetricStrip>
          )}
          <div className="grid lg:grid-cols-3 gap-4 items-start">
            <div className="lg:col-span-2 space-y-4">
              <div className="card p-5 sm:p-6">
                <SectionTitle action={edit && <Link href="?tab=edit" scroll={false} className="btn-quiet btn-sm"><Icon name="edit" className="size-3.5" />تعديل</Link>}>بيانات العميل</SectionTitle>
                <dl className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4 text-sm">
                  <Field k="رقم الهوية" v={can(u, "client.view_pii") ? <RevealId clientId={id} masked={maskId(c.national_id)} /> : maskId(c.national_id)} />
                  <Field k="الجوال" v={<span className="num">{c.phone ?? "—"}</span>} />
                  <Field k="العمر" v={age ? `${age} سنة` : "—"} />
                  <Field k="جهة العمل" v={c.employer} />
                  <Field k="القطاع" v={SECTOR[c.sector]} />
                  <Field k="مدة الخدمة" v={c.service_months != null ? `${c.service_months} شهراً` : "—"} />
                  <Field k="الراتب الأساسي" v={<span className="num">{sar(c.basic_salary)}</span>} />
                  <Field k="الراتب الإجمالي" v={<span className="num">{sar(c.total_salary)}</span>} />
                  <Field k="بنك الراتب" v={c.salary_bank ? BANKS[c.salary_bank] : "—"} />
                  <Field k="سمة" v={<Badge tone={c.simah === "clean" ? "green" : c.simah === "unknown" ? "slate" : "red"}>{SIMAH[c.simah]}</Badge>} />
                  <Field k="الغرض" v={c.purpose} />
                  <Field k="مستفيد سكني" v={c.housing_support ? "نعم" : "لا"} />
                </dl>
              </div>
              <div className="card overflow-hidden">
                <div className="px-5 sm:px-6 pt-5"><SectionTitle count={obligations.length}>الالتزامات الحالية</SectionTitle></div>
                {obligations.length === 0 ? <p className="px-5 sm:px-6 pb-4 text-[13px] text-slate-500">لا التزامات مسجلة.</p> : (
                  <table className="w-full"><thead><tr>{["النوع", "الجهة", "القسط", "المتبقي", ""].map((h, i) => <th key={i} className={`th ${i === 0 ? "ps-5 sm:ps-6" : ""}`}>{h}</th>)}</tr></thead>
                    <tbody>{obligations.map((o) => (
                      <tr key={o.id}><td className="td ps-5 sm:ps-6">{OBLIGATION_KIND[o.kind]}</td><td className="td">{o.lender ?? "—"}</td><td className="td num">{sar(o.monthly)}</td><td className="td num">{sar(o.remaining)}</td>
                        <td className="td w-12">{edit && <form action={deleteObligation.bind(null, id, o.id)}><button aria-label="حذف" className="size-8 grid place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-700 cursor-pointer"><Icon name="trash" className="size-4" /></button></form>}</td></tr>
                    ))}</tbody></table>
                )}
                {edit && (
                  <form action={addObligation.bind(null, id)} className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 p-4 sm:px-6 border-t border-slate-100">
                    <select name="kind" aria-label="النوع" className="input">{Object.entries(OBLIGATION_KIND).map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select>
                    <input name="lender" placeholder="الجهة" className="input" />
                    <input name="monthly" placeholder="القسط" className="input num" inputMode="decimal" required />
                    <input name="remaining" placeholder="المتبقي" className="input num" inputMode="decimal" />
                    <button className="btn-ghost"><Icon name="plus" className="size-4" />إضافة</button>
                  </form>
                )}
              </div>
            </div>
            <div className="space-y-4">
              <div className="card p-5">
                <SectionTitle>الخطوة القادمة</SectionTitle>
                <form action={setNextStep.bind(null, id)} className="space-y-2">
                  <textarea name="next_step" aria-label="الخطوة القادمة" defaultValue={c.next_step ?? ""} rows={2} className="input" disabled={!edit} placeholder="ما المطلوب بعد ذلك؟" />
                  <div className="flex gap-2"><input type="date" name="next_step_due" aria-label="الموعد" defaultValue={c.next_step_due ?? ""} className="input num" disabled={!edit} />{edit && <button className="btn-ghost">حفظ</button>}</div>
                </form>
              </div>
              <div className="card p-5">
                <SectionTitle action={<span className="num text-sm font-bold">{dp.pct}%</span>}>المستندات</SectionTitle>
                <Progress pct={dp.pct} tone={dp.pct === 100 ? "green" : "brand"} />
                {missing.length > 0 && <ul className="mt-4 space-y-2 text-[13px] text-slate-600">{missing.slice(0, 5).map((d) => <li key={d.id} className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-rose-500" />{d.label}</li>)}{missing.length > 5 && <li className="text-xs text-slate-400">و{missing.length - 5} غيرها</li>}</ul>}
                <Link href="?tab=docs" scroll={false} className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-ink">إدارة المستندات<Icon name="arrow-left" className="size-3.5" /></Link>
              </div>
              {!pj && s.recommendations.length > 0 && (
                <div className="card p-5">
                  <SectionTitle>التوصيات</SectionTitle>
                  <ol className="space-y-2.5 text-[13px] leading-6 text-slate-700">{s.recommendations.slice(0, 3).map((r, i) => <li key={i} className="flex gap-3"><span className="size-5 shrink-0 mt-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px] font-bold grid place-items-center num">{i + 1}</span>{r}</li>)}</ol>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "study" && (
        <div className="space-y-4">
          {pj ? <ProjectView p={pj.study} x={pj.input} /> : <StudyView s={s} exp={exp} rules={rules} requested={c.requested_amount} />}
          {!pj && (
            <Fold title="نقاط القوة والمخاطر" icon="scale" meta={<><span className="text-emerald-700 num">{s.strengths.length}</span><span className="text-rose-700 num">{s.risks.length}</span></>}>
              <div className="grid md:grid-cols-3 gap-6">
                <ListCol title="نقاط القوة" items={s.strengths} icon="check" tone="text-emerald-600" />
                <ListCol title="المخاطر" items={s.risks} icon="alert" tone="text-amber-600" />
                <ListCol title="التوصيات" items={s.recommendations} icon="arrow-left" tone="text-brand-700" />
              </div>
            </Fold>
          )}
          <Fold title="رأي المحلل واعتماد الدراسة" icon="edit" open={lastStudy.length > 0} meta={lastStudy[0] ? <EligBadge e={lastStudy[0].verdict} /> : undefined}>
            {lastStudy.map((st, i) => (
              <div key={i} className="mb-3 rounded-xl bg-slate-50 p-3.5 text-sm leading-6"><div className="flex items-center gap-2 mb-1.5"><EligBadge e={st.verdict} /><span className="text-xs text-slate-500">{st.name} · {dateTimeAr(st.created_at)}</span></div>{st.analyst_opinion}</div>
            ))}
            {can(u, "study.approve") ? (
              <form action={saveStudy.bind(null, id)} className="grid sm:grid-cols-[190px_1fr_auto] gap-2 items-start">
                <select name="verdict" aria-label="الحكم" defaultValue={s.verdict} className="input">{Object.entries(ELIGIBILITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
                <textarea name="opinion" rows={2} className="input" placeholder="رأي المحلل والشروط" />
                <button className="btn-primary">اعتماد</button>
              </form>
            ) : <p className="text-[13px] text-slate-500">الاعتماد للمحلل الائتماني والمدير.</p>}
          </Fold>
        </div>
      )}

      {tab === "credit" && (
        <div className="space-y-4">
          {cr ? (
            <>
              <CreditView clientId={id} reportId={cr.id} r={cr.report} a={cr.analysis} createdAt={cr.createdAt} author={cr.author} canEdit={can(u, "client.edit")} />
              {can(u, "doc.upload") && <div className="flex justify-start"><SimahUpload clientId={id} label="رفع تقرير أحدث" /></div>}
            </>
          ) : (
            <div className="card"><Empty art="docs" title="لم يُرفع تقرير سمة" action={can(u, "doc.upload") ? <SimahUpload clientId={id} /> : undefined}>ارفع التقرير بصيغة PDF كما نزل من سمة، ونقرأه ونحدّث الدراسة.</Empty></div>
          )}
        </div>
      )}

      {tab === "docs" && (
        <div className="space-y-4">
          {Object.entries(DOC_CATEGORY).map(([cat, label]) => {
            const list = docs.filter((d) => d.category === cat);
            if (!list.length) return null;
            return (
              <div key={cat} className="card overflow-hidden">
                <div className="px-5 pt-4 pb-2 flex items-center gap-2"><h3 className="font-bold text-[15px]">{label}</h3><span className="num text-xs text-slate-400">{list.filter((d) => d.status === "received" || d.status === "verified").length}/{list.length}</span></div>
                <ul>
                  {list.map((d) => (
                    <li key={d.id} className="px-5 py-3 border-t border-slate-100 flex flex-wrap items-center gap-x-3 gap-y-2">
                      <Icon name={d.status === "verified" ? "check-circle" : d.status === "received" ? "file" : d.status === "rejected" ? "x-circle" : "file"} className={`size-[18px] ${d.status === "verified" ? "text-emerald-600" : d.status === "received" ? "text-sky-600" : d.status === "rejected" ? "text-rose-600" : "text-slate-300"}`} />
                      <div className="flex-1 min-w-48">
                        <div className="text-sm font-medium">{d.label}{!d.required && <span className="ms-2 text-[11px] font-normal text-slate-400">اختياري</span>}</div>
                        {d.file_name && <div className="text-xs text-slate-500 mt-0.5 truncate"><a className="font-medium text-brand-700 hover:underline" href={`/api/files/${d.id}`} target="_blank">{d.file_name}</a> · <span className="num">{Math.round((d.size ?? 0) / 1024)} KB</span> · {dateAr(d.uploaded_at)}</div>}
                      </div>
                      <Badge tone={DOC_STATUS[d.status].tone}>{DOC_STATUS[d.status].label}</Badge>
                      {can(u, "doc.verify") && d.status === "received" && (
                        <>
                          <form action={setDocStatus.bind(null, id, d.id, "verified")}><button className="btn-ghost btn-sm !text-emerald-700"><Icon name="check" className="size-3.5" strokeWidth={2.2} />تحقق</button></form>
                          <form action={setDocStatus.bind(null, id, d.id, "rejected")}><button className="btn-quiet btn-sm !text-rose-700">يُعاد</button></form>
                        </>
                      )}
                      {can(u, "doc.upload") && d.status === "missing" && <form action={setDocStatus.bind(null, id, d.id, "received")}><button className="btn-quiet btn-sm" title="استُلم ورقياً">ورقي</button></form>}
                      {can(u, "doc.upload") && <UploadButton clientId={id} docId={d.id} hasFile={!!d.file_name} />}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {can(u, "doc.upload") && (
            <form action={addCustomDoc.bind(null, id)} className="flex flex-wrap gap-2">
              <input name="label" placeholder="مستند إضافي تطلبه جهة معينة" className="input flex-1 min-w-56" required />
              <select name="category" aria-label="التصنيف" className="input w-auto">{Object.entries(DOC_CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <button className="btn-ghost"><Icon name="plus" className="size-4" />إضافة</button>
            </form>
          )}
          <p className="text-xs text-slate-400 flex items-center gap-1.5"><Icon name="lock" className="size-3.5" />الملفات محفوظة بأسماء عشوائية، وكل تنزيل يُسجَّل. PDF أو صورة حتى 10MB.</p>
        </div>
      )}

      {tab === "apps" && (
        <div className="space-y-4">
          <div className="card overflow-hidden">
            {apps.length === 0 ? <Empty art="path" title="لا طلبات بعد">اختر جهة من الدراسة وسجّل الطلب هنا.</Empty> : (
              <ul>
                {apps.map((a) => (
                  <li key={a.id} className="px-5 py-4 border-b border-slate-100 last:border-0 grid grid-cols-2 md:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,.7fr))_auto_auto] items-center gap-x-5 gap-y-3">
                    <div className="min-w-0 col-span-2 md:col-span-1"><div className="font-semibold text-sm truncate">{a.lender_name}</div><div className="text-xs text-slate-500 truncate">{a.product_name}{a.ref_no ? <> · <span className="num">{a.ref_no}</span></> : null}{a.submitted_at ? ` · ${dateAr(a.submitted_at)}` : ""}</div>{a.note && <div className="text-xs text-slate-500 mt-1">{a.note}</div>}</div>
                    <Cell k="المبلغ" v={sar(a.amount)} /><Cell k="القسط" v={sar(a.installment)} /><Cell k="المدة" v={a.tenor ? `${a.tenor}` : "—"} />
                    <div>{can(u, "app.manage") ? <form action={updateApplication.bind(null, id, a.id)}><AutoSelect name="status" label="حالة الطلب" defaultValue={a.status} options={Object.entries(APP_STATUS).map(([k, v]) => [k, v.label])} className="!h-8 text-xs" /></form> : <Badge tone={APP_STATUS[a.status].tone} dot>{APP_STATUS[a.status].label}</Badge>}</div>
                    <div className="justify-self-end">{outcomes.has(a.id) ? <OutcomeBadge o={outcomes.get(a.id)!} /> : can(u, "app.manage") && <OutcomeForm action={recordOutcome.bind(null, id, a.id)} amount={a.amount} tenor={a.tenor} />}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {can(u, "app.manage") && (
            <div className="card p-5">
              <SectionTitle>طلب جديد</SectionTitle>
              {s.matches.some((m) => m.verdict !== "fail") && (
                <div className="flex flex-wrap gap-2 mb-4">
                  {s.matches.filter((m) => m.verdict !== "fail").slice(0, 4).map((m) => (
                    <form key={m.product.id} action={createApplication.bind(null, id)}>
                      <input type="hidden" name="lender_id" value={m.product.lenderId} /><input type="hidden" name="product_name" value={m.product.name} />
                      <input type="hidden" name="amount" value={m.offerPrincipal} /><input type="hidden" name="tenor" value={m.tenor} /><input type="hidden" name="installment" value={m.installment} />
                      <button className="btn-ghost btn-sm"><Icon name="plus" className="size-3.5" />{m.product.lenderName}<span className="num text-slate-500">{sar(m.offerPrincipal)}</span></button>
                    </form>
                  ))}
                </div>
              )}
              <details className="group">
                <summary className="cursor-pointer list-none inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-ink"><Icon name="chevron-down" className="size-3.5 transition-transform group-open:rotate-180" />إدخال يدوي</summary>
                <form action={createApplication.bind(null, id)} className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <select name="lender_id" aria-label="الجهة" className="input" required><option value="">الجهة</option>{lenders.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
                  <input name="product_name" placeholder="المنتج" className="input" />
                  <input name="amount" placeholder="المبلغ" className="input num" inputMode="decimal" />
                  <input name="tenor" placeholder="المدة (شهر)" className="input num" inputMode="numeric" />
                  <input name="installment" placeholder="القسط" className="input num" inputMode="decimal" />
                  <input name="ref_no" placeholder="رقم الطلب لدى الجهة" className="input" />
                  <select name="status" aria-label="الحالة" className="input" defaultValue="submitted"><option value="draft">مسودة</option><option value="submitted">مقدم</option></select>
                  <input name="note" placeholder="ملاحظة" className="input" />
                  <button className="btn-primary col-span-2 sm:col-span-4 sm:w-fit">تسجيل الطلب</button>
                </form>
              </details>
            </div>
          )}
        </div>
      )}

      {tab === "notes" && (
        <div className="grid lg:grid-cols-5 gap-4 items-start">
          <div className="lg:col-span-3 card p-5 sm:p-6">
            <SectionTitle count={notes.length}>الملاحظات</SectionTitle>
            {edit && (
              <form action={addNote.bind(null, id)} className="mb-5 rounded-xl border border-slate-200 focus-within:border-brand-500 transition-colors">
                <textarea name="body" rows={2} aria-label="ملاحظة جديدة" className="block w-full bg-transparent px-3.5 pt-3 text-sm leading-7 outline-none resize-none" placeholder="ماذا حدث؟ ما الذي اتُّفق عليه؟" required />
                <div className="flex items-center gap-2 p-2"><select name="kind" aria-label="النوع" className="input !h-8 w-auto text-xs">{Object.entries(NOTE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><button className="btn-primary btn-sm ms-auto">إضافة</button></div>
              </form>
            )}
            {notes.length === 0 ? <p className="text-[13px] text-slate-500">لا ملاحظات بعد.</p> : (
              <ul className="space-y-4">
                {notes.map((n) => (
                  <li key={n.id}>
                    <div className="flex items-center gap-2 text-xs text-slate-500 mb-1"><Badge>{NOTE_KIND[n.kind]}</Badge>{n.name}<span className="text-slate-300">·</span>{dateTimeAr(n.created_at)}</div>
                    <div className="text-sm leading-7 whitespace-pre-wrap">{plain(n.body)}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="lg:col-span-2 card p-5 sm:p-6">
            <SectionTitle>سجل الملف</SectionTitle>
            <ol className="relative">
              <span className="absolute top-2 bottom-2 start-[3px] w-px bg-slate-200" />
              {history.map((h, i) => (
                <li key={i} className="relative ps-5 pb-4 last:pb-0">
                  <span className="absolute start-0 top-[7px] size-[7px] rounded-full bg-gold ring-4 ring-white" />
                  <div className="text-[13px] leading-5"><b>{h.name ?? "النظام"}</b> <span className="text-slate-600">{AUDIT_ACTION[h.action] ?? h.action}</span>{h.action === "client_status" && h.details && (() => { try { const d = JSON.parse(h.details); return <span className="text-slate-500"> · {STATUS[d.to as keyof typeof STATUS]?.label}</span>; } catch { return null; } })()}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{dateTimeAr(h.created_at)}</div>
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
            <form action={deleteClient.bind(null, id)} className="mt-8 rounded-2xl border border-rose-200 p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm"><b className="text-rose-700">حذف الملف نهائياً</b><div className="text-xs text-slate-500 mt-0.5">يُحذف الملف ومستنداته، ولا يمكن التراجع.</div></div>
              <ConfirmButton>حذف الملف</ConfirmButton>
            </form>
          )}
        </>
      )}
      </div>
    </>
  );
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium mt-1 truncate">{v || "—"}</dd></div>;
}
function Cell({ k, v }: { k: string; v: string }) {
  return <div className="min-w-0"><div className="text-[11px] text-slate-500">{k}</div><div className="num text-sm font-semibold">{v}</div></div>;
}
function ListCol({ title, items, icon, tone }: { title: string; items: string[]; icon: string; tone: string }) {
  return (
    <div>
      <div className="eyebrow mb-2.5">{title}</div>
      {items.length === 0 ? <p className="text-sm text-slate-300">—</p> : <ul className="space-y-2 text-[13px] leading-6">{items.map((x, i) => <li key={i} className="flex gap-2"><Icon name={icon} className={`size-4 mt-1 ${tone}`} strokeWidth={2} /><span>{x}</span></li>)}</ul>}
    </div>
  );
}

function OutcomeBadge({ o }: { o: { decision: keyof typeof OUTCOME_DECISION; approved_amount: number | null; conditions: string; reason: string | null } }) {
  const conds = JSON.parse(o.conditions || "[]") as string[];
  return (
    <div className="text-end">
      <Badge tone={OUTCOME_DECISION[o.decision].tone}>{OUTCOME_DECISION[o.decision].label}</Badge>
      {o.approved_amount ? <div className="text-xs num mt-1 font-semibold">{sar(o.approved_amount)}</div> : null}
      {o.reason && <div className="text-xs text-rose-700 mt-1">{REJECT_REASONS[o.reason] ?? o.reason}</div>}
      {conds.length > 0 && <div className="text-[11px] text-slate-500 max-w-48 mt-1">{conds.map((k) => OUTCOME_CONDITIONS[k] ?? k).join("، ")}</div>}
    </div>
  );
}
