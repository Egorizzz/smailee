"use client";

import { useActionState, useState } from "react";
import { requestEmailChange, requestPasswordChange, resendEmailVerification, type CredentialState } from "./actions";

function Result({ state }: { state: CredentialState }) {
  if (state?.error) return <p className="mt-3 text-sm text-red-600">{state.error}</p>;
  if (state?.ok) return <p className="mt-3 text-sm text-mint-700">{state.ok}</p>;
  return null;
}

export function SecurityForm({ email, verified, passwordEnabled }: { email: string; verified: boolean; passwordEnabled: boolean }) {
  const [emailState, emailAction, emailPending] = useActionState<CredentialState, FormData>(requestEmailChange, undefined);
  const [passwordState, passwordAction, passwordPending] = useActionState<CredentialState, FormData>(requestPasswordChange, undefined);
  const [verificationState, verificationAction, verificationPending] = useActionState<CredentialState, FormData>(resendEmailVerification, undefined);
  const [showPassword, setShowPassword] = useState(false);
  return <div className="mt-6 space-y-5">
    <section className="rounded-xl border border-line bg-white p-5">
      <h2 className="text-lg font-semibold text-slate-900">Email для входа</h2>
      <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-sm text-slate-900">{email}</span><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${verified ? "bg-mint-100 text-mint-700" : "bg-red-50 text-red-700"}`}>{verified ? "Подтверждён" : "Не подтверждён"}</span></div>
      {!verified && <form action={verificationAction} className="mt-4"><button disabled={verificationPending} className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700">{verificationPending ? "Отправляем…" : "Отправить письмо для подтверждения"}</button><Result state={verificationState} /></form>}
      <form action={emailAction} className="mt-5 space-y-3 border-t border-line pt-5"><label className="block"><span className="text-sm font-medium text-slate-900">Изменить email</span><input name="email" type="email" autoComplete="email" required className="input mt-2" placeholder="Новый рабочий email" /></label><p className="text-xs leading-5 text-ink-500">Новый адрес начнёт действовать только после перехода по ссылке из письма.</p><Result state={emailState} /><button disabled={emailPending} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-900">{emailPending ? "Отправляем…" : "Подтвердить новый email"}</button></form>
    </section>
    <form action={passwordAction} className="rounded-xl border border-line bg-white p-5"><h2 className="text-lg font-semibold text-slate-900">Пароль <span className="ml-2 text-sm font-normal text-ink-500">{passwordEnabled ? "установлен" : "не установлен"}</span></h2><p className="mt-1 text-sm leading-6 text-ink-500">Пароль не обязателен: основной способ входа — одноразовая ссылка на email.</p><div className="mt-4 space-y-3"><input name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={8} className="input" placeholder={passwordEnabled ? "Новый пароль" : "Придумайте пароль"} /><input name="passwordConfirmation" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={8} className="input" placeholder="Повторите пароль" /></div><button type="button" onClick={() => setShowPassword((value) => !value)} className="mt-2 text-sm font-medium text-mint-700">{showPassword ? "Скрыть пароль" : "Показать пароль"}</button><Result state={passwordState} /><button disabled={passwordPending} className="mt-4 block rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white">{passwordPending ? "Отправляем…" : passwordEnabled ? "Изменить пароль" : "Установить пароль"}</button></form>
  </div>;
}
