"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Logo } from "@/components/Logo";
import { loginAction, requestEmailLoginAction, type AuthState } from "./actions";

export function AuthForm() {
  const [passwordState, passwordAction, passwordPending] = useActionState<AuthState, FormData>(
    loginAction,
    undefined,
  );
  const [emailState, emailAction, emailPending] = useActionState<AuthState, FormData>(requestEmailLoginAction, undefined);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12">
      <div className="mb-8 text-center">
        <div className="flex justify-center"><Logo /></div>
        <h1 className="mt-6 text-2xl font-bold text-slate-900">Вход в кабинет</h1>
        <p className="mt-2 text-sm text-ink-500">Войдите, чтобы управлять кампаниями и лидами</p>
      </div>

      <form action={emailAction} className="space-y-3">
        <input name="email" type="email" autoComplete="email" required placeholder="Рабочий email" className="input" />
        {emailState?.error && <p aria-live="polite" className="text-sm text-red-500">{emailState.error}</p>}
        {emailState?.ok && <p aria-live="polite" className="rounded-lg bg-mint-50 px-3 py-2 text-sm text-mint-800">{emailState.ok}</p>}
        <button type="submit" disabled={emailPending} className="w-full rounded-lg brand-gradient px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60">
          {emailPending ? "Отправляем…" : "Получить ссылку для входа"}
        </button>
      </form>

      <details className="mt-4 rounded-xl border border-line bg-white p-4">
        <summary className="cursor-pointer text-center text-sm font-medium text-ink-700">Войти с паролем</summary>
        <form action={passwordAction} className="mt-4 space-y-3">
        <input name="identifier" type="email" autoComplete="username" required placeholder="Рабочий email" className="input" />
        <input
          name="password"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          required
          placeholder="Пароль"
          className="input"
        />
        <button type="button" onClick={() => setShowPassword((value) => !value)} className="text-sm font-medium text-indigo-600">
          {showPassword ? "Скрыть пароль" : "Показать пароль"}
        </button>
        {passwordState?.error && <p aria-live="polite" className="text-sm text-red-500">{passwordState.error}</p>}
        <button type="submit" disabled={passwordPending} className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-surface disabled:opacity-60">
          {passwordPending ? "Подождите…" : "Войти с паролем"}
        </button>
        </form>
      </details>

      <p className="mt-4 text-center text-sm">
        <Link href="/forgot-password" className="font-medium text-indigo-600">Забыли пароль?</Link>
      </p>
      <p className="mt-6 text-center">
        <Link href="/" className="text-xs text-ink-500 hover:text-slate-900">← На главную</Link>
      </p>
    </div>
  );
}
