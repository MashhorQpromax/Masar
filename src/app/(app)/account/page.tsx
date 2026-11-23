import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { methodText, ROLE } from "@/copy/auth";
import { dayShort } from "@/copy/format";
import { can } from "@/domain/auth";
import { deviceName } from "@/domain/auth/device";
import { securityState } from "@/server/auth/account";
import { requireActor } from "@/server/auth/actor";
import { currentSession, relyingParty, requestOrigin, SESSION_COOKIE } from "@/server/auth/request";
import { getDb } from "@/server/db/client";
import { BackIcon } from "@/ui/icons";
import { Account, type AccountView } from "./Account";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "حسابي · مسار" };

/** The person's own account: who they are here, how they sign in, and where they are signed in. */
export default async function AccountPage() {
  const me = await requireActor();
  const session = me.demo ? null : await currentSession();
  const { userAgent } = await requestOrigin();
  const now = new Date();
  const office = { users: can(me.role, "user.manage"), audit: can(me.role, "audit.view"), fees: can(me.role, "settings.manage") };

  let view: AccountView;
  if (!session) {
    // A build without a database has no accounts. The page shows what one looks like, and changes nothing.
    view = {
      demo: true,
      name: me.name,
      role: ROLE[me.role],
      email: null,
      entered: "",
      authenticator: false,
      codeStopped: false,
      passkeysOn: false,
      passkeys: [],
      devices: [{ name: deviceName(userAgent), since: dayShort(now), how: "", current: true }],
      office,
    };
  } else {
    const state = await securityState(await getDb(), { userId: session.user.id, sessionToken: (await cookies()).get(SESSION_COOKIE)?.value, now });
    view = {
      demo: false,
      name: session.user.name,
      role: ROLE[session.user.role],
      email: session.user.email,
      entered: methodText(session.method),
      authenticator: state.authenticator,
      codeStopped: state.codeStopped,
      passkeysOn: (await relyingParty()) != null,
      passkeys: state.passkeys.map((key) => ({
        id: key.id,
        name: key.name ?? "جهاز",
        added: dayShort(key.createdAt),
        used: key.lastUsedAt ? dayShort(key.lastUsedAt) : null,
      })),
      devices: state.sessions.map((line) => ({
        name: deviceName(line.userAgent),
        since: dayShort(line.createdAt),
        how: methodText(line.method),
        current: line.current,
      })),
      office,
    };
  }

  return (
    <>
      <header className="head">
        <div>
          <Link className="back" href="/">
            <BackIcon />
            الطريق
          </Link>
          <h1 className="title">حسابي</h1>
          <p className="lede">اختر كيف تدخل إلى مسار، وراجع أين أنت داخل.</p>
        </div>
      </header>
      <Account view={view} />
    </>
  );
}
