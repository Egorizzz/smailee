"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  OPEN_COOKIE_SETTINGS_EVENT,
  readCookieConsent,
  saveCookieConsent,
} from "@/lib/cookieConsent";

type View = "hidden" | "banner" | "settings";

function CategorySwitch({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="Разрешить аналитические cookies"
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a8059]/35 focus-visible:ring-offset-2 ${
        checked ? "border-[#0a8059] bg-[#0a8059]" : "border-[#cfd7d2] bg-[#e9eeeb]"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-6" : "translate-x-0.5"}`}
      />
    </button>
  );
}

export function CookieConsent() {
  const [view, setView] = useState<View>("hidden");
  const [analytics, setAnalytics] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const consent = readCookieConsent();
    setAnalytics(consent?.analytics ?? false);
    setView(consent ? "hidden" : "banner");

    const openSettings = () => {
      setAnalytics(readCookieConsent()?.analytics ?? false);
      setView("settings");
    };
    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, openSettings);
    return () => window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, openSettings);
  }, []);

  useEffect(() => {
    if (view !== "settings") return;
    closeButtonRef.current?.focus({ preventScroll: true });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setView(readCookieConsent() ? "hidden" : "banner");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [view]);

  function decide(nextAnalytics: boolean) {
    saveCookieConsent(nextAnalytics);
    setAnalytics(nextAnalytics);
    setView("hidden");
  }

  if (view === "hidden") return null;

  return (
    <>
      {view === "banner" && (
        <aside
          aria-label="Настройки cookies"
          className="fixed inset-x-3 bottom-3 z-[120] mx-auto max-w-[1120px] rounded-[20px] border border-black/10 bg-white p-4 text-[#10231d] shadow-[0_24px_70px_rgba(6,27,21,0.18)] sm:inset-x-5 sm:bottom-5 sm:p-5"
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-8">
            <div>
              <h2 className="font-display text-lg font-semibold tracking-[-0.02em]">Cookies — только по вашему выбору</h2>
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[#68736e]">
                Необходимые нужны для входа и безопасности. Аналитика выключена, пока вы её не разрешите. {" "}
                <Link href="/cookies" className="font-medium text-[#0a6a4c] underline decoration-[#0a6a4c]/30 underline-offset-2 hover:decoration-[#0a6a4c]">
                  Подробнее
                </Link>
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[520px]">
              <button type="button" onClick={() => decide(true)} className="rounded-xl bg-[#0a6a4c] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#085a41] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a6a4c]/35 focus-visible:ring-offset-2">
                Принять все
              </button>
              <button type="button" onClick={() => decide(false)} className="rounded-xl border border-black/12 bg-[#f7f8f5] px-4 py-3 text-sm font-semibold text-[#10231d] transition hover:bg-[#eef2ee] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a6a4c]/25 focus-visible:ring-offset-2">
                Только необходимые
              </button>
              <button type="button" onClick={() => setView("settings")} className="rounded-xl border border-black/12 bg-white px-4 py-3 text-sm font-semibold text-[#10231d] transition hover:bg-[#f7f8f5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a6a4c]/25 focus-visible:ring-offset-2">
                Настроить
              </button>
            </div>
          </div>
        </aside>
      )}

      {view === "settings" && (
        <div
          className="fixed inset-0 z-[130] flex items-end justify-center bg-[#061713]/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-5"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setView(readCookieConsent() ? "hidden" : "banner");
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="cookie-settings-title"
            className="max-h-[92vh] w-full overflow-y-auto rounded-t-[24px] border border-black/10 bg-white text-[#10231d] shadow-[0_32px_100px_rgba(6,27,21,0.3)] sm:max-w-xl sm:rounded-[24px]"
          >
            <header className="flex items-start justify-between gap-5 border-b border-black/10 px-5 py-5 sm:px-7 sm:py-6">
              <div>
                <h2 id="cookie-settings-title" className="font-display text-2xl font-semibold tracking-[-0.03em]">Настройки cookies</h2>
                <p className="mt-1.5 text-sm leading-6 text-[#68736e]">Выбор можно изменить в любой момент.</p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Закрыть настройки cookies"
                onClick={() => setView(readCookieConsent() ? "hidden" : "banner")}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/10 text-xl text-[#68736e] transition hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a6a4c]/30"
              >
                ×
              </button>
            </header>

            <div className="space-y-3 px-5 py-5 sm:px-7">
              <div className="rounded-2xl border border-black/10 bg-[#f7f8f5] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold">Необходимые</h3>
                    <p className="mt-1 text-sm leading-5 text-[#68736e]">Вход в кабинет, безопасность и сохранение этого выбора.</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-[#dff3e9] px-3 py-1 text-xs font-semibold text-[#0a6a4c]">Всегда включены</span>
                </div>
              </div>

              <div className="rounded-2xl border border-black/10 bg-white p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold">Аналитика</h3>
                    <p className="mt-1 text-sm leading-5 text-[#68736e]">Поможет улучшать страницы по обезличенной статистике посещений. Сейчас счётчик ещё не подключён.</p>
                  </div>
                  <CategorySwitch checked={analytics} onChange={setAnalytics} />
                </div>
              </div>

              <p className="px-1 text-xs leading-5 text-[#7d8782]">
                Состав и сроки описаны в <Link href="/cookies" className="underline underline-offset-2 hover:text-[#10231d]">Политике cookie</Link>. Обработка данных — в <Link href="/privacy" className="underline underline-offset-2 hover:text-[#10231d]">Политике персональных данных</Link>.
              </p>
            </div>

            <footer className="grid gap-2 border-t border-black/10 px-5 py-5 sm:grid-cols-[1fr_auto] sm:px-7">
              <button type="button" onClick={() => decide(false)} className="rounded-xl border border-black/12 bg-[#f7f8f5] px-4 py-3 text-sm font-semibold transition hover:bg-[#eef2ee] sm:justify-self-start">
                Только необходимые
              </button>
              <button type="button" onClick={() => decide(analytics)} className="rounded-xl bg-[#0a6a4c] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#085a41]">
                Сохранить выбор
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
