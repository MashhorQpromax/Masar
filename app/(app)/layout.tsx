import Link from "next/link";
import { requireUser, ROLE_LABEL, can } from "@/lib/auth";
import { all, get } from "@/lib/db";
import { Logo } from "@/components/logo";
import { SideNav, MobileTabs, SearchButton, UserMenu, CommandPalette, type NavItem, type PaletteAction } from "@/components/shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  const [clients, waiting] = await Promise.all([
    all<{ id: number; name: string; no: string }>("SELECT id, full_name name, file_no no FROM clients ORDER BY updated_at DESC LIMIT 400"),
    get<{ n: number }>("SELECT COUNT(*) n FROM wa_messages m WHERE m.id IN (SELECT MAX(id) FROM wa_messages GROUP BY phone) AND m.direction = 'in'"),
  ]);
  const nav: NavItem[] = [
    { href: "/", label: "الرئيسية", icon: "home" },
    { href: "/clients", label: "العملاء", icon: "users" },
    { href: "/deals", label: "الصفقات", icon: "bridge" },
    { href: "/inbox", label: "المحادثات", icon: "chat", badge: Number(waiting?.n ?? 0) },
    { href: "/lenders", label: "الجهات", icon: "bank", match: ["/knowledge"] },
  ];
  const menu: PaletteAction[] = [
    { href: "/account", label: "حسابي والأمان", icon: "shield" },
    { href: "/calculator", label: "الحاسبة السريعة", icon: "calc" },
    ...(can(u, "user.manage") ? [{ href: "/users", label: "المستخدمون", icon: "users" }] : []),
    ...(can(u, "audit.view") ? [{ href: "/audit", label: "سجل التدقيق", icon: "list" }] : []),
  ];
  const actions: PaletteAction[] = [
    ...(can(u, "client.create") ? [{ href: "/clients/new", label: "عميل جديد", icon: "plus", keys: "new اضافه" }] : []),
    ...nav.map((n) => ({ href: n.href, label: n.label, icon: n.icon })),
    { href: "/knowledge", label: "خبرة الجهات", icon: "bulb" },
    ...menu,
  ];
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
      <aside className="no-print hidden lg:flex sticky top-0 h-dvh flex-col gap-4 px-3 pt-5 pb-3">
        <Link href="/" className="px-2"><Logo /></Link>
        <SearchButton />
        <SideNav items={nav} />
        <div className="mt-auto"><UserMenu name={u.name} role={ROLE_LABEL[u.role]} items={menu} /></div>
      </aside>
      <div className="min-w-0 lg:py-2.5 lg:pe-2.5">
        <header className="no-print lg:hidden sticky top-0 z-30 flex items-center gap-1 h-14 px-3 bg-canvas/90 backdrop-blur border-b border-slate-200/70">
          <Link href="/" className="me-auto ps-1"><Logo compact /></Link>
          <SearchButton compact />
          <UserMenu name={u.name} role={ROLE_LABEL[u.role]} items={menu} compact />
        </header>
        <main className="sheet lg:min-h-[calc(100dvh-1.25rem)] px-4 sm:px-6 lg:px-10 pt-6 lg:pt-9 pb-28 lg:pb-12">
          <div className="mx-auto w-full max-w-[1180px]">{children}</div>
        </main>
      </div>
      <MobileTabs items={nav} />
      <CommandPalette clients={clients} actions={actions} />
    </div>
  );
}
