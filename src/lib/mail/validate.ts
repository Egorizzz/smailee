import type { MailboxConnState } from "@prisma/client";

/**
 * Валидация ящика (ТЗ §5.1: тест IMAP-логина + тест SMTP-auth).
 *
 * НЕ импортирует "server-only": будет вызываться и из standalone-воркера вне
 * Next-рантайма (движок отправки M2), где react-server-условие не действует.
 *
 * ⚠️ M1 — ЗАГЛУШКА. Реальные IMAP/SMTP-коннекты пока не выполняются (нет живых
 * app-паролей Яндекса и сетевого доступа в текущей среде). Здесь только
 * структурная проверка (формат email, наличие host/port/логина/паролей).
 * Что понадобится для реальной валидации — см. docs/tz/M1-followups.md.
 */

export type MailboxCandidate = {
  email: string;
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
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

/**
 * M1-заглушка: структурная валидация без сети.
 * connState = 'paused' (готов, но реальный auth ещё не проверялся) при полном
 * наборе полей, иначе 'auth_error' с причиной.
 */
export async function validateMailbox(c: MailboxCandidate): Promise<ValidationResult> {
  const problems: string[] = [];
  if (!EMAIL_RE.test(c.email)) problems.push("некорректный email");
  if (!c.smtpHost || !c.smtpPort) problems.push("не задан SMTP host/port");
  if (!c.imapHost || !c.imapPort) problems.push("не задан IMAP host/port");
  if (!c.smtpLogin || !c.smtpPassword) problems.push("нет SMTP-логина/пароля");
  if (!c.imapLogin || !c.imapPassword) problems.push("нет IMAP-логина/пароля");

  if (problems.length > 0) {
    return {
      connState: "auth_error",
      smtpOk: false,
      imapOk: false,
      error: problems.join("; "),
    };
  }

  // TODO(M1-followup): здесь будет реальный тест —
  //   SMTP: nodemailer.createTransport(...).verify()
  //   IMAP: imapflow connect + login
  // Пока структурно ок → 'paused' (не 'ok': реальный auth не подтверждён).
  return {
    connState: "paused",
    smtpOk: true,
    imapOk: true,
    error: "Структурно ок. Реальная проверка логина будет добавлена (нужен app-пароль Яндекса).",
  };
}
