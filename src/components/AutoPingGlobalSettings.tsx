"use client";

import { useState } from "react";

type Props = {
  initialEnabled: boolean;
  initialStartAfterDays: number;
  initialIntervalDays: number;
  initialMaxAttempts: number;
};

export function AutoPingGlobalSettings({
  initialEnabled,
  initialStartAfterDays,
  initialIntervalDays,
  initialMaxAttempts,
}: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);

  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <label className="flex cursor-pointer items-start justify-between gap-4">
        <span className="min-w-0">
          <span className="block text-sm font-medium text-slate-900">
            Автоматически возвращать остывшие диалоги
          </span>
          <span className="mt-1 block max-w-xl text-xs leading-relaxed text-ink-500">
            ИИ отправит короткий пинг, если клиент не ответил. Любой новый ответ клиента
            сразу останавливает автопинг. Явный отказ и указанная дата следующего контакта
            также исключают отправку.
          </span>
        </span>
        <span className="relative mt-0.5 inline-flex shrink-0">
          <input
            type="checkbox"
            name="autoPingEnabled"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="peer sr-only"
          />
          <span className="h-6 w-11 rounded-full bg-slate-200 transition peer-checked:bg-mint-500 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-mint-500" />
          <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
        </span>
      </label>

      {enabled && (
        <div className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-3">
          <label className="block">
            <span className="text-xs font-medium text-ink-500">Запустить после, дней</span>
            <input
              type="number"
              name="autoPingStartAfterDays"
              min={1}
              max={90}
              defaultValue={initialStartAfterDays}
              className="input metric-number mt-1 w-full"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-ink-500">Повторять каждые, дней</span>
            <input
              type="number"
              name="autoPingIntervalDays"
              min={1}
              max={90}
              defaultValue={initialIntervalDays}
              className="input metric-number mt-1 w-full"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-ink-500">Максимум попыток</span>
            <input
              type="number"
              name="autoPingMaxAttempts"
              min={1}
              max={20}
              defaultValue={initialMaxAttempts}
              className="input metric-number mt-1 w-full"
            />
          </label>
          <p className="text-xs leading-relaxed text-ink-500 sm:col-span-3">
            Отправка — только по будням с 09:00 до 19:00 МСК.
          </p>
        </div>
      )}
    </div>
  );
}
