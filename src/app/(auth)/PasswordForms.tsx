"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Logo } from "@/components/Logo";
import { requestPasswordResetAction, setPasswordAction, type AuthState } from "./actions";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(requestPasswordResetAction, undefined);
  return (
    <AuthShell title="Восстановление пароля" subtitle="Пришлём ссылку для установки нового пароля.">
      <form action={action} className="space-y-3">
        <input name="email" type="email" required placeholder="Email" className="input" />
        {state?.error && <p className="text-sm text-ink-500">{state.error}</p>}
        <button disabled={pending} className="w-full rounded-lg brand-gradient px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
          {pending ? "Отправляем…" : "Получить ссылку"}
        </button>
      </form>
      <BackToLogin />
    </AuthShell>
  );
}

export function SetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(setPasswordAction, undefined);
  const [showPassword, setShowPassword] = useState(false);
  return (
    <AuthShell title="Задайте пароль" subtitle="Придумайте пароль не короче 8 символов.">
      <form action={action} className="space-y-3">
        <input type="hidden" name="token" value={token} />
        <input name="password" type={showPassword ? "text" : "password"} required minLength={8} placeholder="Новый пароль" className="input" />
        <input name="passwordConfirmation" type={showPassword ? "text" : "password"} required minLength={8} placeholder="Повторите пароль" className="input" />
        <button type="button" onClick={() => setShowPassword((value) => !value)} className="text-sm font-medium text-indigo-600">{showPassword ? "Скрыть пароль" : "Показать пароль"}</button>
        {state?.error && <p className="text-sm text-red-500">{state.error}</p>}
        <button disabled={pending} className="w-full rounded-lg brand-gradient px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
          {pending ? "Сохраняем…" : "Сохранить и войти"}
        </button>
      </form>
      <BackToLogin />
    </AuthShell>
  );
}

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12"><div className="mb-8 text-center"><div className="flex justify-center"><Logo /></div><h1 className="mt-6 text-2xl font-bold text-slate-900">{title}</h1><p className="mt-2 text-sm text-ink-500">{subtitle}</p></div>{children}</div>;
}

function BackToLogin() {
  return <p className="mt-6 text-center text-sm"><Link href="/login" className="font-medium text-indigo-600">Вернуться ко входу</Link></p>;
}
