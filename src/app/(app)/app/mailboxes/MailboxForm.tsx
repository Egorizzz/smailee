"use client";

import { useState, useTransition, useEffect } from "react";
import { connectMailbox, importMailboxesCsv } from "./actions";

/** Поле пароля с кнопкой «показать» — вслепую легко ошибиться при вставке. */
function PasswordField({
  name,
  label,
  hint,
}: {
  name: string;
  label: string;
  hint?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-900">{label}</span>
      <div className="relative mt-1">
        <input
          name={name}
          type={shown ? "text" : "password"}
          className="input w-full pr-16"
          autoComplete="off"
          required
        />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          className="absolute inset-y-0 right-0 px-3 text-xs font-semibold text-ink-500 hover:text-slate-900"
          aria-label={shown ? "Скрыть пароль" : "Показать пароль"}
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
  passwordSetup,
}: {
  providers: { value: string; label: string }[];
  passwordHint: string;
  passwordSetup: { app: string[]; account: string[] };
}) {
  const [mode, setMode] = useState<"manual" | "csv">("manual");
  // Один пароль от аккаунта работает и для SMTP, и для IMAP — два поля в этом
  // случае лишние и провоцируют опечатку (вводишь одно и то же дважды).
  const [passwordKind, setPasswordKind] = useState<"app" | "account">("app");
  const [showSetup, setShowSetup] = useState(false);
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  function handleManual(fd: FormData) {
    startTransition(async () => {
      const res = await connectMailbox(fd);
      setToast(res.error ?? res.ok ?? null);
    });
  }
  function handleCsv(fd: FormData) {
    startTransition(async () => {
      const res = await importMailboxesCsv(fd);
      setToast(res.error ?? res.ok ?? null);
    });
  }

  return (
    <div className="rounded-2xl border border-line bg-white p-5">
      {toast && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {toast}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("manual")}
          className={`rounded-lg border px-4 py-2 text-sm font-semibold ${mode === "manual" ? "border-mint-400 bg-mint-50 text-mint-700" : "border-line text-ink-700"}`}
        >
          Добавить ящик
        </button>
        <button
          type="button"
          onClick={() => setMode("csv")}
          className={`rounded-lg border px-4 py-2 text-sm font-semibold ${mode === "csv" ? "border-mint-400 bg-mint-50 text-mint-700" : "border-line text-ink-700"}`}
        >
          Импорт CSV
        </button>
      </div>

      <p className="mt-3 rounded-lg bg-surface px-3 py-2 text-xs text-ink-500">{passwordHint}</p>

      {mode === "manual" ? (
        <form action={handleManual} className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <span className="text-sm font-medium text-slate-900">Тип пароля</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {(
                [
                  { v: "app", label: "Пароль приложения" },
                  { v: "account", label: "Пароль от аккаунта" },
                ] as const
              ).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setPasswordKind(o.v)}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${
                    passwordKind === o.v
                      ? "border-mint-400 bg-mint-50 font-semibold text-mint-700"
                      : "border-line text-ink-700"
                  }`}
                >
                  {o.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowSetup((v) => !v)}
                className="px-2 py-1.5 text-sm text-ink-500 underline underline-offset-2 hover:text-slate-900"
              >
                {showSetup ? "Скрыть инструкцию" : "Как включить?"}
              </button>
            </div>
            <input type="hidden" name="passwordKind" value={passwordKind} />
            {showSetup && (
              <ol className="mt-2 list-decimal space-y-1 rounded-lg bg-surface px-5 py-3 text-xs text-ink-700">
                {passwordSetup[passwordKind].map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            )}
          </div>
          <label className="block">
            <span className="text-sm font-medium text-slate-900">Провайдер</span>
            <select name="provider" className="input mt-1">
              {providers.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-900">Имя отправителя</span>
            <input name="senderName" placeholder="Иван Иванов" className="input mt-1" />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-sm font-medium text-slate-900">Email ящика</span>
            <input name="email" type="email" placeholder="i.ivanov@companytech.ru" className="input mt-1" required />
          </label>
          {passwordKind === "account" ? (
            <div className="sm:col-span-2">
              <PasswordField
                name="accountPassword"
                label="Пароль от аккаунта"
                hint="Один и тот же пароль используется и для отправки (SMTP), и для приёма (IMAP)."
              />
            </div>
          ) : (
            <>
              <PasswordField name="smtpPassword" label="Пароль приложения для SMTP" />
              <PasswordField
                name="imapPassword"
                label="Пароль приложения для IMAP"
                hint="Если создавали один пароль на «Почту» — вставьте его в оба поля."
              />
            </>
          )}
          <div className="sm:col-span-2">
            <button disabled={pending} className="rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
              {pending ? "Подключаем…" : "Подключить ящик"}
            </button>
          </div>
        </form>
      ) : (
        <form action={handleCsv} className="mt-4 space-y-3">
          <p className="text-sm text-ink-700">
            CSV с колонками: <code>email</code>, <code>Sender Name</code>,{" "}
            <code>SMTP-пароль</code>, <code>IMAP-пароль</code>. Host/port подставим по провайдеру.
          </p>
          <label className="block">
            <span className="text-sm font-medium text-slate-900">Провайдер</span>
            <select name="provider" className="input mt-1 sm:w-64">
              {providers.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>
          <input name="file" type="file" accept=".csv,text/csv" className="block text-sm" required />
          <button disabled={pending} className="rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
            {pending ? "Импортируем…" : "Импортировать пул"}
          </button>
        </form>
      )}
    </div>
  );
}
