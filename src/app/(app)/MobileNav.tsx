"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppNavIcon } from "./AppNavIcon";
import type { SidebarNavItem } from "./SidebarNav";

/**
 * Нижняя таб-панель кабинета для телефонов.
 *
 * До неё на мобильных экранах навигации не было вообще: сайдбар скрыт
 * (`hidden md:flex`), а в верхней панели только логотип и «Выйти» — между
 * разделами было не перейти. Таб-бар не прячет переходы за лишний тап и
 * попадает под большой палец.
 */
export function MobileNav({
  items,
}: {
  items: SidebarNavItem[];
}) {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-dark-bg md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Основная навигация"
    >
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((n) => {
          const active = pathname === n.href || pathname?.startsWith(n.href + "/");
          return (
            <li key={n.href}>
              <Link
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 transition ${
                  active ? "text-white" : "text-white/55"
                }`}
              >
                <AppNavIcon name={n.icon} className="h-[18px] w-[18px]" />
                {/* короткая подпись, если задана: полная не влезает в ячейку
                    ~75px и обрезалась многоточием */}
                <span className="w-full truncate text-center text-[10px] leading-tight">
                  {n.short ?? n.label}
                </span>
                {active && (
                  <span className="absolute bottom-0 h-0.5 w-8 rounded-full bg-mint-500" />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
