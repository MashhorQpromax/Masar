import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SECTORS, type Sector } from "@/domain/deal";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { getDeal } from "@/server/deals/service";
import { BackIcon } from "@/ui/icons";
import { DealEditor } from "../../DealEditor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "تعديل الأرقام · مسار" };

export default async function EditDealPage({ params }: { params: Promise<{ id: string }> }) {
  await requireActor("deal.edit");
  const dealId = Number((await params).id);
  if (!Number.isInteger(dealId) || dealId <= 0) notFound();

  const now = new Date();
  const view = await getDeal(await getDb(), { dealId, now });
  if (!view) notFound();
  const { deal, client, input } = view;
  // The numbers of a finished deal are a record. They are read on the deal's page, not changed.
  if (deal.stage === "closed" || deal.stage === "lost") redirect(`/deals/${dealId}`);

  return (
    <>
      <div className="head">
        <div>
          <Link className="back" href={`/deals/${dealId}`}>
            <BackIcon />
            {client.fullName}
          </Link>
          <h1 className="title">تعديل الأرقام</h1>
        </div>
      </div>
      <DealEditor
        dealId={dealId}
        year={now.getFullYear()}
        borrower={{
          fullName: client.fullName,
          birthYear: client.birthYear,
          sector: (SECTORS as readonly string[]).includes(client.sector) ? (client.sector as Sector) : "gov",
          basicSalary: client.basicSalary,
          totalSalary: client.totalSalary,
          serviceMonths: client.serviceMonths,
        }}
        input={input}
        credit={view.creditFlags}
      />
    </>
  );
}
