/**
 * Профили почтовых провайдеров (host/port/security) — провайдер-агностичный
 * слой (ТЗ §1.6, §8.1). Ядро (валидация/отправка/приём) работает с абстракцией
 * «ящик с профилем», не завязано на конкретного провайдера.
 *
 * На старте реализован ТОЛЬКО профиль Яндекс 360. Добавление Google/др. =
 * новая запись здесь, без изменений в движках.
 */

import type { MailProvider, MailSecurity } from "@prisma/client";

export type MailProfile = {
  provider: MailProvider;
  label: string;
  smtp: { host: string; port: number; security: MailSecurity };
  imap: { host: string; port: number; security: MailSecurity };
  /** Подсказка по паролю (Яндекс/Google требуют app-пароль, не основной). */
  passwordHint: string;
  /**
   * Пошаговые инструкции под каждый тип пароля. Оба варианта рабочие, но
   * требуют РАЗНЫХ галочек в настройках провайдера — а неверная галочка даёт
   * невнятное "Command failed" на этапе логина, без намёка на причину.
   */
  passwordSetup: {
    app: string[];
    account: string[];
  };
  /** Имя папки "Спам" на IMAP (провайдер/локаль-зависимо, §5.6 spam-rescue). */
  spamFolder: string;
};

// Только Яндекс 360 реализован на старте. Для 'other'/'custom' host/port задаёт
// пользователь вручную (UI), профиль здесь не предопределён.
export const MAIL_PROFILES: Partial<Record<MailProvider, MailProfile>> = {
  yandex: {
    provider: "yandex",
    label: "Яндекс 360",
    smtp: { host: "smtp.yandex.ru", port: 465, security: "SSL" },
    imap: { host: "imap.yandex.ru", port: 993, security: "SSL" },
    passwordHint:
      "Подойдёт пароль приложения или пароль от аккаунта — но под каждый нужна своя настройка в Яндексе (см. инструкцию ниже).",
    passwordSetup: {
      app: [
        "Зайдите в почту через браузер хотя бы раз и примите соглашение — до этого IMAP/SMTP не работают.",
        "Яндекс ID → Безопасность → Пароли приложений → создайте пароль для «Почта».",
        "Настройки почты → «Почтовые программы»: включите IMAP и SMTP.",
        "Вставьте созданный пароль приложения (он показывается один раз).",
      ],
      account: [
        "Зайдите в почту через браузер хотя бы раз и примите соглашение — до этого IMAP/SMTP не работают.",
        "Настройки почты → «Почтовые программы»: включите IMAP и SMTP.",
        "Там же отметьте «Портальный пароль» — без этой галочки IMAP отклонит пароль от аккаунта, даже если SMTP с ним работает.",
        "Для корпоративных ящиков проверьте, что протоколы разрешены и на уровне организации (admin.yandex.ru).",
      ],
    },
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
