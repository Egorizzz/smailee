export const COOKIE_CONSENT_NAME = "smailee_cookie_consent";
export const COOKIE_CONSENT_VERSION = "2026-08-17";
export const COOKIE_CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
export const COOKIE_CONSENT_EVENT = "smailee:cookie-consent";
export const OPEN_COOKIE_SETTINGS_EVENT = "smailee:open-cookie-settings";

export type CookieConsent = {
  version: string;
  necessary: true;
  analytics: boolean;
  decidedAt: string;
};

function cookieValue(cookieString: string, name: string) {
  const prefix = `${name}=`;
  return cookieString
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}

export function parseCookieConsent(cookieString: string): CookieConsent | null {
  const raw = cookieValue(cookieString, COOKIE_CONSENT_NAME);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<CookieConsent>;
    if (
      parsed.version !== COOKIE_CONSENT_VERSION ||
      parsed.necessary !== true ||
      typeof parsed.analytics !== "boolean" ||
      typeof parsed.decidedAt !== "string" ||
      Number.isNaN(Date.parse(parsed.decidedAt))
    ) {
      return null;
    }
    return parsed as CookieConsent;
  } catch {
    return null;
  }
}

export function createCookieConsent(analytics: boolean, now = new Date()): CookieConsent {
  return {
    version: COOKIE_CONSENT_VERSION,
    necessary: true,
    analytics,
    decidedAt: now.toISOString(),
  };
}

export function serializeCookieConsent(consent: CookieConsent, secure: boolean) {
  const parts = [
    `${COOKIE_CONSENT_NAME}=${encodeURIComponent(JSON.stringify(consent))}`,
    `Max-Age=${COOKIE_CONSENT_MAX_AGE_SECONDS}`,
    "Path=/",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function readCookieConsent() {
  if (typeof document === "undefined") return null;
  return parseCookieConsent(document.cookie);
}

export function hasAnalyticsConsent() {
  return readCookieConsent()?.analytics === true;
}

export function saveCookieConsent(analytics: boolean) {
  if (typeof document === "undefined") return null;
  const consent = createCookieConsent(analytics);
  document.cookie = serializeCookieConsent(consent, window.location.protocol === "https:");
  window.dispatchEvent(new CustomEvent<CookieConsent>(COOKIE_CONSENT_EVENT, { detail: consent }));
  if (!analytics) clearKnownAnalyticsStorage();
  return consent;
}

export function clearKnownAnalyticsStorage() {
  if (typeof document === "undefined") return;

  const cookieNames = document.cookie
    .split(";")
    .map((part) => part.trim().split("=")[0])
    .filter((name) => name && (name.startsWith("_ym_") || name === "yandexuid" || name === "yuidss"));

  for (const name of cookieNames) {
    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
  }

  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith("_ym")) localStorage.removeItem(key);
    }
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith("_ym")) sessionStorage.removeItem(key);
    }
  } catch {
    // Браузер может запрещать доступ к storage; сам отказ всё равно сохранён в cookie.
  }
}
