"use client";

import { useActionState, useState } from "react";
import { requestCredentialChange, type CredentialState } from "./actions";

export function SecurityForm({ login, email }: { login: string | null; email: string }) {
  const [state, action, pending] = useActionState<CredentialState, FormData>(requestCredentialChange, undefined);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={action} className="mt-6 space-y-6 rounded-xl border border-line bg-white p-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Данные для входа</h2>
        <p className="mt-1 text-sm leading-6 text-ink-500">Войти можно по рабочему email или отдельному логину. Любое изменение подтверждается через {email}.</p>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-slate-900">Рабочий email</span>
        <span className="mt-2 block rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink-700">{email}</span>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-slate-900">Логин</span>
        <input name="login" autoComplete="username" className="input mt-2" defaultValue={login ?? ""} placeholder="Например, ivan-smailee" />
        <span className="mt-1.5 block text-xs text-ink-500">Если отдельный логин не задан, используйте email.</span>
      </label>

      <div>
        <label className="block">
          <span className="text-sm font-medium text-slate-900">Новый пароль</span>
          <input name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" className="input mt-2" placeholder="Оставьте пустым, если менять не нужно" />
        </label>
        <label className="mt-3 block">
          <span className="text-sm font-medium text-slate-900">Повторите новый пароль</span>
          <input name="passwordConfirmation" type={showPassword ? "text" : "password"} autoComplete="new-password" className="input mt-2" />
        </label>
        <button type="button" onClick={() => setShowPassword((value) => !value)} className="mt-2 text-sm font-medium text-mint-700">
          {showPassword ? "Скрыть пароль" : "Показать пароль"}
        </button>
      </div>

      {state?.error && <p aria-live="polite" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {state?.ok && <p aria-live="polite" className="rounded-lg border border-mint-200 bg-mint-50 px-3 py-2 text-sm text-mint-800">{state.ok}</p>}
      <button disabled={pending} className="rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
        {pending ? "Отправляем…" : "Подтвердить изменение по email"}
      </button>
    </form>
  );
}
