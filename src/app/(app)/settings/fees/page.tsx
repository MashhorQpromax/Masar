import type { Metadata } from "next";
import Link from "next/link";
import { policyText } from "@/copy/fees";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { feePolicy } from "@/server/settings/fees";
import { BackIcon } from "@/ui/icons";
import { PolicyForm } from "./PolicyForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "سياسة الأتعاب · مسار" };

/**
 * The office's fee policy, the manager's alone. A new deal starts from it; a saved deal keeps its own
 * fee, and changing that fee asks for the right and a reason. Every change is in the audit log.
 */
export default async function FeePolicyPage() {
  await requireActor("settings.manage");
  const policy = await feePolicy(await getDb());
  return (
    <>
      <header className="head">
        <div>
          <Link className="back" href="/account">
            <BackIcon />
            حسابي
          </Link>
          <h1 className="title">سياسة الأتعاب</h1>
          <p className="lede">{policyText(policy)}</p>
        </div>
      </header>
      <PolicyForm policy={policy} />
    </>
  );
}
