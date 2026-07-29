"use client";

import { useEffect, useState } from "react";

/**
 * Бургер-меню шапки лендинга для телефонов.
 *
 * До него навигация на мобильных просто пропадала (`hidden md:flex`) — разделы
 * страницы были доступны только прокруткой вслепую.
 */
export function MobileMenu({ items }: { items: { href: string; label: string }[] }) {
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
        aria-label={open ? "Закрыть меню" : "Открыть меню"}
        className="flex h-10 w-10 items-center justify-center rounded-lg border border-line text-[color:var(--foreground)]"
      >
        <span aria-hidden className="text-lg leading-none">
          {open ? "✕" : "☰"}
        </span>
      </button>

      {open && (
        <div
          id="mobile-menu"
          className="absolute inset-x-0 top-16 border-b border-line bg-[color:var(--background)] shadow-sm"
        >
          <nav className="mx-auto flex max-w-6xl flex-col px-5 py-2">
            {items.map((n) => (
              <a
                key={n.href}
                href={n.href}
                onClick={() => setOpen(false)}
                className="border-b border-line py-3 text-sm text-ink-700 last:border-0"
              >
                {n.label}
              </a>
            ))}
          </nav>
        </div>
      )}
    </div>
  );
}
