"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
  const [confirmedWarm, setConfirmedWarm] = useState(false);
  const warmupDialogRef = useRef<HTMLDialogElement>(null);

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
    <details className="group rounded-xl border border-line bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 marker:content-none">
        <div><h2 className="text-base font-semibold text-slate-900">Добавить почтовый ящик</h2><p className="mt-0.5 text-sm text-ink-500">Email, имя отправителя и пароль приложения</p></div>
        <span className="grid size-8 place-items-center rounded-md bg-surface text-lg text-ink-700 transition group-open:rotate-45">+</span>
      </summary>
      <div className="border-t border-line p-5">
      {toast && (
        <div role="status" aria-live="polite" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {toast}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Данные ящика</h3>
          <p className="mt-1 text-sm text-ink-500">Укажите готовый ящик Яндекс 360 и его пароль приложения.</p>
        </div>
        <Yandex360Guide />
      </div>

      <p className="mt-4 rounded-lg bg-surface px-3 py-2 text-xs text-ink-500">{passwordHint}</p>

      <form action={handleConnect} className="mt-4 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="confirmedWarm" value={confirmedWarm ? "on" : ""} />
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
        <label
          className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3.5 transition sm:col-span-2 ${
            confirmedWarm
              ? "border-emerald-200 bg-emerald-50/70"
              : "border-line bg-white hover:border-slate-300 hover:bg-surface/50"
          }`}
        >
          <input
            type="checkbox"
            checked={confirmedWarm}
            onChange={(event) => {
              if (event.target.checked) {
                warmupDialogRef.current?.showModal();
                return;
              }
              setConfirmedWarm(false);
            }}
            className="mt-0.5 size-4 shrink-0 accent-emerald-600"
          />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
              Ящик уже прогрет
              {confirmedWarm && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                  Подтверждено
                </span>
              )}
            </span>
            <span className="mt-0.5 block text-xs leading-5 text-ink-500">
              Пропустить 14-дневный прогрев и сразу использовать ящик в кампаниях.
            </span>
          </span>
        </label>
        <div className="sm:col-span-2">
          <button disabled={pending} className="rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
            {pending ? "Подключаем…" : "Подключить ящик"}
          </button>
        </div>
      </form>
      </div>

      <dialog
        ref={warmupDialogRef}
        aria-labelledby="warmup-confirmation-title"
        onClick={(event) => {
          if (event.currentTarget === event.target) event.currentTarget.close();
        }}
        className="fixed inset-0 m-auto w-[min(92vw,32rem)] rounded-2xl border border-line bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/35"
      >
        <div className="p-6 sm:p-7">
          <h3 id="warmup-confirmation-title" className="text-xl font-semibold tracking-tight">
            Подтвердить готовность ящика?
          </h3>
          <p className="mt-3 text-sm leading-6 text-ink-600">
            Подтвердите, что этот ящик уже прошёл прогрев в другом сервисе или использовался для регулярных исходящих отправок.
          </p>
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
            Smailee пропустит 14-дневный постепенный прогрев и сразу допустит ящик к кампаниям. Ошибочная отметка может ухудшить доставляемость и репутацию домена.
          </div>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => warmupDialogRef.current?.close()}
              className="rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-surface"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmedWarm(true);
                warmupDialogRef.current?.close();
              }}
              className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Да, ящик прогрет
            </button>
          </div>
        </div>
      </dialog>
    </details>
  );
}
