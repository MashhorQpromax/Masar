import Link from "next/link";
import type { ReactNode } from "react";
import { dayLong } from "@/copy/format";
import { requireActor } from "@/server/auth/actor";
import { dataMode } from "@/server/db/client";
import { Dock } from "@/ui/Dock";
import { DealsIcon, Mark, RoadIcon } from "@/ui/icons";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireActor();
  const demo = dataMode() === "demo";
  return (
    <>
      <div className="page">
        <header className="topbar">
          <Link className="brand" href="/">
            <Mark />
            مسار
            <span className="brand-day">{dayLong(new Date())}</span>
          </Link>
          {demo && (
            <p className="chip">
              <i className="chip-dot" aria-hidden="true" />
              بيانات تجريبية
            </p>
          )}
        </header>
        <main>{children}</main>
      </div>
      <Dock
        items={[
          { href: "/", label: "اليوم", icon: <RoadIcon /> },
          { href: "/deals", label: "الصفقات", icon: <DealsIcon /> },
        ]}
      />
    </>
  );
}
