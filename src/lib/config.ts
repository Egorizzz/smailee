/**
 * Централизованная конфигурация (единая точка чтения env).
 * Все модули берут настройки отсюда — не разрозненно из process.env.
 * Это упрощает поддержку: видно все переменные окружения проекта в одном месте.
 */

export const config = {
  /** Публичный URL приложения (трекинг, отписки, ссылки в письмах) */
  appUrl: process.env.APP_URL ?? "http://localhost:3000",

  /**
   * Базовый домен для managed-отправителей: клиент шлёт с поддомена
   * <slug>.smailee.ru, DNS которого настраиваем мы (клиент не трогает свой DNS).
   * Изоляция репутации — через Project на клиента в Unisender (User.unisenderApiKey)
   * и DKIM d=<поддомен>, чтобы корневой smailee.ru не страдал от рассылок клиентов.
   */
  mailBaseDomain: process.env.MAIL_BASE_DOMAIN ?? "smailee.ru",

  /**
   * Демо-песочница (тариф «Демо» / managed-отправитель): реальная рассылка
   * разрешена ТОЛЬКО на эти адреса + email самого владельца кабинета. Это снимает
   * риск фишинга и спама на этапе демо — клиент щупает механику, не задев чужих
   * получателей. Заполняется через env (≤10 адресов, наши контролируемые ящики).
   */
  demoAllowedRecipients: (process.env.DEMO_ALLOWED_RECIPIENTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  /** Отправка: троттлинг и размер батча */
  send: {
    throttleMs: Number(process.env.SEND_THROTTLE_MS ?? 300),
    batchSize: Number(process.env.SEND_BATCH_SIZE ?? 50),
  },

  /** Воркер: период опроса */
  workerPollMs: Number(process.env.WORKER_POLL_MS ?? 5000),

  /** Секрет вебхука входящих писем (провайдер -> /api/inbound) */
  inboundSecret: process.env.INBOUND_SECRET || null,

  /** Секрет вебхука платёжного шлюза (-> /api/payments/webhook) */
  paymentSecret: process.env.PAYMENT_WEBHOOK_SECRET || null,

  /** Email администратора: аккаунт с этим email получает роль ADMIN при регистрации */
  adminEmail: process.env.ADMIN_EMAIL || null,

  /** Внешние сервисы (наличие ключа = live-режим, иначе mock) */
  anthropicKey: process.env.ANTHROPIC_API_KEY || null,
  unisenderKey: process.env.UNISENDER_API_KEY || null,
  bitrixWebhookUrl: process.env.BITRIX24_WEBHOOK_URL || null,
} as const;
