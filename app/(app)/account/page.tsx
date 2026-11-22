import { requireUser, hasSudo, ROLE_LABEL } from "@/lib/auth";
import { securityState } from "@/lib/auth-methods";
import { Fold, PageHeader } from "@/components/ui";
import PasswordForm from "@/components/password-form";
import SecurityPanel from "@/components/security-panel";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const u = await requireUser();
  const [state, unlocked] = await Promise.all([securityState(u.id), hasSudo(u)]);
  return (
    <div className="max-w-2xl">
      <PageHeader title="حسابي والأمان" sub={<>{u.name} · <span dir="ltr">{u.email}</span> · {ROLE_LABEL[u.role]}</>} />
      <div className="space-y-4">
        <SecurityPanel state={state} unlocked={unlocked} />
        <Fold title="كلمة المرور" icon="key"><div className="max-w-md"><PasswordForm /></div></Fold>
      </div>
    </div>
  );
}
