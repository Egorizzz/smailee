import { TRIGGA_RULES } from "@/lib/mail/triggaRules";

/**
 * Централизованная конфигурация (единая точка чтения env).
 * Все модули берут настройки отсюда — не разрозненно из process.env.
 * Это упрощает поддержку: видно все переменные окружения проекта в одном месте.
 */

export const config = {
  /** Публичный URL приложения (трекинг, отписки, ссылки в письмах) */
  appUrl: process.env.APP_URL ?? "http://localhost:3000",

  /** Системная почта Smailee: доступы, сброс пароля и продуктовые уведомления. */
  systemMail: {
    host: process.env.SYSTEM_SMTP_HOST || null,
    port: Number(process.env.SYSTEM_SMTP_PORT ?? 465),
    secure: (process.env.SYSTEM_SMTP_SECURE ?? "true") !== "false",
    user: process.env.SYSTEM_SMTP_USER || null,
    password: process.env.SYSTEM_SMTP_PASSWORD || null,
    from: process.env.SYSTEM_MAIL_FROM || null,
    infoFrom: process.env.SYSTEM_INFO_MAIL_FROM || "Smailee <info@smailee.ru>",
  },

  /** Отправка: троттлинг и размер батча (используется движком отправки M2) */
  send: {
    throttleMs: Number(process.env.SEND_THROTTLE_MS ?? 300),
    batchSize: Number(process.env.SEND_BATCH_SIZE ?? 50),
  },

  /** Воркер: период опроса */
  workerPollMs: Number(process.env.WORKER_POLL_MS ?? 5000),

  /**
   * Минимальный интервал между IMAP-опросами ОДНОГО ящика (§5.4, M3). Тик
   * воркера чаще (см. workerPollMs), но конкретный ящик троттлится через
   * Mailbox.lastCheckedAt — не долбим IMAP-сервер на каждый тик.
   */
  inboundPollMs: Number(process.env.INBOUND_POLL_MS ?? 60_000),

  /** Секрет вебхука платёжного шлюза (-> /api/payments/webhook) */
  paymentSecret: process.env.PAYMENT_WEBHOOK_SECRET || null,

  /** Один общий Telegram-бот для привязки кабинетов и уведомлений о лидах. */
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || null,
  },

  /** Email служебного администратора и получателя сбоев общих API. */
  adminEmail: process.env.ADMIN_EMAIL || null,

  /**
   * Куда уходят заявки «Настройте всё за меня» (онбординг-визард, R2).
   * Письмо шлётся best-effort через первый рабочий ящик пула (если он есть);
   * заявка в любом случае сохраняется в БД и видна в админке.
   */
  setupNotifyEmail: process.env.SETUP_NOTIFY_EMAIL || "zayt_eg@mail.ru",

  /** Ключ шифрования доступов к ящикам (SMTP/IMAP-пароли), см. src/lib/crypto.ts */
  mailboxEncKey: process.env.MAILBOX_ENC_KEY || null,

  /**
   * Здоровье флота (§5.8, M5): минимальный интервал между пересчётами
   * healthScore/авто-паузой. Тик воркера чаще (workerPollMs) — троттлинг
   * простым таймстемпом в памяти воркера (не на ящик, как IMAP-поллинг:
   * пересчёт затрагивает все ящики разом, это не по-ящичный запрос).
   */
  fleetHealthPollMs: Number(process.env.FLEET_HEALTH_POLL_MS ?? 300_000),

  /** Автовосстановление временно недоступных SMTP/IMAP-подключений. */
  mailboxReconnect: {
    pollMs: Number(process.env.MAILBOX_RECONNECT_POLL_MS ?? 60_000),
    baseDelayMs: Number(process.env.MAILBOX_RECONNECT_BASE_MS ?? 15 * 60_000),
    maxDelayMs: Number(process.env.MAILBOX_RECONNECT_MAX_MS ?? 6 * 60 * 60_000),
  },

  /** Надёжная очередь писем администраторам организации. */
  adminNotifications: {
    pollMs: Number(process.env.ADMIN_NOTIFICATIONS_POLL_MS ?? 60_000),
    retryBaseMs: Number(process.env.ADMIN_NOTIFICATIONS_RETRY_MS ?? 5 * 60_000),
    retryMaxMs: Number(process.env.ADMIN_NOTIFICATIONS_RETRY_MAX_MS ?? 6 * 60 * 60_000),
  },

  /** Тарифные напоминания и реактивационная цепочка. */
  planNotifications: {
    pollMs: Number(process.env.PLAN_NOTIFICATIONS_POLL_MS ?? 60_000),
    retryBaseMs: Number(process.env.PLAN_NOTIFICATIONS_RETRY_MS ?? 5 * 60_000),
    retryMaxMs: Number(process.env.PLAN_NOTIFICATIONS_RETRY_MAX_MS ?? 6 * 60 * 60_000),
  },

  /** Движок прогрева (§5.6, M4): троттлинг отправки и вероятность ответа "принимающей стороны". */
  warmup: {
    throttleMs: Number(process.env.WARMUP_THROTTLE_MS ?? 500),
    replyProbabilityMin: Number(process.env.WARMUP_REPLY_PROB_MIN ?? 0.3),
    replyProbabilityMax: Number(process.env.WARMUP_REPLY_PROB_MAX ?? 0.5),
    flagImportantProbability: Number(process.env.WARMUP_FLAG_PROB ?? 0.1),
    maxHops: Number(process.env.WARMUP_MAX_HOPS ?? 2), // opener(0) -> response(1) -> continuation(2)
    // Ramp — правило продукта, а не тюнинг окружения. Менять эти значения
    // через env нельзя: иначе фактический прогрев расходится с калькулятором.
    rampDays: TRIGGA_RULES.warmup.daysBeforeCampaign,
    /**
     * Ramp-параметры прогрева — по базе знаний Trigga (раздел «Настройки
     * прогрева»), не придуманы нами. Раньше стояло 2-4 старт, +2-4/день,
     * потолок 20-30/день «поддержка» — суммарно с холодной рассылкой (по
     * умолчанию 30/день, Mailbox.coldDailyLimit) с ящика могло уходить до
     * 60 писем в сутки. У Trigga жёсткий суммарный потолок — 40/день, и
     * прогрев подозрительной активностью для провайдера не выглядит именно
     * потому, что растёт медленно.
     *
     * dailyMax=10 выбран так, чтобы 30 (холодная) + 10 (прогрев) = 40 — их
     * рекомендованный потолок. Если coldDailyLimit меняют для ящика/тарифа,
     * эту константу нужно пересчитывать вместе с ним, автоматической связи
     * между ними в коде нет.
     */
    dailyStart: TRIGGA_RULES.warmup.dailyStart,
    dailyIncrement: TRIGGA_RULES.warmup.dailyIncrement,
    dailyMax: TRIGGA_RULES.warmup.dailyMax,
    /**
     * Длительность одной «ступени» ramp в миллисекундах. Боевой дефолт —
     * реальные сутки (86_400_000). ТЕСТОВЫЙ РЕЖИМ: поставь WARMUP_DAY_MS=60000
     * (1 мин = 1 день прогрева) → ящик доходит до warm за ~14 минут, и весь
     * цикл (прогрев → запуск кампании → отправка → приём) можно прогнать за
     * часы, а не за 2 недели. На боевом окружении переменную НЕ задавать.
     */
    dayMs: Number(process.env.WARMUP_DAY_MS ?? 86_400_000),
  },

  /**
   * Окно отправки (§5.3, §5.6): и боевые письма, и прогрев уходят только в
   * рабочие часы Пн-Пт (не настраивается через env — фиксировано), по
   * умолчанию 9:00-19:00 по Москве. См. src/lib/schedule.ts — там же причина,
   * почему это понадобилось (письма в 3 ночи из-за сброса счётчика по UTC).
   */
  sendWindow: {
    enabled: (process.env.SEND_WINDOW_ENABLED ?? "true") !== "false",
    timeZone: process.env.SEND_WINDOW_TZ || "Europe/Moscow",
    startHour: Number(process.env.SEND_WINDOW_START_HOUR ?? 9),
    endHour: Number(process.env.SEND_WINDOW_END_HOUR ?? 19),
    weekdays: [1, 2, 3, 4, 5],
  },

  /** Внешние сервисы (наличие ключа = live-режим, иначе mock) */
  anthropicKey: process.env.ANTHROPIC_API_KEY || null,
  // BITRIX24_WEBHOOK_URL здесь БОЛЬШЕ НЕТ намеренно: вебхук Битрикса — это
  // доступ к CRM конкретного клиента, а не общий ключ сервиса. Глобальная
  // переменная означала бы, что лиды всех клиентов уезжают в один чужой
  // портал. Хранится на пользователе, зашифрованным (User.bitrixWebhookEnc).

  /**
   * Вебхук НАШЕГО Bitrix24 — для заявок с формы на лендинге (заявки на демо
   * самого Smailee). Это не тот случай, что описан выше: здесь нет
   * многопользовательности — лендинг один, портал один, поэтому глобальная
   * переменная уместна.
   */
  landingBitrixWebhookUrl: process.env.LANDING_BITRIX_WEBHOOK_URL || null,
} as const;
