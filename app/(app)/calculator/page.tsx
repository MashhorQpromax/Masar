import { requireUser } from "@/lib/auth";
import { products } from "@/lib/data";
import { PageHeader } from "@/components/ui";
import Calculator from "@/components/calculator";

export default async function CalcPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="الحاسبة السريعة" sub="للرد على العميل في المكالمة الأولى — لا تحفظ أي بيانات" />
      <Calculator products={await products()} />
    </>
  );
}
