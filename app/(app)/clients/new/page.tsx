import { requirePage } from "@/lib/auth";
import { products } from "@/lib/data";
import { PageHeader } from "@/components/ui";
import ClientForm from "@/components/client-form";
import { createClient } from "@/app/actions";

export default async function NewClient({ searchParams }: { searchParams: Promise<{ phone?: string; name?: string }> }) {
  const q = await searchParams;
  await requirePage("client.create");
  return (
    <>
      <PageHeader title="فتح ملف عميل جديد" sub="أدخل ما يتوفر من بيانات — الدراسة المبدئية تُحدّث مباشرة على اليسار" back={{ href: "/clients", label: "العملاء" }} />
      <ClientForm action={createClient} products={await products()} isNew initial={{ ...(q.phone ? { phone: q.phone.slice(0, 20) } : {}), ...(q.name ? { full_name: q.name.slice(0, 120) } : {}) }} />
    </>
  );
}
