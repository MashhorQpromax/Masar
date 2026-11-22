import type { Metadata } from "next";
import Link from "next/link";
import { ROLE } from "@/copy/auth";
import { requireActor } from "@/server/auth/actor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "لا صلاحية · مسار" };

/** Where a person lands when their role does not cover what they asked for. Nothing was changed. */
export default async function DeniedPage() {
  const me = await requireActor();
  return (
    <div className="empty mt-8">
      <h1 className="text-3xl font-bold">هذه الصفحة خارج صلاحيتك</h1>
      <p className="text-body">حسابك بدور «{ROLE[me.role]}». اطلب من مدير النظام توسيع الصلاحية إن احتجتها.</p>
      <Link className="btn btn--navy mt-2" href="/">
        إلى الطريق
      </Link>
    </div>
  );
}
