"use client";

import { useState, useTransition } from "react";
import { sendLeadToTelegram, toggleLeadProcessed } from "@/app/(app)/app/leads/actions";

function ActionButton({ leadId, action, idle, pendingText, className }: { leadId: string; action: (data: FormData) => Promise<{ ok?: string; error?: string }>; idle: string; pendingText: string; className: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  return <div><button type="button" disabled={pending} onClick={() => startTransition(async () => { const data = new FormData(); data.set("leadId", leadId); const result = await action(data); setMessage({ text: result.error ?? result.ok ?? "Готово", error: Boolean(result.error) }); })} className={className}>{pending ? pendingText : idle}</button>{message && <p className={`mt-1 text-xs ${message.error ? "text-red-600" : "text-mint-700"}`}>{message.text}</p>}</div>;
}

export function TelegramLeadButton({ leadId }: { leadId: string }) {
  return <ActionButton leadId={leadId} action={sendLeadToTelegram} idle="Отправить в Telegram" pendingText="Отправляем…" className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700 disabled:opacity-50" />;
}

export function ProcessedLeadButton({ leadId, processed }: { leadId: string; processed: boolean }) {
  return <ActionButton leadId={leadId} action={toggleLeadProcessed} idle={processed ? "Вернуть в работу" : "Отметить обработанным"} pendingText="Сохраняем…" className="h-9 rounded-lg border border-line bg-white px-3 text-xs font-semibold text-ink-700 shadow-sm transition hover:bg-surface disabled:opacity-50" />;
}
