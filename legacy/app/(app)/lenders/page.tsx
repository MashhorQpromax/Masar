import { all } from "@/lib/db";
import { requireUser, can } from "@/lib/auth";
import { productRows } from "@/lib/data";
import { FINANCE_TYPE, SECTOR } from "@/lib/labels";
import { Badge, Callout, Fold, PageHeader, sar, dateAr } from "@/components/ui";
import { Icon } from "@/components/icon";
import { LenderTabs } from "@/components/lender-tabs";
import { saveProduct } from "@/app/actions";

export const dynamic = "force-dynamic";
type PR = Awaited<ReturnType<typeof productRows>>[number];

export default async function Lenders() {
  const u = await requireUser();
  const rows = await productRows(true);
  const lenders = await all<{ id: number; name: string }>("SELECT id, name FROM lenders ORDER BY name");
  const manage = can(u, "lender.manage");
  const groups = Object.entries(FINANCE_TYPE).map(([k, v]) => [k, v, rows.filter((r) => r.finance_type === k)] as const).filter((g) => g[2].length);
  const unverified = rows.filter((r) => !r.verified_at).length;
  return (
    <>
      <PageHeader title="الجهات" sub={<><span className="num">{lenders.length}</span> جهة · <span className="num">{rows.length}</span> منتج</>} actions={<LenderTabs at="products" />} />
      {unverified > 0 && <div className="mb-6"><Callout tone="amber"><span className="num">{unverified}</span> منتج بقيم تقديرية. حدّثها من سياسة الجهة ثم فعّل «تم التحقق».</Callout></div>}

      <div className="space-y-8 stagger">
        {groups.map(([k, label, list]) => (
          <section key={k}>
            <h2 className="text-[15px] font-bold mb-3 flex items-center gap-2">{label}<span className="num text-xs font-medium text-slate-400">{list.length}</span></h2>
            <div className="card overflow-hidden">
              <div className="hidden md:grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_1.2fr_24px] gap-4 px-5 py-2.5 border-b border-slate-200/70 text-[11px] font-semibold text-slate-500">
                <div>المنتج</div><div>النسبة</div><div>أقصى مبلغ</div><div>أقصى مدة</div><div>التحقق</div><div />
              </div>
              {list.map((p) => (
                <details key={p.id} className={`group border-b border-slate-100 last:border-0 ${p.active ? "" : "opacity-55"}`}>
                  <summary className="list-none cursor-pointer grid grid-cols-[minmax(0,1fr)_auto_24px] md:grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_1.2fr_24px] gap-4 items-center px-5 py-3.5 hover:bg-slate-50/70 transition-colors">
                    <div className="min-w-0"><div className="font-semibold text-sm truncate">{p.lender_name}</div><div className="text-xs text-slate-500 truncate">{p.name}</div></div>
                    <div className="hidden md:block text-sm"><span className="num">{p.rate}%</span> <span className="text-xs text-slate-400">{p.rate_type === "flat" ? "ثابتة" : "متناقصة"}</span></div>
                    <div className="hidden md:block num text-sm">{sar(p.max_amount)}</div>
                    <div className="hidden md:block text-sm"><span className="num">{p.max_tenor}</span> <span className="text-xs text-slate-400">شهراً</span></div>
                    <div>{p.verified_at ? <Badge tone="green" icon="check">{dateAr(p.verified_at)}</Badge> : <Badge tone="amber">تقديري</Badge>}</div>
                    <Icon name="chevron-down" className="size-4 text-slate-400 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="px-5 pb-5 pt-1 animate-fade">
                    {manage ? <ProductForm p={p} /> : <Facts p={p} />}
                  </div>
                </details>
              ))}
            </div>
          </section>
        ))}
        {manage && <Fold title="إضافة منتج أو جهة" icon="plus"><ProductForm lenders={lenders} /></Fold>}
      </div>
    </>
  );
}

function Facts({ p }: { p: PR }) {
  const F = ({ k, v }: { k: string; v: React.ReactNode }) => <div><dt className="eyebrow">{k}</dt><dd className="mt-1 text-sm font-medium">{v}</dd></div>;
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4">
        <F k="النسبة" v={<><span className="num">{p.rate}%</span> {p.rate_type === "flat" ? "ثابتة" : "متناقصة"}</>} />
        <F k="أقل راتب" v={<span className="num">{sar(p.min_salary)}</span>} />
        <F k="أقصى مبلغ" v={<span className="num">{sar(p.max_amount)}</span>} />
        <F k="أقصى مدة" v={<span className="num">{p.max_tenor}</span>} />
        <F k="العمر عند الانتهاء" v={<span className="num">{p.max_age_at_maturity}</span>} />
        <F k="أقل خدمة (شهر)" v={<span className="num">{p.min_service_months}</span>} />
        <F k="القطاعات" v={(JSON.parse(p.sectors) as (keyof typeof SECTOR)[]).map((s) => SECTOR[s]).join("، ")} />
      </dl>
      <div className="flex flex-wrap gap-1.5">{p.requires_salary_transfer ? <Badge>تحويل راتب</Badge> : <Badge tone="green">بدون تحويل</Badge>}{p.accepts_late_simah ? <Badge tone="amber">يقبل تأخر سمة</Badge> : null}{p.max_ltv ? <Badge tone="blue">LTV {p.max_ltv}%</Badge> : null}</div>
      {p.notes && <p className="text-[13px] text-slate-500 leading-6">{p.notes}</p>}
    </div>
  );
}

