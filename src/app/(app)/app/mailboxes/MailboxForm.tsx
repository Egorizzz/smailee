"use client";

import { useState, useTransition, useEffect } from "react";
import { connectMailbox, importMailboxesCsv } from "./actions";

export function MailboxForm({
  providers,
  passwordHint,
}: {
  providers: { value: string; label: string }[];
  passwordHint: string;
}) {
  const [mode, setMode] = useState<"manual" | "csv">("manual");
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
          <label className="block">
            <span className="text-sm font-medium text-slate-900">Пароль SMTP</span>
            <input name="smtpPassword" type="password" className="input mt-1" required />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-900">Пароль IMAP</span>
            <input name="imapPassword" type="password" className="input mt-1" required />
          </label>
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
