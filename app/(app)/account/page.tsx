import { requireUser, ROLE_LABEL } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import PasswordForm from "@/components/password-form";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const u = await requireUser();
  return (
    <>
      <PageHeader title="حسابي" sub={`${u.name} · ${u.email} · ${ROLE_LABEL[u.role]}`} />
      <div className="card p-6 max-w-md">
        <h3 className="font-bold mb-1">تغيير كلمة المرور</h3>
        <p className="text-sm text-slate-500 mb-4">اختر كلمة مرور سهلة عليك تحفظها (6 خانات أو أكثر).</p>
        <PasswordForm />
      </div>
    </>
  );
}
