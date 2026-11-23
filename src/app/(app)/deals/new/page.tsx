import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { phoneTyped } from "@/copy/clients";
import { can } from "@/domain/auth";
import { defaultDealInput, SECTORS, type Sector } from "@/domain/deal";
import { normalizePhone } from "@/domain/shared/phone";
import { requireActor } from "@/server/auth/actor";
import { getClientCard } from "@/server/clients/directory";
import { getDb } from "@/server/db/client";
import { BackIcon } from "@/ui/icons";
import { DealEditor } from "../DealEditor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "صفقة جديدة · مسار" };

const one = (value: string | string[] | undefined): string => (Array.isArray(value) ? value[0] : value)?.trim() ?? "";

/**
 * A new deal. On its own it opens a file for a new client. With `client` it is a deal for someone who
 * has a file and no deal in progress. With `phone` and `name` it opens a file for someone who wrote to
 * the office first, starting from what WhatsApp says about them.
 */
export default async function NewDealPage({ searchParams }: { searchParams: Promise<{ client?: string | string[]; phone?: string | string[]; name?: string | string[] }> }) {
  const query = await searchParams;
  const clientId = Number(one(query.client)) || null;
  const me = await requireActor(clientId ? "deal.edit" : "client.create");
  const year = new Date().getFullYear();

  if (clientId) {
    const card = await getClientCard(await getDb(), clientId);
    if (!card) notFound();
    const open = card.deals.find((deal) => deal.stage !== "closed" && deal.stage !== "lost");
    if (open) redirect(`/deals/${open.id}`);
    const { client } = card;
    return (
      <>
        <div className="head">
          <div>
            <Link className="back" href={`/clients/${client.id}`}>
              <BackIcon />
              {client.fullName}
            </Link>
            <h1 className="title">صفقة جديدة</h1>
          </div>
        </div>
        <DealEditor
          dealId={null}
          clientId={client.id}
          year={year}
          borrower={{
            fullName: client.fullName,
            birthYear: client.birthYear,
            sector: (SECTORS as readonly string[]).includes(client.sector) ? (client.sector as Sector) : "gov",
            basicSalary: client.basicSalary,
            totalSalary: client.totalSalary,
            serviceMonths: client.serviceMonths,
          }}
          input={{ ...defaultDealInput(), propertyValue: client.propertyValue }}
        />
      </>
    );
  }

  // A number is carried into the form only for those who may see numbers, and only when it is one.
  const phone = can(me.role, "client.view_pii") ? normalizePhone(one(query.phone)) : null;
  return (
    <>
      <div className="head">
        <div>
          <Link className="back" href={phone ? `/inbox/${phone}` : "/deals"}>
            <BackIcon />
            {phone ? "الوارد" : "الصفقات"}
          </Link>
          <h1 className="title">صفقة جديدة</h1>
        </div>
      </div>
      <DealEditor
        dealId={null}
        phone={phoneTyped(phone)}
        year={year}
        borrower={{ fullName: phone ? one(query.name).slice(0, 120) : "", birthYear: null, sector: "gov", basicSalary: null, totalSalary: null, serviceMonths: null }}
        input={defaultDealInput()}
      />
    </>
  );
}
