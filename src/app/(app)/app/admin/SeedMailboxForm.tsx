"use client";

import { useActionState, useState } from "react";
import { adminConnectSeedMailbox, type AdminActionState } from "./actions";

export function SeedMailboxForm() {
  const [state, action, pending] = useActionState<AdminActionState, FormData>(
    adminConnectSeedMailbox,
    undefined
  );
  const [showPassword, setShowPassword] = useState(false);

  return (
    <details className="group mt-4 rounded-xl border border-line bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 marker:content-none">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Подключить служебный seed</h3>
          <p className="mt-0.5 text-sm text-ink-500">
            Отдельный заранее прогретый ящик, который не участвует в клиентских кампаниях
          </p>
        </div>
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface text-lg text-ink-700 transition group-open:rotate-45">
          +
        </span>
      </summary>

      <div className="border-t border-line p-5">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Seed не проходит постепенный прогрев: он сразу принимает письма и может автоматически
          отвечать на них. Подключайте только здоровый, уже прогретый ящик.
        </div>

        <form action={action} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-slate-900">Провайдер</span>
            <select name="provider" className="input mt-1 w-full" defaultValue="yandex">
              <option value="yandex">Яндекс 360</option>
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-900">Имя отправителя</span>
            <input
              name="senderName"
              className="input mt-1 w-full"
              placeholder="Иван Иванов"
              autoComplete="name"
              required
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="text-sm font-medium text-slate-900">Email ящика</span>
            <input
              name="email"
              type="email"
              inputMode="email"
              className="input mt-1 w-full"
              placeholder="seed@company.ru"
              autoComplete="email"
              spellCheck={false}
              required
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="text-sm font-medium text-slate-900">Пароль приложения</span>
            <div className="relative mt-1">
              <input
                name="appPassword"
                type={showPassword ? "text" : "password"}
                className="input w-full pr-20"
                autoComplete="off"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute inset-y-0 right-0 px-3 text-xs font-semibold text-ink-500 hover:text-slate-900"
                aria-label={showPassword ? "Скрыть пароль приложения" : "Показать пароль приложения"}
              >
                {showPassword ? "Скрыть" : "Показать"}
              </button>
            </div>
            <span className="mt-1 block text-xs text-ink-500">
              Один пароль используется для SMTP и IMAP.
            </span>
          </label>

          <label className="flex items-start gap-2 rounded-lg bg-surface px-3 py-2.5 sm:col-span-2">
            <input name="confirmedWarm" type="checkbox" className="mt-0.5 size-4" required />
            <span className="text-sm text-ink-700">
              Подтверждаю, что ящик уже прогрет и не используется для клиентских рассылок
            </span>
          </label>

          {state?.error && (
            <p role="alert" className="text-sm text-red-600 sm:col-span-2">
              {state.error}
            </p>
          )}
          {state?.ok && (
            <p role="status" className="text-sm text-mint-700 sm:col-span-2">
              {state.ok}
            </p>
          )}

          <div className="sm:col-span-2">
            <button
              disabled={pending}
              className="rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {pending ? "Проверяем подключение…" : "Подключить seed"}
            </button>
          </div>
        </form>
      </div>
    </details>
  );
}
