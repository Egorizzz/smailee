"use client";

import { OPEN_COOKIE_SETTINGS_EVENT } from "@/lib/cookieConsent";

export function CookieSettingsButton({ className = "" }: { className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new Event(OPEN_COOKIE_SETTINGS_EVENT))}
    >
      Настройки cookies
    </button>
  );
}
