import Link from "next/link";
import type { ReactNode } from "react";
import { ROLE } from "@/copy/auth";
import { dayLong, initial } from "@/copy/format";
import { can } from "@/domain/auth";
import { requireActor } from "@/server/auth/actor";
import { Dock } from "@/ui/Dock";
import { DealsIcon, LeaveIcon, Mark, PlusIcon, RoadIcon } from "@/ui/icons";
import { signOut } from "../login/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await requireActor();
  return (
    <>
      <div className="page">
        <header className="topbar">
          <Link className="brand" href="/">
            <Mark />
            مسار
            <span className="brand-day">{dayLong(new Date())}</span>
          </Link>
          <div className="topbar-side">
            {me.demo && (
              <p className="chip">
                <i className="chip-dot" aria-hidden="true" />
                بيانات تجريبية
              </p>
            )}
            <form action={signOut} className="me">
              {!me.demo && (
                <span className="me-who" title={ROLE[me.role]}>
                  <i aria-hidden="true">{initial(me.name)}</i>
                  <span>{me.name}</span>
                </span>
              )}
              <button type="submit" className="me-out">
                <LeaveIcon size={16} />
                خروج
              </button>
            </form>
          </div>
        </header>
        <main>{children}</main>
      </div>
      <Dock
        items={[
          { href: "/", label: "اليوم", icon: <RoadIcon /> },
          { href: "/deals", label: "الصفقات", icon: <DealsIcon /> },
        ]}
        action={can(me.role, "client.create") ? { href: "/deals/new", label: "صفقة جديدة", icon: <PlusIcon size={22} /> } : undefined}
      />
    </>
  );
}
