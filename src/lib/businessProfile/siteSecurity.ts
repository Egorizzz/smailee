import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain"]);

export function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(normalized)) return false;
  const [a, b] = normalized.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

export async function validatePublicWebsiteUrl(raw: string) {
  const withProtocol = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error("Укажите корректный адрес сайта");
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error("Разрешены только публичные HTTP/HTTPS-сайты без логина в URL");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname.includes(".") || BLOCKED_HOSTS.has(hostname) || isPrivateAddress(hostname)) {
    throw new Error("Нельзя анализировать локальный или внутренний адрес");
  }
  try {
    const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) {
      throw new Error("Сайт указывает на внутренний или недоступный адрес");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("внутренний")) throw error;
    throw new Error("Не удалось найти публичный адрес сайта");
  }
  url.hostname = hostname;
  url.hash = "";
  url.search = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}

export function canonicalizePageUrl(raw: string) {
  const url = new URL(raw);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|yclid)/i.test(key)) url.searchParams.delete(key);
  }
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export function isUrlInScope(raw: string, rootRaw: string, allowSubdomains: boolean) {
  try {
    const url = new URL(raw);
    const root = new URL(rootRaw);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const sameHost = url.hostname === root.hostname;
    const permittedSubdomain = allowSubdomains && url.hostname.endsWith(`.${root.hostname}`);
    return sameHost || permittedSubdomain;
  } catch {
    return false;
  }
}
