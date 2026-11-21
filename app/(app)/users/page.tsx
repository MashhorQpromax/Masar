import { all } from "@/lib/db";
import { requirePage, ROLE_LABEL, type Role } from "@/lib/auth";
import { Badge, PageHeader, dateTimeAr } from "@/components/ui";
import { updateUser } from "@/app/actions";
import NewUserForm from "@/components/new-user";

export const dynamic = "force-dynamic";

const ROLE_DESC: Record<Role, string> = {
  admin: "كل الصلاحيات، إدارة المستخدمين، سجل التدقيق، حذف الملفات",
  analyst: "دراسة واعتماد الأهلية، التحقق من المستندات، تعديل معايير الجهات",
  officer: "فتح الملفات، رفع المستندات، تسجيل الطلبات والمراسلات",
  viewer: "اطلاع فقط دون رؤية الهوية كاملة",
};

export default async function Users() {
  const me = await requirePage("user.manage");
  const users = await all<{ id: number; name: string; email: string; role: Role; active: number; last_login_at: string | null }>("SELECT * FROM users ORDER BY id");
  return (
    <>
      <PageHeader title="المستخدمون والصلاحيات" sub={`${users.length} مستخدم`} />
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
        {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <div key={r} className="card p-4"><div className="font-bold text-sm">{ROLE_LABEL[r]}</div><div className="text-xs text-slate-500 mt-1 leading-5">{ROLE_DESC[r]}</div></div>)}
      </div>
      <div className="card overflow-x-auto mb-6">
        <table className="w-full min-w-[800px]">
          <thead><tr>{["الاسم", "البريد", "الدور", "الحالة", "آخر دخول", "تعديل"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>{users.map((x) => (
            <tr key={x.id}>
              <td className="td font-semibold">{x.name}</td><td className="td num text-xs">{x.email}</td>
              <td className="td">{ROLE_LABEL[x.role]}</td>
              <td className="td">{x.active ? <Badge tone="green">نشط</Badge> : <Badge tone="red">موقوف</Badge>}</td>
              <td className="td text-xs">{dateTimeAr(x.last_login_at)}</td>
              <td className="td">
                {x.id !== me.id ? (
                  <form action={updateUser.bind(null, x.id)} className="flex flex-wrap gap-1">
                    <select name="role" defaultValue={x.role} className="input h-8 text-xs w-auto">{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <select name="active" defaultValue={String(x.active)} className="input h-8 text-xs w-auto"><option value="1">نشط</option><option value="0">إيقاف</option></select>
                    <input name="password" type="password" placeholder="كلمة مرور جديدة" className="input h-8 text-xs w-36" />
                    <button className="btn-ghost btn-sm">حفظ</button>
                  </form>
                ) : <span className="text-xs text-slate-400">حسابك</span>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="card p-5"><h2 className="font-bold mb-4">إضافة مستخدم</h2><NewUserForm /></div>
    </>
  );
}
