import { all } from "@/lib/db";
import { requirePage, ROLE_LABEL, type Role } from "@/lib/auth";
import { Badge, Fold, PageHeader, dateTimeAr } from "@/components/ui";
import { Icon } from "@/components/icon";
import { updateUser } from "@/app/actions";
import NewUserForm from "@/components/new-user";

export const dynamic = "force-dynamic";

const ROLE_DESC: Record<Role, string> = {
  admin: "كل الصلاحيات وإدارة المستخدمين وسجل التدقيق",
  analyst: "اعتماد الأهلية والتحقق من المستندات ومعايير الجهات",
  officer: "فتح الملفات ورفع المستندات وتسجيل الطلبات",
  viewer: "اطلاع فقط دون رؤية الهوية كاملة",
};

export default async function Users() {
  const me = await requirePage("user.manage");
  const users = await all<{ id: number; name: string; email: string; role: Role; active: number; last_login_at: string | null; phone: string | null; totp_enabled: number; keys: number }>(
    "SELECT u.id, u.name, u.email, u.role, u.active, u.last_login_at, u.phone, u.totp_enabled, (SELECT COUNT(*) FROM passkeys p WHERE p.user_id = u.id) keys FROM users u ORDER BY u.id");
  return (
    <>
      <PageHeader title="المستخدمون" sub={<><span className="num">{users.length}</span> مستخدم</>} />
      <div className="space-y-5 stagger">
        <div className="card overflow-hidden">
          {users.map((x) => (
            <details key={x.id} className="group border-b border-slate-100 last:border-0">
              <summary className="list-none cursor-pointer grid grid-cols-[minmax(0,1fr)_auto_24px] sm:grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_24px] gap-4 items-center px-5 py-3.5 hover:bg-slate-50/70 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="size-9 shrink-0 rounded-full bg-brand-800 text-white grid place-items-center text-sm font-bold">{x.name.trim().charAt(0)}</span>
                  <div className="min-w-0"><div className="font-semibold text-sm truncate">{x.name}{x.id === me.id && <span className="text-xs font-normal text-slate-400"> · أنت</span>}</div><div className="text-xs text-slate-500 truncate text-left" dir="ltr">{x.email}</div></div>
                </div>
                <div className="hidden sm:block text-sm">{ROLE_LABEL[x.role]}</div>
                <div>{x.active ? <Badge tone="green" dot>نشط</Badge> : <Badge tone="red" dot>موقوف</Badge>}</div>
                <div className="hidden sm:block text-xs text-slate-500">{dateTimeAr(x.last_login_at)}</div>
                <Icon name="chevron-down" className="size-4 text-slate-400 transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-5 pb-5 pt-1 animate-fade">
                {x.id !== me.id ? (
                  <form action={updateUser.bind(null, x.id)} className="space-y-4">
                    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div><label className="label">الدور</label><select name="role" defaultValue={x.role} className="input">{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                      <div><label className="label">الحالة</label><select name="active" defaultValue={String(x.active)} className="input"><option value="1">نشط</option><option value="0">موقوف</option></select></div>
                      <div><label className="label">جوال الدخول</label><input name="phone" defaultValue={x.phone ?? ""} dir="ltr" inputMode="tel" placeholder="05xxxxxxxx" className="input num" /></div>
                      <div><label className="label">كلمة مرور جديدة</label><input name="password" type="password" placeholder="بلا تغيير" className="input" autoComplete="new-password" /></div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2 text-[13px] text-slate-600">
                        {x.keys > 0 && <Badge tone="brand" icon="fingerprint">مفاتيح المرور <span className="num">{x.keys}</span></Badge>}
                        {x.totp_enabled ? <Badge tone="brand" icon="shield">تطبيق المصادقة</Badge> : null}
                        <label className="inline-flex items-center gap-2"><input type="checkbox" name="reset_security" value="1" className="size-4 accent-rose-600" />تصفير طرق الدخول وفك القفل</label>
                      </div>
                      <button className="btn-primary">حفظ</button>
                    </div>
                  </form>
                ) : <p className="text-[13px] text-slate-500">تعدّل بياناتك من «حسابي والأمان».</p>}
              </div>
            </details>
          ))}
        </div>
        <Fold title="إضافة مستخدم" icon="plus"><NewUserForm /></Fold>
        <Fold title="الأدوار" icon="shield">
          <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-4">
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <div key={r}><dt className="font-semibold text-sm">{ROLE_LABEL[r]}</dt><dd className="text-[13px] text-slate-500 mt-0.5 leading-6">{ROLE_DESC[r]}</dd></div>)}
          </dl>
        </Fold>
      </div>
    </>
  );
}
