"use client";

import { useActionState, useState } from "react";
import { resumeMailbox, type ResumeMailboxState } from "./actions";

const initialState: ResumeMailboxState = { status: "idle", message: "" };

export function MailboxResumeControl({
  mailboxId,
  email,
  provider,
}: {
  mailboxId: string;
  email: string;
  provider: string;
}) {
  const [state, formAction, pending] = useActionState(resumeMailbox, initialState);
  const [shown, setShown] = useState(false);
  const needsCredentials = state.status === "credentials_required";

  if (!needsCredentials) {
    return (
      <div className="flex flex-col items-end gap-2">
        <form action={formAction}>
          <input type="hidden" name="id" value={mailboxId} />
          <button
            disabled={pending}
            className="rounded-md border border-mint-200 bg-mint-100 px-2 py-1 text-xs font-semibold text-mint-700 transition hover:bg-mint-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
          >
            {pending ? "Проверяем…" : "Возобновить"}
          </button>
        </form>
        {state.status === "error" && (
          <div role="alert" className="max-w-72 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
            <p>{state.message}</p>
            {state.supportCode && <p className="metric-number mt-1 text-[11px] text-amber-700">Код: {state.supportCode}</p>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full rounded-xl border border-amber-200 bg-amber-50 p-3 sm:w-80">
      <div role="alert" aria-live="polite" className="text-xs leading-5 text-amber-950">
        <p className="font-semibold">Нужен новый пароль приложения</p>
        <p className="mt-1">{state.message}</p>
        {provider === "yandex" && (
          <a
            href="https://id.yandex.ru/security/app-passwords"
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex font-semibold text-amber-950 underline decoration-amber-400 underline-offset-4 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2"
          >
            Создать пароль приложения в Яндексе
          </a>
        )}
        {state.supportCode && <p className="metric-number mt-1 text-[11px] text-amber-700">Код: {state.supportCode}</p>}
      </div>

      <form action={formAction} className="mt-3">
        <input type="hidden" name="id" value={mailboxId} />
        <label className="block">
          <span className="text-xs font-medium text-slate-900">Новый пароль приложения</span>
          <div className="relative mt-1">
            <input
              name="appPassword"
              type={shown ? "text" : "password"}
              autoComplete="new-password"
              aria-label={`Новый пароль приложения для ${email}`}
              className="input w-full pr-20 text-sm"
              required
            />
            <button
              type="button"
              onClick={() => setShown((value) => !value)}
              className="absolute inset-y-0 right-0 px-3 text-xs font-semibold text-ink-500 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-mint-500"
              aria-label={shown ? "Скрыть пароль приложения" : "Показать пароль приложения"}
            >
              {shown ? "Скрыть" : "Показать"}
            </button>
          </div>
        </label>
        <button
          disabled={pending}
          className="mt-2 w-full rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? "Проверяем…" : "Сохранить и подключить"}
        </button>
      </form>

      <form action={formAction} className="mt-2">
        <input type="hidden" name="id" value={mailboxId} />
        <button
          disabled={pending}
          className="w-full rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-600 underline decoration-line underline-offset-4 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
        >
          Проверить сохранённый пароль ещё раз
        </button>
      </form>
    </div>
  );
}
