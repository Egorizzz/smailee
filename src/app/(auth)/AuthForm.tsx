"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { registerAction, loginAction, type AuthState } from "./actions";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const action = mode === "login" ? loginAction : registerAction;
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    action,
    undefined
  );

  const isLogin = mode === "login";

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12">
      <div className="mb-8 text-center">
        <div className="flex justify-center">
          <Logo />
        </div>
        <h1 className="mt-6 text-2xl font-bold text-slate-900">
          {isLogin ? "Вход в кабинет" : "Создать аккаунт"}
        </h1>
        <p className="mt-2 text-sm text-ink-500">
          {isLogin
            ? "Войдите, чтобы управлять кампаниями и лидами"
            : "Зарегистрируйтесь и запустите первую кампанию"}
        </p>
      </div>

      <form action={formAction} className="space-y-3">
        {!isLogin && (
          <input
            name="name"
            placeholder="Имя (по желанию)"
            className="w-full rounded-lg border border-line bg-white px-4 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
        )}
        <input
          name="email"
          type="email"
          required
          placeholder="Email"
          className="w-full rounded-lg border border-line bg-white px-4 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
        <input
          name="password"
          type="password"
          required
          placeholder="Пароль"
          className="w-full rounded-lg border border-line bg-white px-4 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
        {state?.error && <p className="text-sm text-red-500">{state.error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg brand-gradient px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {pending
            ? "Подождите…"
            : isLogin
            ? "Войти"
            : "Зарегистрироваться"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-500">
        {isLogin ? (
          <>
            Нет аккаунта?{" "}
            <Link href="/register" className="font-medium text-indigo-600">
              Создать
            </Link>
          </>
        ) : (
          <>
            Уже есть аккаунт?{" "}
            <Link href="/login" className="font-medium text-indigo-600">
              Войти
            </Link>
          </>
        )}
      </p>
      <p className="mt-4 text-center">
        <Link href="/" className="text-xs text-ink-500 hover:text-slate-900">
          ← На главную
        </Link>
      </p>
    </div>
  );
}
