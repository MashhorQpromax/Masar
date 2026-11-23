import type { Metadata } from "next";
import Link from "next/link";
import { EMPTY_PROJECT } from "@/domain/project";
import { requireActor } from "@/server/auth/actor";
import { riyadhDay } from "@/server/shared/clock";
import { BackIcon } from "@/ui/icons";
import { ProjectEditor } from "../ProjectEditor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "مشروع جديد · مسار" };

/** Opens a file for a project: a hotel, a residential or a commercial building that asks for finance against its land. */
export default async function NewProjectPage() {
  await requireActor("client.create");
  return (
    <>
      <div className="head">
        <div>
          <Link className="back" href="/clients">
            <BackIcon />
            العملاء
          </Link>
          <h1 className="title">مشروع جديد</h1>
        </div>
      </div>
      <ProjectEditor clientId={null} owner="" requested={null} facts={EMPTY_PROJECT} today={riyadhDay(new Date()).replaceAll("/", "-")} />
    </>
  );
}
