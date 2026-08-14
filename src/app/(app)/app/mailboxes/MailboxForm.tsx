"use client";

import { useEffect, useState, useTransition } from "react";
import { connectMailbox } from "./actions";
import { Yandex360Guide } from "./Yandex360Guide";

/** Поле пароля с кнопкой «показать» — вслепую легко ошибиться при вставке. */
function PasswordField({ hint }: { hint?: string }) {
  const [shown, setShown] = useState(false);
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-900">Пароль приложения</span>
      <div className="relative mt-1">
        <input
          name="appPassword"
          type={shown ? "text" : "password"}
          className="input w-full pr-20"
          autoComplete="off"
          required
        />
        <button
          type="button"
          onClick={() => setShown((value) => !value)}
          className="absolute inset-y-0 right-0 px-3 text-xs font-semibold text-ink-500 hover:text-slate-900"
          aria-label={shown ? "Скрыть пароль приложения" : "Показать пароль приложения"}
        >
          {shown ? "Скрыть" : "Показать"}
        </button>
      </div>
      {hint && <span className="mt-1 block text-xs text-ink-500">{hint}</span>}
    </label>
  );
}

export function MailboxForm({
  providers,
  passwordHint,
}: {
  providers: { value: string; label: string }[];
  passwordHint: string;
}) {
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);

  function handleConnect(formData: FormData) {
    startTransition(async () => {
      const result = await connectMailbox(formData);
      setToast(result.error ?? result.ok ?? null);
    });
  }

  return (
    <div className="rounded-2xl border border-line bg-white p-5">
      {toast && (
        <div role="status" aria-live="polite" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {toast}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Добавить почтовый ящик</h2>
          <p className="mt-1 text-sm text-ink-500">Укажите готовый ящик Яндекс 360 и его пароль приложения.</p>
        </div>
        <Yandex360Guide />
      </div>

      <p className="mt-4 rounded-lg bg-surface px-3 py-2 text-xs text-ink-500">{passwordHint}</p>

      <form action={handleConnect} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-slate-900">Провайдер</span>
          <select name="provider" className="input mt-1">
            {providers.map((provider) => (
              <option key={provider.value} value={provider.value}>{provider.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-900">Имя отправителя</span>
          <input name="senderName" placeholder="Иван Иванов" className="input mt-1" autoComplete="name" required />
          <span className="mt-1 block text-xs text-ink-500">Получатель увидит это имя в поле «От кого».</span>
        </label>
        <label className="block sm:col-span-2">
          <span className="text-sm font-medium text-slate-900">Email ящика</span>
          <input
            name="email"
            type="email"
            inputMode="email"
            placeholder="i.ivanov@companytech.ru"
            className="input mt-1"
            autoComplete="email"
            spellCheck={false}
            required
          />
        </label>
        <div className="sm:col-span-2">
          <PasswordField hint="Один пароль используется для подключения по SMTP и IMAP." />
        </div>
        <div className="sm:col-span-2">
          <button disabled={pending} className="rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
            {pending ? "Подключаем…" : "Подключить ящик"}
          </button>
        </div>
      </form>
    </div>
  );
}
