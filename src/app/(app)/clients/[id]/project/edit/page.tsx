import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { getProject } from "@/server/projects/service";
import { riyadhDay } from "@/server/shared/clock";
import { BackIcon } from "@/ui/icons";
import { ProjectEditor } from "../../../../projects/ProjectEditor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "تعديل المشروع · مسار" };

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireActor("client.edit");
  const clientId = Number((await params).id);
  if (!Number.isInteger(clientId) || clientId <= 0) notFound();
  const view = await getProject(await getDb(), clientId);
  if (!view) notFound();
  return (
    <>
      <div className="head">
        <div>
          <Link className="back" href={`/clients/${clientId}/project`}>
            <BackIcon />
            دراسة المشروع
          </Link>
          <h1 className="title">تعديل المشروع</h1>
        </div>
      </div>
      <ProjectEditor clientId={clientId} owner={view.client.fullName} requested={view.requested || null} facts={view.facts} today={riyadhDay(new Date()).replaceAll("/", "-")} />
    </>
  );
}
