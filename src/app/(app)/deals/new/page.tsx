import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { phoneTyped } from "@/copy/clients";
import { can } from "@/domain/auth";
import { creditFlags, defaultDealInput, policyFee, SECTORS, type Sector } from "@/domain/deal";
import { contractOf } from "@/domain/eligibility";
import { normalizePhone } from "@/domain/shared/phone";
import { requireActor } from "@/server/auth/actor";
import { getClientCard } from "@/server/clients/directory";
import { latestCredit } from "@/server/credit/service";
import { getDb } from "@/server/db/client";
import { feePolicy } from "@/server/settings/fees";
import { BackIcon } from "@/ui/icons";
import { DealEditor } from "../DealEditor";
import { reportOffer } from "../report-offer";

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
  const db = await getDb();
  // A new deal starts from the office's fee policy as it stands today.
  const policy = await feePolicy(db);
  const fee = { policy, may: can(me.role, "fee.set") };
  const start = { ...defaultDealInput(), fee: policyFee(policy) };

  if (clientId) {
    const card = await getClientCard(db, clientId);
    if (!card) notFound();
    const open = card.deals.find((deal) => deal.stage !== "closed" && deal.stage !== "lost");
    if (open) redirect(`/deals/${open.id}`);
    const { client } = card;
    // A new deal for someone whose record was read is noted by that record, and starts from what it shows.
    const record = await latestCredit(db, client.id);
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
            contractType: contractOf(client.contractType),
          }}
          input={{ ...start, propertyValue: client.propertyValue }}
          fee={fee}
          credit={record ? creditFlags(record.report, record.analysis) : null}
          // The record's own lines are for those who may read the record.
          fromReport={record && can(me.role, "client.view_pii") ? reportOffer(record.report) : null}
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
        borrower={{ fullName: phone ? one(query.name).slice(0, 120) : "", birthYear: null, sector: "gov", basicSalary: null, totalSalary: null, serviceMonths: null, contractType: null }}
        input={start}
        fee={fee}
      />
    </>
  );
}
