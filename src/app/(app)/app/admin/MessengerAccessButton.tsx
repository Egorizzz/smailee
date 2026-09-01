"use client";

import { useActionState, useEffect, useState } from "react";
import { adminCreateMessengerAccess, type AdminActionState } from "./actions";

export function MessengerAccessButton({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState<AdminActionState, FormData>(adminCreateMessengerAccess, undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!state?.accessMessage) return;
    navigator.clipboard.writeText(state.accessMessage).then(() => setCopied(true)).catch(() => setCopied(false));
  }, [state?.accessMessage]);

  return (
    <form action={action}>
      <input type="hidden" name="userId" value={userId} />
      <button disabled={pending} className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-surface disabled:opacity-60">
        {pending ? "Готовим…" : copied ? "Ссылка скопирована" : "Ссылка для мессенджера"}
      </button>
      {state?.error && <p className="mt-1 max-w-44 text-xs text-red-600">{state.error}</p>}
      {state?.accessMessage && !copied && <textarea readOnly value={state.accessMessage} className="mt-2 h-24 w-64 rounded-lg border border-line p-2 text-xs" aria-label="Сообщение для клиента" />}
    </form>
  );
}
