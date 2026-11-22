"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export interface DockItem {
  href: string;
  label: string;
  icon: ReactNode;
}

/** The floating navigation. The current section is the white pill. */
export function Dock({ items }: { items: DockItem[] }) {
  const pathname = usePathname();
  const current = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <nav className="dock" aria-label="الأقسام">
      {items.map((item) => (
        <Link key={item.href} href={item.href} aria-current={current(item.href) ? "page" : undefined}>
          {item.icon}
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
