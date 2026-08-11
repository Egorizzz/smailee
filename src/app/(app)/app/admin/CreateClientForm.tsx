"use client";

import { useActionState } from "react";
import { adminCreateClient, type AdminActionState } from "./actions";

export function CreateClientForm({
  defaultEmail,
  defaultName,
  defaultCompany,
}: {
  defaultEmail?: string;
  defaultName?: string;
  defaultCompany?: string;
}) {
  const [state, formAction, pending] = useActionState<AdminActionState, FormData>(
    adminCreateClient,
    undefined
  );

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2">
      <input name="email" type="email" required placeholder="Email клиента" className="input" defaultValue={defaultEmail} key={`e-${defaultEmail}`} />
      <input name="name" placeholder="Имя (по желанию)" className="input" defaultValue={defaultName} key={`n-${defaultName}`} />
      <input name="companyName" placeholder="Компания (по желанию)" className="input sm:col-span-2" defaultValue={defaultCompany} key={`c-${defaultCompany}`} />
      <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs leading-5 text-indigo-800 sm:col-span-2">
        Создастся кабинет организации с демо-доступом на 14 дней и лимитом до 2 000 контактов. Пароль сгенерируется и отправится клиенту по email — в админке он не показывается.
      </p>
      {state?.error && (
        <p className="text-sm text-red-500 sm:col-span-2">{state.error}</p>
      )}
      {state?.ok && (
        <p className="text-sm text-mint-700 sm:col-span-2">{state.ok}</p>
      )}
      <button
        disabled={pending}
        className="rounded-lg brand-gradient-vivid px-5 py-2.5 text-sm font-semibold text-white glow disabled:opacity-60 sm:col-span-2"
      >
        {pending ? "Создаём…" : "Создать кабинет клиента"}
      </button>
    </form>
  );
}
