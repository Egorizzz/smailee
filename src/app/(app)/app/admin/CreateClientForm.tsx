"use client";

import { useActionState, useMemo, useState } from "react";
import { adminCreateClient, type AdminActionState } from "./actions";

type EmailSuggestion = { email: string; label: string; name: string; company: string };

export function CreateClientForm({
  defaultEmail,
  defaultName,
  defaultCompany,
  emailSuggestions = [],
}: {
  defaultEmail?: string;
  defaultName?: string;
  defaultCompany?: string;
  emailSuggestions?: EmailSuggestion[];
}) {
  const initialSuggestion = defaultEmail ? emailSuggestions.find((item) => item.email === defaultEmail) : undefined;
  const [source, setSource] = useState(initialSuggestion?.email ?? (defaultEmail ? "manual" : ""));
  const [manualEmail, setManualEmail] = useState(defaultEmail ?? "");
  const [manualName, setManualName] = useState(defaultName ?? "");
  const [manualCompany, setManualCompany] = useState(defaultCompany ?? "");
  const selectedSuggestion = useMemo(() => emailSuggestions.find((item) => item.email === source), [emailSuggestions, source]);
  const currentEmail = selectedSuggestion?.email ?? (source === "manual" ? manualEmail : "");
  const [delivery, setDelivery] = useState<"email" | "copy">(defaultEmail ? "email" : "copy");
  const [state, formAction, pending] = useActionState<AdminActionState, FormData>(adminCreateClient, undefined);
  const [copyStatus, setCopyStatus] = useState("");

  function changeSource(value: string) {
    setSource(value);
    if (emailSuggestions.some((item) => item.email === value)) setDelivery("email");
    if (value === "manual" && !manualEmail) setDelivery("copy");
  }

  async function copyAccess() {
    if (!state?.accessMessage) return;
    await navigator.clipboard.writeText(state.accessMessage);
    setCopyStatus("Сообщение скопировано — вставьте его в мессенджер");
  }

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <label className="block sm:col-span-2">
        <span className="text-sm font-medium text-slate-900">Клиент</span>
        <select value={source} onChange={(event) => changeSource(event.target.value)} className="input mt-2 w-full">
          <option value="">Выберите последнюю заявку</option>
          {emailSuggestions.map((suggestion) => <option key={suggestion.email} value={suggestion.email}>{suggestion.label}</option>)}
          <option value="manual">Ввести данные вручную</option>
        </select>
      </label>

      {selectedSuggestion ? (
        <div className="rounded-xl border border-mint-200 bg-mint-50 p-4 sm:col-span-2">
          <p className="text-sm font-semibold text-slate-900">{selectedSuggestion.name}</p>
          <p className="mt-1 text-sm text-ink-700">{selectedSuggestion.company || "Компания не указана"} · {selectedSuggestion.email}</p>
          <input type="hidden" name="email" value={selectedSuggestion.email} />
          <input type="hidden" name="name" value={selectedSuggestion.name} />
          <input type="hidden" name="companyName" value={selectedSuggestion.company} />
        </div>
      ) : source === "manual" ? (
        <>
          <input name="email" type="email" placeholder="Email клиента, если известен" className="input" value={manualEmail} onChange={(event) => {
            setManualEmail(event.target.value);
            if (!event.target.value && delivery === "email") setDelivery("copy");
          }} />
          <input name="name" placeholder="Имя" className="input" value={manualName} onChange={(event) => setManualName(event.target.value)} />
          <input name="companyName" placeholder="Компания" className="input sm:col-span-2" value={manualCompany} onChange={(event) => setManualCompany(event.target.value)} />
        </>
      ) : (
        <p className="rounded-lg bg-surface px-3 py-3 text-sm text-ink-500 sm:col-span-2">Выберите заявку или ручной ввод.</p>
      )}

      <fieldset className="sm:col-span-2">
        <legend className="text-sm font-medium text-slate-900">Как передать доступ</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className={`rounded-xl border p-4 ${delivery === "email" ? "border-mint-400 bg-mint-50" : "border-line bg-white"} ${!currentEmail ? "opacity-50" : "cursor-pointer"}`}>
            <input type="radio" name="delivery" value="email" checked={delivery === "email"} onChange={() => setDelivery("email")} disabled={!currentEmail} />
            <span className="ml-2 text-sm font-semibold text-slate-900">Отправить по email</span>
            <span className="mt-1 block pl-5 text-xs leading-5 text-ink-500">Smailee отправит клиенту одноразовую ссылку.</span>
          </label>
          <label className={`cursor-pointer rounded-xl border p-4 ${delivery === "copy" ? "border-mint-400 bg-mint-50" : "border-line bg-white"}`}>
            <input type="radio" name="delivery" value="copy" checked={delivery === "copy"} onChange={() => setDelivery("copy")} />
            <span className="ml-2 text-sm font-semibold text-slate-900">Скопировать сообщение</span>
            <span className="mt-1 block pl-5 text-xs leading-5 text-ink-500">После создания появится готовый текст для мессенджера.</span>
          </label>
        </div>
      </fieldset>

      <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs leading-5 text-indigo-800 sm:col-span-2">
        Клиент войдёт по одноразовой ссылке без логина и пароля. Постоянные данные для входа он настроит самостоятельно в кабинете.
      </p>
      {state?.error && <p className="text-sm text-red-500 sm:col-span-2">{state.error}</p>}
      {state?.ok && <p className="text-sm text-mint-700 sm:col-span-2">{state.ok}</p>}
      {state?.accessMessage && (
        <div className="rounded-xl border border-mint-200 bg-mint-50 p-4 sm:col-span-2">
          <p className="text-sm font-semibold text-mint-800">Сообщение для клиента</p>
          <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-xs leading-5 text-ink-700">{state.accessMessage}</pre>
          <button type="button" onClick={copyAccess} className="mt-4 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">Скопировать сообщение</button>
          {copyStatus && <p aria-live="polite" className="mt-2 text-xs text-mint-800">{copyStatus}</p>}
        </div>
      )}
      <button disabled={pending || !source} className="rounded-lg brand-gradient-vivid px-5 py-2.5 text-sm font-semibold text-white glow disabled:opacity-60 sm:col-span-2">
        {pending ? "Создаём…" : delivery === "email" ? "Создать кабинет и отправить ссылку" : "Создать кабинет"}
      </button>
    </form>
  );
}
