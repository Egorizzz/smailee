/**
 * Профили почтовых провайдеров (host/port/security) — провайдер-агностичный
 * слой (ТЗ §1.6, §8.1). Ядро (валидация/отправка/приём) работает с абстракцией
 * «ящик с профилем», не завязано на конкретного провайдера.
 *
 * Добавление провайдера сводится к новой записи здесь: движки работают с
 * сохранёнными host/port/security и не ветвятся по названию сервиса.
 */

import type { MailProvider, MailSecurity } from "@prisma/client";

export type MailProfile = {
  provider: MailProvider;
  label: string;
  smtp: { host: string; port: number; security: MailSecurity };
  imap: { host: string; port: number; security: MailSecurity };
  /** Подсказка по паролю приложения. */
  passwordHint: string;
  /** Имя папки "Спам" на IMAP (провайдер/локаль-зависимо, §5.6 spam-rescue). */
  spamFolder: string;
};

export const MAIL_PROFILES: Partial<Record<MailProvider, MailProfile>> = {
  yandex: {
    provider: "yandex",
    label: "Яндекс Почта",
    smtp: { host: "smtp.yandex.ru", port: 465, security: "SSL" },
    imap: { host: "imap.yandex.ru", port: 993, security: "SSL" },
    passwordHint:
      "Используйте пароль приложения для «Почты», а не обычный пароль от Яндекс ID.",
    spamFolder: "Спам",
  },
  google: {
    provider: "google",
    label: "Gmail / Google Workspace",
    smtp: { host: "smtp.gmail.com", port: 465, security: "SSL" },
    imap: { host: "imap.gmail.com", port: 993, security: "SSL" },
    passwordHint:
      "Используйте 16-значный пароль приложения Google. Для его создания должна быть включена двухэтапная аутентификация.",
    spamFolder: "[Gmail]/Spam",
  },
  mailru: {
    provider: "mailru",
    label: "Почта Mail",
    smtp: { host: "smtp.mail.ru", port: 465, security: "SSL" },
    imap: { host: "imap.mail.ru", port: 993, security: "SSL" },
    passwordHint:
      "Используйте пароль для внешнего приложения с полным доступом к Почте, а не обычный пароль от ящика.",
    spamFolder: "Спам",
  },
};

export function getProfile(provider: MailProvider): MailProfile | null {
  return MAIL_PROFILES[provider] ?? null;
}

/** Список провайдеров, у которых есть готовый профиль (для селектора в UI). */
export function supportedProviders(): MailProfile[] {
  return Object.values(MAIL_PROFILES).filter(Boolean) as MailProfile[];
}
