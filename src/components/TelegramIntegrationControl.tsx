"use client";

import { useState, useTransition } from "react";
import { createTelegramConnectLink, disconnectTelegram, repairTelegramBot } from "@/app/(app)/app/integrations/telegram/actions";

export function TelegramIntegrationControl({ connected }: { connected: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  function connect() {
    startTransition(async () => {
      setError(null);
      setStatus(null);
      const result = await createTelegramConnectLink();
      if (result.error || !result.url) return setError(result.error || "Не удалось создать ссылку");
      window.location.assign(result.url);
    });
  }

  function disconnect() {
    startTransition(async () => {
      setError(null);
      setStatus(null);
      const result = await disconnectTelegram();
      if (result.error) setError(result.error);
    });
  }

  function repair() {
    startTransition(async () => {
      setError(null);
      setStatus(null);
      const result = await repairTelegramBot();
      if (result.error) return setError(result.error);
      setStatus(result.ok || "Telegram-бот готов к работе");
    });
  }

  return (
    <div className="mt-6">
      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      {status && <p role="status" aria-live="polite" className="mb-3 rounded-lg bg-mint-50 px-3 py-2 text-sm text-mint-700">{status}</p>}
      {connected ? (
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={pending} onClick={repair} className="rounded-lg bg-[#229ED9] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#188fc9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229ED9] disabled:opacity-50">
            {pending ? "Проверяем…" : "Проверить и восстановить"}
          </button>
          <button type="button" disabled={pending} onClick={disconnect} className="rounded-lg border border-red-200 bg-white px-5 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400 disabled:opacity-50">
            Отключить Telegram
          </button>
        </div>
      ) : (
        <button type="button" disabled={pending} onClick={connect} className="rounded-lg bg-[#229ED9] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#188fc9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229ED9] disabled:opacity-50">
          {pending ? "Готовим подключение…" : "Подключить Telegram"}
        </button>
      )}
    </div>
  );
}
