"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Пункты меню тёмного сайдбара с изумрудным индикатором активного раздела. */
export function SidebarNav({ items }: { items: { href: string; label: string; icon: string }[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex-1 space-y-0.5 px-3 py-2">
      {items.map((n) => {
        const active = pathname === n.href || pathname?.startsWith(n.href + "/");
        return (
          <Link
            key={n.href}
            href={n.href}
            className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
              active ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white/90"
            }`}
          >
            {active && (
              <span className="absolute -left-3 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-mint-500" />
            )}
            <span className="w-4 text-center">{n.icon}</span>
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
