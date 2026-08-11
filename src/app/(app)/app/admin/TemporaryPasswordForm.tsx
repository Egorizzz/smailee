"use client";

import { useActionState, useState } from "react";
import { adminSetTemporaryPassword, type AdminActionState } from "./actions";
import { TemporaryPasswordResult } from "./TemporaryPasswordResult";

export function TemporaryPasswordForm({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [state, action, pending] = useActionState<AdminActionState, FormData>(
    adminSetTemporaryPassword,
    undefined,
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-700 hover:border-amber-300 hover:text-amber-800"
      >
        Задать временный пароль
      </button>
    );
  }

  return (
    <form action={action} className="w-72 space-y-2 rounded-lg border border-line bg-surface p-3">
      <input type="hidden" name="userId" value={userId} />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-slate-900">Аварийный доступ</span>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-500">Закрыть</button>
      </div>
      <p className="text-xs leading-5 text-amber-800">
        Задайте пароль вручную и передайте пользователю. После входа Smailee потребует заменить его.
      </p>
      <input
        name="temporaryPassword"
        type={showPassword ? "text" : "password"}
        required
        minLength={8}
        maxLength={128}
        placeholder="Введите временный пароль"
        className="input !py-2 text-xs"
      />
      <button
        type="button"
        onClick={() => setShowPassword((value) => !value)}
        className="text-xs font-medium text-indigo-600"
      >
        {showPassword ? "Скрыть пароль" : "Показать пароль"}
      </button>
      {state?.error && <p aria-live="polite" className="text-xs text-red-600">{state.error}</p>}
      {state?.ok && <p aria-live="polite" className="text-xs text-mint-700">{state.ok}</p>}
      {state?.temporaryPassword && <TemporaryPasswordResult password={state.temporaryPassword} />}
      <button
        disabled={pending}
        className="w-full rounded-md bg-slate-900 px-2 py-2 text-xs font-semibold text-white disabled:opacity-50"
      >
        {pending ? "Сохраняем…" : "Установить временный пароль"}
      </button>
    </form>
  );
}
