import type { MailboxConnState, MailSecurity } from "@prisma/client";
import { verifySmtpAuth } from "./transport";
import { verifyImapLogin } from "./imap";

/**
 * Валидация ящика (ТЗ §5.1: тест IMAP-логина + тест SMTP-auth).
 *
 * НЕ импортирует "server-only": вызывается из движка отправки/приёма и из
 * серверных экшенов (подключение ящика) вне зависимости от Next-рантайма.
 *
 * Реально коннектится к SMTP (nodemailer verify) и IMAP (imapflow connect).
 * connState:
 *   - "ok"          — оба логина прошли;
 *   - "auth_error"  — сервер доступен, но логин/пароль отвергнут;
 *   - "unreachable" — не достучались до хоста (порт закрыт/таймаут/DNS);
 *   - "auth_error"  — структурная ошибка (нет обязательных полей).
 * Пароли в открытом виде живут только на момент вызова, в БД не пишутся (§8.2).
 */

export type MailboxCandidate = {
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: MailSecurity;
  imapHost: string;
  imapPort: number;
  imapSecurity: MailSecurity;
  smtpLogin: string;
  imapLogin: string;
  smtpPassword: string; // в открытом виде только на момент валидации, в БД не пишем
  imapPassword: string;
};

export type ValidationResult = {
  connState: MailboxConnState;
  smtpOk: boolean;
  imapOk: boolean;
  error?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Жёсткий барьер поверх таймаутов nodemailer/imapflow: если хост недоступен и
// TCP-connect зависает на уровне ОС (напр. исходящий порт фильтруется), опции
// таймаута библиотек могут не сработать — не даём валидации висеть в UI дольше
// TIMEOUT_MS. Фоновый сокет догорит сам, его finally закроет транспорт.
const TIMEOUT_MS = 12_000;
function withTimeout<T>(p: Promise<T>, onTimeout: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(onTimeout), TIMEOUT_MS)),
  ]);
}

export async function validateMailbox(c: MailboxCandidate): Promise<ValidationResult> {
  // 1. Структурная проверка (без сети) — отсекаем заведомо неполные записи
  const problems: string[] = [];
  if (!EMAIL_RE.test(c.email)) problems.push("некорректный email");
  if (!c.smtpHost || !c.smtpPort) problems.push("не задан SMTP host/port");
  if (!c.imapHost || !c.imapPort) problems.push("не задан IMAP host/port");
  if (!c.smtpLogin || !c.smtpPassword) problems.push("нет SMTP-логина/пароля");
  if (!c.imapLogin || !c.imapPassword) problems.push("нет IMAP-логина/пароля");
  if (problems.length > 0) {
    return { connState: "auth_error", smtpOk: false, imapOk: false, error: problems.join("; ") };
  }

  // 2. Реальные коннекты: SMTP-auth + IMAP-login (параллельно — так быстрее),
  //    каждый под жёстким таймаутом (см. withTimeout)
  const [smtp, imap] = await Promise.all([
    withTimeout(
      verifySmtpAuth(
        { smtpHost: c.smtpHost, smtpPort: c.smtpPort, smtpSecurity: c.smtpSecurity, smtpLogin: c.smtpLogin },
        c.smtpPassword
      ),
      { ok: false, kind: "network", error: "таймаут подключения к SMTP (порт закрыт или хост недоступен)" }
    ),
    withTimeout(
      verifyImapLogin(
        { imapHost: c.imapHost, imapPort: c.imapPort, imapSecurity: c.imapSecurity, imapLogin: c.imapLogin },
        c.imapPassword
      ),
      { ok: false, kind: "network", error: "таймаут подключения к IMAP (порт закрыт или хост недоступен)" }
    ),
  ]);

  if (smtp.ok && imap.ok) {
    return { connState: "ok", smtpOk: true, imapOk: true };
  }

  // сеть недоступна хоть на одном протоколе → "unreachable"; иначе (сервер
  // ответил, но отверг логин) → "auth_error"
  const anyNetwork = smtp.kind === "network" || imap.kind === "network";
  const errParts: string[] = [];
  if (!smtp.ok) errParts.push(`SMTP: ${smtp.error}`);
  if (!imap.ok) errParts.push(`IMAP: ${imap.error}`);
  return {
    connState: anyNetwork ? "unreachable" : "auth_error",
    smtpOk: smtp.ok,
    imapOk: imap.ok,
    error: errParts.join(" · "),
  };
}
