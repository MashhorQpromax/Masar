import type { Metadata } from "next";
import Link from "next/link";
import { ROLE } from "@/copy/auth";
import { phoneTyped } from "@/copy/clients";
import { accountsText, lastSeenText, ROLE_SAY, signedInText, standingOf, standingText, waysText } from "@/copy/users";
import { ROLES } from "@/domain/auth";
import { requireActor } from "@/server/auth/actor";
import { listUsers } from "@/server/auth/users";
import { getDb } from "@/server/db/client";
import { BackIcon } from "@/ui/icons";
import { Users, type RoleView, type UserView } from "./Users";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "الحسابات · مسار" };

/** Everyone who may enter the office's system: what each may do, how they come in, and whether they still can. */
export default async function UsersPage() {
  const me = await requireActor("user.manage");
  const now = new Date();
  const people = await listUsers(await getDb(), now);

  const views: UserView[] = people.map((person) => ({
    id: person.id,
    name: person.name,
    email: person.email,
    role: person.role,
    standing: standingOf(person),
    standingSay: standingText(person),
    ways: waysText(person),
    hasWays: person.authenticator || person.passkeys > 0,
    seen: lastSeenText(person.lastLoginAt, now),
    inNow: signedInText(person.sessions),
    phone: phoneTyped(person.phone),
    me: person.id === me.userId,
  }));
  // A role counts the people who can use it: a stopped account holds a role and can do nothing with it.
  const roles: RoleView[] = ROLES.map((role) => ({ role, name: ROLE[role], say: ROLE_SAY[role], people: people.filter((person) => person.active && person.role === role).length }));

  return (
    <>
      <header className="head">
        <div>
          <Link className="back" href="/account">
            <BackIcon />
            حسابي
          </Link>
          <h1 className="title">الحسابات</h1>
          <p className="lede">{accountsText(people.length, people.filter((person) => !person.active).length)}</p>
        </div>
      </header>
      <Users people={views} roles={roles} />
    </>
  );
}