function ProductForm({ p, lenders }: { p?: PR; lenders?: { id: number; name: string }[] }) {
  const sectors: string[] = p ? JSON.parse(p.sectors) : ["gov", "military", "semi_gov", "private_approved"];
  const nats: string[] = p ? JSON.parse(p.nationalities) : ["saudi"];
  const N = (name: string, label: string, v?: number | null) => <div><label className="label">{label}</label><input name={name} defaultValue={v ?? ""} className="input num" inputMode="decimal" /></div>;
  const C = (name: string, label: string, on: boolean, value?: string) => <label className="inline-flex items-center gap-2 text-[13px] text-slate-700"><input type="checkbox" name={name} value={value} defaultChecked={on} className="size-4 accent-brand-700" />{label}</label>;
  return (
    <form action={saveProduct} className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-4 text-sm">
      {p && <input type="hidden" name="id" value={p.id} />}
      {!p && (
        <>
          <div><label className="label">الجهة</label><select name="lender_id" className="input"><option value="">جهة جديدة</option>{lenders?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
          <div><label className="label">اسم الجهة الجديدة</label><input name="new_lender" className="input" /></div>
          <div><label className="label">نوع الجهة</label><select name="lender_type" className="input"><option value="bank">بنك</option><option value="finance_company">شركة تمويل</option></select></div>
          <div><label className="label">نوع التمويل</label><select name="finance_type" className="input">{Object.entries(FINANCE_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        </>
      )}
      <div className="col-span-2"><label className="label">اسم المنتج</label><input name="name" defaultValue={p?.name} className="input" required /></div>
      {N("rate", "النسبة السنوية %", p?.rate)}
      <div><label className="label">نوع النسبة</label><select name="rate_type" defaultValue={p?.rate_type ?? "flat"} className="input"><option value="flat">ثابتة</option><option value="reducing">متناقصة</option></select></div>
      {N("min_salary", "أقل راتب", p?.min_salary)}{N("max_amount", "أقصى مبلغ", p?.max_amount)}{N("max_tenor", "أقصى مدة (شهر)", p?.max_tenor ?? 60)}{N("min_service_months", "أقل خدمة (شهر)", p?.min_service_months ?? 3)}
      {N("min_age", "أقل عمر", p?.min_age ?? 21)}{N("max_age_at_maturity", "أقصى عمر عند الانتهاء", p?.max_age_at_maturity ?? 60)}{N("max_ltv", "أقصى LTV % للعقاري", p?.max_ltv)}
      <div className="col-span-2 sm:col-span-4"><label className="label">القطاعات المقبولة</label><div className="flex flex-wrap gap-x-5 gap-y-2">{Object.entries(SECTOR).map(([k, v]) => <span key={k}>{C("sectors", v, sectors.includes(k), k)}</span>)}</div></div>
      <div className="col-span-2 sm:col-span-4 flex flex-wrap gap-x-5 gap-y-2">
        {C("nationalities", "سعودي", nats.includes("saudi"), "saudi")}
        {C("nationalities", "غير سعودي", nats.includes("non_saudi"), "non_saudi")}
        {C("requires_salary_transfer", "يتطلب تحويل الراتب", p ? !!p.requires_salary_transfer : true)}
        {C("accepts_late_simah", "يقبل تأخر سمة", !!p?.accepts_late_simah)}
        {C("active", "مفعل", p ? !!p.active : true)}
      </div>
      <div className="col-span-2 sm:col-span-4"><label className="label">مصدر المعلومة</label><input name="notes" defaultValue={p?.notes ?? ""} className="input" /></div>
      <div className="col-span-2 sm:col-span-4 flex flex-wrap items-center justify-between gap-3">
        {p ? <label className="inline-flex items-center gap-2 text-[13px] font-semibold text-emerald-700"><input type="checkbox" name="verified" className="size-4 accent-emerald-600" />تحققنا من الجهة اليوم</label> : <span />}
        <button className="btn-primary">حفظ</button>
      </div>
    </form>
  );
}
