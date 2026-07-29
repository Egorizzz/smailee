"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Нижняя таб-панель кабинета для телефонов.
 *
 * До неё на мобильных экранах навигации не было вообще: сайдбар скрыт
 * (`hidden md:flex`), а в верхней панели только логотип и «Выйти» — между
 * разделами было не перейти. Пять разделов — ровно тот случай, когда таб-бар
 * лучше бургер-меню: не прячет переходы за лишний тап и попадает под большой палец.
 */
export function MobileNav({
  items,
}: {
  items: { href: string; label: string; short?: string; icon: string }[];
}) {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-dark-bg md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Основная навигация"
    >
      <ul className="grid grid-cols-5">
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
                <span aria-hidden className="text-base leading-none">
                  {n.icon}
                </span>
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
