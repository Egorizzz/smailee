"use client";

import { useActionState } from "react";
import { adminCreateClient, type AdminActionState } from "./actions";

export function CreateClientForm({
  defaultEmail,
  defaultName,
}: {
  defaultEmail?: string;
  defaultName?: string;
}) {
  const [state, formAction, pending] = useActionState<AdminActionState, FormData>(
    adminCreateClient,
    undefined
  );

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2">
      <input name="email" type="email" required placeholder="email клиента" className="input" defaultValue={defaultEmail} key={`e-${defaultEmail}`} />
      <input name="name" placeholder="Имя (по желанию)" className="input" defaultValue={defaultName} key={`n-${defaultName}`} />
      <input name="password" required placeholder="Пароль (мин. 6 символов)" className="input" />
      <select name="plan" className="input">
        <option value="TRIAL">Пробный</option>
        <option value="START">Старт</option>
        <option value="PRO">Про</option>
      </select>
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
