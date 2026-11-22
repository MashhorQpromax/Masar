import type { Metadata } from "next";
import Link from "next/link";
import { defaultDealInput } from "@/domain/deal";
import { requireActor } from "@/server/auth/actor";
import { BackIcon } from "@/ui/icons";
import { DealEditor } from "../DealEditor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "صفقة جديدة · مسار" };

export default async function NewDealPage() {
  await requireActor("client.create");
  return (
    <>
      <div className="head">
        <div>
          <Link className="back" href="/deals">
            <BackIcon />
            الصفقات
          </Link>
          <h1 className="title">صفقة جديدة</h1>
        </div>
      </div>
      <DealEditor
        dealId={null}
        year={new Date().getFullYear()}
        borrower={{ fullName: "", birthYear: null, sector: "gov", basicSalary: null, totalSalary: null, serviceMonths: null }}
        input={defaultDealInput()}
      />
    </>
  );
}
