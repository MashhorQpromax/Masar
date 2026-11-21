import { all } from "@/lib/db";
import { requireUser, can } from "@/lib/auth";
import { productRows } from "@/lib/data";
import { FINANCE_TYPE, SECTOR } from "@/lib/labels";
import { Badge, PageHeader, sar, dateAr } from "@/components/ui";
import { saveProduct } from "@/app/actions";

export const dynamic = "force-dynamic";
type PR = Awaited<ReturnType<typeof productRows>>[number];

export default async function Lenders() {
  const u = await requireUser();
  const rows = await productRows(true);
  const lenders = await all<{ id: number; name: string }>("SELECT id, name FROM lenders ORDER BY name");
  const manage = can(u, "lender.manage");
  const groups = Object.entries(FINANCE_TYPE).map(([k, v]) => [k, v, rows.filter((r) => r.finance_type === k)] as const).filter((g) => g[2].length);
  return (
    <>
      <PageHeader title="جهات التمويل والمنتجات" sub={`${lenders.length} جهة · ${rows.length} منتج — هذه المعايير هي ما يستخدمه محرك الأهلية`} />
      <div className="rounded-2xl bg-amber-50 ring-1 ring-amber-200 p-4 text-sm text-amber-900 mb-6 leading-6">
        ⚠️ القيم الحالية تقديرية للعرض. على فريق الائتمان تحديث كل منتج من سياسة الجهة الفعلية ثم تفعيل «تم التحقق». عند الحفظ تُعاد دراسة كل الملفات النشطة تلقائياً.
      </div>
      {groups.map(([k, label, list]) => (
        <div key={k} className="mb-8">
          <h2 className="font-bold mb-3">{label}</h2>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[1000px]">
              <thead><tr>{["الجهة / المنتج", "النسبة", "أقل راتب", "أقصى مبلغ", "أقصى مدة", "العمر عند الانتهاء", "الخدمة", "القطاعات", "شروط", "التحقق", ""].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id} className={p.active ? "" : "opacity-50"}>
                    <td className="td"><div className="font-semibold">{p.lender_name}</div><div className="text-xs text-slate-500">{p.name}</div></td>
                    <td className="td num">{p.rate}% <span className="text-xs text-slate-400">{p.rate_type === "flat" ? "ثابتة" : "متناقصة"}</span></td>
                    <td className="td num">{sar(p.min_salary)}</td><td className="td num">{sar(p.max_amount)}</td><td className="td num">{p.max_tenor}</td>
                    <td className="td num">{p.max_age_at_maturity}</td><td className="td num">{p.min_service_months}</td>
                    <td className="td text-xs max-w-48">{(JSON.parse(p.sectors) as (keyof typeof SECTOR)[]).map((s) => SECTOR[s]).join("، ")}</td>
                    <td className="td"><div className="flex flex-wrap gap-1">{p.requires_salary_transfer ? <Badge>تحويل راتب</Badge> : <Badge tone="green">بدون تحويل</Badge>}{p.accepts_late_simah ? <Badge tone="amber">يقبل تأخر سمة</Badge> : null}{p.max_ltv ? <Badge tone="blue">LTV {p.max_ltv}%</Badge> : null}</div></td>
                    <td className="td">{p.verified_at ? <Badge tone="green">✓ {dateAr(p.verified_at)}</Badge> : <Badge tone="amber">تقديري</Badge>}</td>
                    <td className="td">{manage && <details className="relative"><summary className="btn-ghost btn-sm list-none">تعديل</summary><div className="absolute z-10 end-0 mt-2 w-[640px] card p-5 shadow-xl"><ProductForm p={p} /></div></details>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {manage && (
        <div className="card p-5">
          <h2 className="font-bold mb-4">إضافة منتج / جهة</h2>
          <ProductForm lenders={lenders} />
        </div>
      )}
    </>
  );
}

function ProductForm({ p, lenders }: { p?: PR; lenders?: { id: number; name: string }[] }) {
  const sectors: string[] = p ? JSON.parse(p.sectors) : ["gov", "military", "semi_gov", "private_approved"];
  const nats: string[] = p ? JSON.parse(p.nationalities) : ["saudi"];
  const N = (name: string, label: string, v?: number | null) => <div><label className="label">{label}</label><input name={name} defaultValue={v ?? ""} className="input" inputMode="decimal" /></div>;
  return (
    <form action={saveProduct} className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
      {p && <input type="hidden" name="id" value={p.id} />}
      {!p && (
        <>
          <div><label className="label">الجهة</label><select name="lender_id" className="input"><option value="">— جهة جديدة —</option>{lenders?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
          <div><label className="label">أو اسم جهة جديدة</label><input name="new_lender" className="input" /></div>
          <div><label className="label">نوع الجهة</label><select name="lender_type" className="input"><option value="bank">بنك</option><option value="finance_company">شركة تمويل</option></select></div>
          <div><label className="label">نوع التمويل</label><select name="finance_type" className="input">{Object.entries(FINANCE_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        </>
      )}
      <div className="col-span-2"><label className="label">اسم المنتج</label><input name="name" defaultValue={p?.name} className="input" required /></div>
      {N("rate", "النسبة السنوية %", p?.rate)}
      <div><label className="label">نوع النسبة</label><select name="rate_type" defaultValue={p?.rate_type ?? "flat"} className="input"><option value="flat">ثابتة (Flat)</option><option value="reducing">متناقصة (APR)</option></select></div>
      {N("min_salary", "أقل راتب", p?.min_salary)}{N("max_amount", "أقصى مبلغ", p?.max_amount)}{N("max_tenor", "أقصى مدة (شهر)", p?.max_tenor ?? 60)}{N("min_service_months", "أقل خدمة (شهر)", p?.min_service_months ?? 3)}
      {N("min_age", "أقل عمر", p?.min_age ?? 21)}{N("max_age_at_maturity", "أقصى عمر عند الانتهاء", p?.max_age_at_maturity ?? 60)}{N("max_ltv", "أقصى LTV % (عقاري)", p?.max_ltv)}
      <div className="col-span-2 sm:col-span-4"><label className="label">القطاعات المقبولة</label><div className="flex flex-wrap gap-3">{Object.entries(SECTOR).map(([k, v]) => <label key={k} className="flex items-center gap-1.5"><input type="checkbox" name="sectors" value={k} defaultChecked={sectors.includes(k)} className="accent-brand-600" />{v}</label>)}</div></div>
      <div className="col-span-2 sm:col-span-4 flex flex-wrap gap-4">
        <label className="flex items-center gap-1.5"><input type="checkbox" name="nationalities" value="saudi" defaultChecked={nats.includes("saudi")} className="accent-brand-600" />سعودي</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" name="nationalities" value="non_saudi" defaultChecked={nats.includes("non_saudi")} className="accent-brand-600" />غير سعودي</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" name="requires_salary_transfer" defaultChecked={p ? !!p.requires_salary_transfer : true} className="accent-brand-600" />يتطلب تحويل الراتب</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" name="accepts_late_simah" defaultChecked={!!p?.accepts_late_simah} className="accent-brand-600" />يقبل تأخر سمة</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" name="active" defaultChecked={p ? !!p.active : true} className="accent-brand-600" />مفعل</label>
        {p && <label className="flex items-center gap-1.5 font-semibold text-emerald-700"><input type="checkbox" name="verified" className="accent-emerald-600" />تم التحقق من الجهة اليوم</label>}
      </div>
      <div className="col-span-2 sm:col-span-4"><label className="label">ملاحظات / مصدر المعلومة</label><input name="notes" defaultValue={p?.notes ?? ""} className="input" /></div>
      <button className="btn-primary col-span-2 sm:col-span-4">حفظ</button>
    </form>
  );
}
