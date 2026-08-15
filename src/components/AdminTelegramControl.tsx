"use client";

import { useState, useTransition } from "react";
import {
  createAdminTelegramConnectLink,
  revokeAdminTelegramRecipient,
} from "@/app/(app)/app/admin/actions";

type Recipient = {
  id: string;
  telegramUsername: string | null;
  telegramName: string | null;
  connectedAt: string;
};

export function AdminTelegramControl({
  configured,
  recipients,
}: {
  configured: boolean;
  recipients: Recipient[];
}) {
  const [pending, startTransition] = useTransition();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function createInvite() {
    startTransition(async () => {
      setError(null);
      setCopied(false);
      const result = await createAdminTelegramConnectLink();
      if (!result.url) {
        setError(result.error || "Не удалось создать ссылку");
        return;
      }
      setInviteUrl(result.url);
      window.open(result.url, "_blank", "noopener,noreferrer");
    });
  }

  async function copyInvite() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
  }

  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-line bg-white shadow-[0_12px_34px_rgba(15,23,42,0.05)]">
      <div className="flex flex-col gap-4 border-b border-line px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#229ED9] text-white shadow-[0_8px_20px_rgba(34,158,217,0.25)]" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="size-6 fill-current">
              <path d="M21.8 3.2a1.5 1.5 0 0 0-1.53-.2L3.4 9.6c-1.15.45-1.14 1.1-.2 1.4l4.33 1.35 1.67 5.16c.2.56.1.78.68.78.45 0 .65-.2.9-.45l2.08-2.02 4.34 3.2c.8.44 1.37.2 1.57-.74l2.85-13.43c.3-1.2-.45-1.75-1.82-1.25ZM8.2 12.04l9.77-6.17c.49-.3.94-.14.57.18l-8.06 7.28-.31 3.3-1.97-4.59Z" />
            </svg>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-900">Служебный Telegram</h2>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${configured ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                {configured ? "Бот настроен" : "Нужен токен"}
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-500">Заявки с сайта и на настройку инфраструктуры. Доступ — только по одноразовой ссылке.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={createInvite}
          disabled={!configured || pending}
          className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {pending ? "Создаём ссылку…" : "Выдать доступ"}
        </button>
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Получатели</h3>
            <span className="text-xs text-ink-500">Активных: {recipients.length}</span>
          </div>
          {recipients.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-surface px-4 py-5 text-sm text-ink-500">
              Никто не подключён. Создайте ссылку и откройте её со своего Telegram-аккаунта.
            </div>
          ) : (
            <div className="divide-y divide-line rounded-xl border border-line">
              {recipients.map((recipient) => {
                const label = recipient.telegramName || (recipient.telegramUsername ? `@${recipient.telegramUsername}` : "Telegram-получатель");
                return (
                  <div key={recipient.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{label}</p>
                      <p className="mt-0.5 text-xs text-ink-500">
                        {recipient.telegramUsername && recipient.telegramName ? `@${recipient.telegramUsername} · ` : ""}
                        подключён {new Date(recipient.connectedAt).toLocaleString("ru-RU")}
                      </p>
                    </div>
                    <form action={revokeAdminTelegramRecipient}>
                      <input type="hidden" name="recipientId" value={recipient.id} />
                      <button className="rounded-lg border border-red-100 px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-50">
                        Отозвать
                      </button>
                    </form>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <aside className="border-t border-line bg-sky-50/60 p-5 lg:border-l lg:border-t-0">
          <p className="text-sm font-semibold text-slate-900">Как подключить</p>
          <ol className="mt-3 space-y-2 text-sm text-ink-700">
            <li>1. Создайте одноразовую ссылку.</li>
            <li>2. Откройте её в нужном Telegram.</li>
            <li>3. Нажмите Start — доступ появится в списке.</li>
          </ol>
          {inviteUrl && (
            <div className="mt-4 rounded-xl border border-sky-200 bg-white p-3">
              <p className="truncate font-mono text-xs text-slate-600">{inviteUrl}</p>
              <div className="mt-3 flex gap-2">
                <a href={inviteUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-[#229ED9] px-3 py-2 text-xs font-semibold text-white">
                  Открыть бота
                </a>
                <button type="button" onClick={copyInvite} className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                  {copied ? "Скопировано" : "Скопировать"}
                </button>
              </div>
              <p className="mt-2 text-xs text-ink-500">Ссылка действует 15 минут и только один раз.</p>
            </div>
          )}
          {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          {!configured && (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Добавьте TELEGRAM_ADMIN_BOT_TOKEN в окружение и перезапустите приложение.
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}
