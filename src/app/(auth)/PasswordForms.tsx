"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Logo } from "@/components/Logo";
import {
  changeTemporaryPasswordAction,
  requestPasswordResetAction,
  setPasswordAction,
  type AuthState,
} from "./actions";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(requestPasswordResetAction, undefined);
  return (
    <AuthShell title="Восстановление пароля" subtitle="Пришлём одноразовую ссылку для установки нового пароля.">
      <form action={action} className="space-y-3">
        <input name="email" type="email" autoComplete="email" required placeholder="Email" className="input" />
        {state?.error && <p aria-live="polite" className="text-sm text-red-600">{state.error}</p>}
        {state?.ok && <p aria-live="polite" className="rounded-lg bg-mint-50 px-3 py-2 text-sm text-mint-800">{state.ok}</p>}
        <button disabled={pending} className="w-full rounded-lg brand-gradient px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
          {pending ? "Отправляем…" : "Получить ссылку"}
        </button>
      </form>
      <BackToLogin />
    </AuthShell>
  );
}

export function SetPasswordForm({ token, requireTerms }: { token: string; requireTerms: boolean }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(setPasswordAction, undefined);
  return (
    <AuthShell title="Задайте новый пароль" subtitle="Используйте не меньше 8 символов.">
      <PasswordForm
        action={action}
        pending={pending}
        state={state}
        token={token}
        requireTerms={requireTerms}
        submitLabel="Сохранить и войти"
      />
      <BackToLogin />
    </AuthShell>
  );
}

export function ChangeTemporaryPasswordForm({ requireTerms }: { requireTerms: boolean }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(changeTemporaryPasswordAction, undefined);
  return (
    <AuthShell title="Замените временный пароль" subtitle="Перед началом работы задайте постоянный пароль.">
      <PasswordForm
        action={action}
        pending={pending}
        state={state}
        requireTerms={requireTerms}
        submitLabel="Сохранить и продолжить"
      />
      <p className="mt-5 text-center text-xs leading-5 text-ink-500">
        Если временный пароль стал известен посторонним, выйдите и воспользуйтесь восстановлением пароля.
      </p>
    </AuthShell>
  );
}

export function InvalidPasswordLink() {
  return (
    <AuthShell title="Ссылка не работает" subtitle="Она могла истечь или уже использоваться.">
      <Link href="/forgot-password" className="block w-full rounded-lg brand-gradient px-4 py-3 text-center text-sm font-semibold text-white">
        Получить новую ссылку
      </Link>
      <BackToLogin />
    </AuthShell>
  );
}

function PasswordForm({
  action,
  pending,
  state,
  token,
  requireTerms,
  submitLabel,
}: {
  action: (formData: FormData) => void;
  pending: boolean;
  state: AuthState;
  token?: string;
  requireTerms: boolean;
  submitLabel: string;
}) {
  const [showPassword, setShowPassword] = useState(false);
  return (
    <form action={action} className="space-y-3">
      {token !== undefined && <input type="hidden" name="token" value={token} />}
      <input name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={8} placeholder="Новый пароль" className="input" />
      <input name="passwordConfirmation" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={8} placeholder="Повторите пароль" className="input" />
      <button type="button" onClick={() => setShowPassword((value) => !value)} className="text-sm font-medium text-indigo-600">
        {showPassword ? "Скрыть пароль" : "Показать пароль"}
      </button>
      {requireTerms && (
        <label className="flex items-start gap-2 text-xs leading-5 text-ink-700">
          <input type="checkbox" name="acceptTerms" required className="mt-1" />
          <span>Я принимаю <Link href="/terms" target="_blank" className="text-indigo-600 underline">пользовательское соглашение</Link></span>
        </label>
      )}
      {state?.error && <p aria-live="polite" className="text-sm text-red-500">{state.error}</p>}
      <button disabled={pending} className="w-full rounded-lg brand-gradient px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
        {pending ? "Сохраняем…" : submitLabel}
      </button>
    </form>
  );
}

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12">
      <div className="mb-8 text-center">
        <div className="flex justify-center"><Logo /></div>
        <h1 className="mt-6 text-2xl font-bold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm text-ink-500">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function BackToLogin() {
  return <p className="mt-6 text-center text-sm"><Link href="/login" className="font-medium text-indigo-600">Вернуться ко входу</Link></p>;
}
