"use client";

import { useEffect, useState } from "react";
import { headerCopy } from "@/content/landing/header";

const landingCopy = { header: headerCopy };

/**
 * Бургер-меню шапки лендинга для телефонов.
 *
 * До него навигация на мобильных просто пропадала (`hidden md:flex`) — разделы
 * страницы были доступны только прокруткой вслепую.
 */
export function MobileMenu({ items }: { items: ReadonlyArray<{ href: string; label: string }> }) {
  const [open, setOpen] = useState(false);

  // закрытие по Esc — меню перекрывает контент, из него нужен быстрый выход
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? landingCopy.header.closeMenu : landingCopy.header.openMenu}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white/70 text-[color:var(--foreground)] transition hover:bg-white"
      >
        <span aria-hidden className="text-lg leading-none">
          {open ? "✕" : "☰"}
        </span>
      </button>

      {open && (
        <div
          id="mobile-menu"
          className="absolute inset-x-0 top-[4.25rem] mx-3 overflow-hidden rounded-[1.25rem] border border-white/70 bg-white/94 shadow-[0_18px_44px_rgba(4,38,31,0.18)] backdrop-blur-xl"
        >
          <nav className="mx-auto flex max-w-6xl flex-col px-5 py-2">
            {items.map((n) => (
              <a
                key={n.href}
                href={n.href}
                onClick={() => setOpen(false)}
                className="border-b border-line px-2 py-3.5 text-sm font-medium text-ink-700 transition hover:text-dark-deep last:border-0"
              >
                {n.label}
              </a>
            ))}
            <a
              href="/login"
              onClick={() => setOpen(false)}
              className="px-2 py-3.5 text-sm font-medium text-ink-500 transition hover:text-dark-deep sm:hidden"
            >
              {landingCopy.header.login}
            </a>
          </nav>
        </div>
      )}
    </div>
  );
}
