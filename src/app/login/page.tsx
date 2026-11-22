import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentSession, relyingParty } from "@/server/auth/request";
import { dataMode } from "@/server/db/client";
import { Mark } from "@/ui/icons";
import { LoginArt } from "./LoginArt";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "الدخول · مسار" };

export default async function LoginPage() {
  const demo = dataMode() === "demo";
  if (!demo && (await currentSession())) redirect("/");
  return (
    <div className="login">
      <main className="login-side">
        <header className="login-top">
          <span className="brand">
            <Mark />
            مسار
          </span>
          {demo && (
            <p className="chip">
              <i className="chip-dot" aria-hidden="true" />
              بيانات تجريبية
            </p>
          )}
        </header>
        <LoginArt as="band" />
        <div className="login-body">
          <LoginForm demo={demo} passkeys={!demo && (await relyingParty()) != null} />
        </div>
        <p className="login-foot">كل دخول يُسجَّل لحماية بيانات العملاء.</p>
      </main>
      <LoginArt as="card" />
    </div>
  );
}
