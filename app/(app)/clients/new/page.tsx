import { requirePage } from "@/lib/auth";
import { products } from "@/lib/data";
import { PageHeader } from "@/components/ui";
import ClientForm from "@/components/client-form";
import { createClient } from "@/app/actions";

export default async function NewClient() {
  await requirePage("client.create");
  return (
    <>
      <PageHeader title="فتح ملف عميل جديد" sub="أدخل ما يتوفر من بيانات — الدراسة المبدئية تُحدّث مباشرة على اليسار" back={{ href: "/clients", label: "العملاء" }} />
      <ClientForm action={createClient} products={await products()} isNew />
    </>
  );
}
