"use client";

import { useState, useTransition } from "react";
import { createTelegramConnectLink, disconnectTelegram } from "@/app/(app)/app/integrations/telegram/actions";

export function TelegramIntegrationControl({ connected }: { connected: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function connect() {
    startTransition(async () => {
      setError(null);
      const result = await createTelegramConnectLink();
      if (result.error || !result.url) return setError(result.error || "Не удалось создать ссылку");
      window.location.assign(result.url);
    });
  }

  function disconnect() {
    startTransition(async () => {
      setError(null);
      const result = await disconnectTelegram();
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="mt-6">
      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      {connected ? (
        <button type="button" disabled={pending} onClick={disconnect} className="rounded-lg border border-red-200 bg-white px-5 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
          {pending ? "Отключаем…" : "Отключить Telegram"}
        </button>
      ) : (
        <button type="button" disabled={pending} onClick={connect} className="rounded-lg bg-[#229ED9] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#188fc9] disabled:opacity-50">
          {pending ? "Готовим подключение…" : "Подключить Telegram"}
        </button>
      )}
    </div>
  );
}
