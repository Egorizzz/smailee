"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppNavIcon, type AppNavIconName } from "./AppNavIcon";

export type SidebarNavItem = {
  href: string;
  label: string;
  short?: string;
  icon: AppNavIconName;
  group: "work" | "system";
};

/** Пункты меню тёмного сайдбара с цельной стеклянной поверхностью активного раздела. */
export function SidebarNav({ items }: { items: SidebarNavItem[] }) {
  const pathname = usePathname();
  const groups = [
    { key: "work" as const, label: "Работа" },
    { key: "system" as const, label: "Система" },
  ];

  return (
    <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 pt-1 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.12)_transparent]" aria-label="Основная навигация">
      {groups.map((group, groupIndex) => {
        const groupItems = items.filter((item) => item.group === group.key);
        if (groupItems.length === 0) return null;
        return (
          <div key={group.key} className={groupIndex ? "mt-5" : ""}>
            <div className="mb-1.5 px-3 text-[11px] font-medium text-white/34">{group.label}</div>
            <div className="space-y-1">
              {groupItems.map((n) => {
                const active = pathname === n.href || pathname?.startsWith(n.href + "/");
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    className={`group relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-[background-color,color,box-shadow,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400/70 ${
                      active
                        ? "bg-white/[0.09] text-white ring-1 ring-inset ring-white/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_8px_22px_rgba(0,0,0,0.14)] backdrop-blur-md"
                        : "text-white/58 hover:translate-x-0.5 hover:bg-white/[0.055] hover:text-white/90"
                    }`}
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-[background-color,color,box-shadow] ${active ? "bg-white/[0.08] text-mint-300 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]" : "bg-white/[0.045] text-white/45 group-hover:bg-white/[0.08] group-hover:text-white/75"}`}>
                      <AppNavIcon name={n.icon} className="h-[17px] w-[17px]" />
                    </span>
                    <span className="truncate">{n.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
