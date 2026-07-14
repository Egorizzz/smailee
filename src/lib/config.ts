/**
 * Централизованная конфигурация (единая точка чтения env).
 * Все модули берут настройки отсюда — не разрозненно из process.env.
 * Это упрощает поддержку: видно все переменные окружения проекта в одном месте.
 */

export const config = {
  /** Публичный URL приложения (трекинг, отписки, ссылки в письмах) */
  appUrl: process.env.APP_URL ?? "http://localhost:3000",

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

  /** Email администратора: аккаунт с этим email получает роль ADMIN при регистрации */
  adminEmail: process.env.ADMIN_EMAIL || null,

  /** Ключ шифрования доступов к ящикам (SMTP/IMAP-пароли), см. src/lib/crypto.ts */
  mailboxEncKey: process.env.MAILBOX_ENC_KEY || null,

  /**
   * Здоровье флота (§5.8, M5): минимальный интервал между пересчётами
   * healthScore/авто-паузой. Тик воркера чаще (workerPollMs) — троттлинг
   * простым таймстемпом в памяти воркера (не на ящик, как IMAP-поллинг:
   * пересчёт затрагивает все ящики разом, это не по-ящичный запрос).
   */
  fleetHealthPollMs: Number(process.env.FLEET_HEALTH_POLL_MS ?? 300_000),

  /** Движок прогрева (§5.6, M4): троттлинг отправки и вероятность ответа "принимающей стороны". */
  warmup: {
    throttleMs: Number(process.env.WARMUP_THROTTLE_MS ?? 500),
    replyProbabilityMin: Number(process.env.WARMUP_REPLY_PROB_MIN ?? 0.3),
    replyProbabilityMax: Number(process.env.WARMUP_REPLY_PROB_MAX ?? 0.5),
    flagImportantProbability: Number(process.env.WARMUP_FLAG_PROB ?? 0.1),
    maxHops: Number(process.env.WARMUP_MAX_HOPS ?? 2), // opener(0) -> response(1) -> continuation(2)
    rampDays: Number(process.env.WARMUP_RAMP_DAYS ?? 14),
    /**
     * Длительность одной «ступени» ramp в миллисекундах. Боевой дефолт —
     * реальные сутки (86_400_000). ТЕСТОВЫЙ РЕЖИМ: поставь WARMUP_DAY_MS=60000
     * (1 мин = 1 день прогрева) → ящик доходит до warm за ~14 минут, и весь
     * цикл (прогрев → запуск кампании → отправка → приём) можно прогнать за
     * часы, а не за 2 недели. На боевом окружении переменную НЕ задавать.
     */
    dayMs: Number(process.env.WARMUP_DAY_MS ?? 86_400_000),
  },

  /** Внешние сервисы (наличие ключа = live-режим, иначе mock) */
  anthropicKey: process.env.ANTHROPIC_API_KEY || null,
  bitrixWebhookUrl: process.env.BITRIX24_WEBHOOK_URL || null,
} as const;
