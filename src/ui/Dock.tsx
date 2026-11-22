"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export interface DockItem {
  href: string;
  label: string;
  icon: ReactNode;
}

/** Pages where a person is filling a form. The dock steps aside so the form's own bar has the bottom of the screen. */
const FOCUSED = /^\/deals\/(new|\d+\/edit)$/;

/**
 * The floating navigation. The current section is the white pill, and the action a person
 * comes for most often sits at the end in coral.
 */
export function Dock({ items, action }: { items: DockItem[]; action?: DockItem }) {
  const pathname = usePathname();
  if (FOCUSED.test(pathname)) return null;
  const current = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <nav className="dock" aria-label="الأقسام">
      {items.map((item) => (
        <Link key={item.href} href={item.href} aria-current={current(item.href) ? "page" : undefined}>
          {item.icon}
          <span>{item.label}</span>
        </Link>
      ))}
      {action && (
        <Link className="dock-action" href={action.href} aria-label={action.label} title={action.label}>
          {action.icon}
          <span>{action.label}</span>
        </Link>
      )}
    </nav>
  );
}
