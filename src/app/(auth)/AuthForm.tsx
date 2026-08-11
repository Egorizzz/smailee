"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Logo } from "@/components/Logo";
import { loginAction, type AuthState } from "./actions";

export function AuthForm() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    loginAction,
    undefined,
  );
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12">
      <div className="mb-8 text-center">
        <div className="flex justify-center"><Logo /></div>
        <h1 className="mt-6 text-2xl font-bold text-slate-900">Вход в кабинет</h1>
        <p className="mt-2 text-sm text-ink-500">Войдите, чтобы управлять кампаниями и лидами</p>
      </div>

      <form action={formAction} className="space-y-3">
        <input name="email" type="email" autoComplete="email" required placeholder="Email" className="input" />
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
        {state?.error && <p aria-live="polite" className="text-sm text-red-500">{state.error}</p>}
        <button type="submit" disabled={pending} className="w-full rounded-lg brand-gradient px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60">
          {pending ? "Подождите…" : "Войти"}
        </button>
      </form>

      <p className="mt-3 text-center text-sm">
        <Link href="/forgot-password" className="font-medium text-indigo-600">Забыли пароль?</Link>
      </p>
      <p className="mt-6 text-center">
        <Link href="/" className="text-xs text-ink-500 hover:text-slate-900">← На главную</Link>
      </p>
    </div>
  );
}
