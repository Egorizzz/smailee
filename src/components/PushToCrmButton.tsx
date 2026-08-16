"use client";

/**
 * Ручная передача лида в CRM — минуя ИИ-квалификацию (§«интеграция с
 * Битрикс24»). Оператор может передать в CRM любого лида, даже если ни один
 * из настроенных триггеров ещё не сработал: это его прямое решение, ИИ здесь
 * не спрашивают. Закрывает линию так же, как автоматическая передача.
 */

import { useState, useTransition } from "react";
import { pushLeadManually } from "@/app/(app)/app/settings/crmActions";

export function PushToCrmButton({ leadId }: { leadId: string }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  function handleClick() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("leadId", leadId);
      const res = await pushLeadManually(fd);
      setMsg(res.error ? { text: res.error, ok: false } : { text: res.ok ?? "Готово", ok: true });
    });
  }

  // Успех прячет саму кнопку — страница перевалидируется (revalidatePath) и
  // на следующем рендере появится обычный бейдж "→ в Битрикс24", дублировать
  // его здесь не нужно.
  if (msg?.ok) return <span className="text-xs text-mint-700">{msg.text}</span>;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded-lg border border-mint-200 bg-mint-50 px-3 py-2 text-xs font-semibold text-mint-700 hover:border-mint-400 disabled:opacity-50"
      >
        {pending ? "Передаём…" : "Передать в CRM"}
      </button>
      {msg && !msg.ok && <span className="max-w-[220px] text-right text-xs text-red-600">{msg.text}</span>}
    </div>
  );
}
