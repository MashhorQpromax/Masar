import Link from "next/link";
import type { ReactNode } from "react";
import { ROLE } from "@/copy/auth";
import { dayLong, initial } from "@/copy/format";
import { can } from "@/domain/auth";
import { requireActor } from "@/server/auth/actor";
import { Dock } from "@/ui/Dock";
import { getDb } from "@/server/db/client";
import { waitingCount } from "@/server/messages/inbox";
import { ClientsIcon, DealsIcon, InboxIcon, LeaveIcon, LendersIcon, Mark, PlusIcon, RoadIcon } from "@/ui/icons";
import { signOut } from "../login/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await requireActor();
  // Conversations hold what clients wrote, so they are for those who may see a client's details.
  const mayRead = can(me.role, "client.view_pii");
  const waiting = mayRead ? await waitingCount(await getDb()) : 0;
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
              <Link className="me-who" href="/account" title={me.demo ? "حسابي" : `حسابي · ${ROLE[me.role]}`} aria-label="حسابي">
                <i aria-hidden="true">{initial(me.name)}</i>
                <span>{me.demo ? "حسابي" : me.name}</span>
              </Link>
              <button type="submit" className="me-out" aria-label="خروج">
                <LeaveIcon size={16} />
                <span>خروج</span>
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
          { href: "/clients", label: "العملاء", icon: <ClientsIcon /> },
          ...(mayRead ? [{ href: "/inbox", label: "الوارد", icon: <InboxIcon />, count: waiting }] : []),
          { href: "/lenders", label: "الجهات", icon: <LendersIcon /> },
        ]}
        action={can(me.role, "client.create") ? { href: "/deals/new", label: "صفقة جديدة", icon: <PlusIcon size={22} /> } : undefined}
      />
    </>
  );
}
