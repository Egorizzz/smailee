"use client";

import { useState, useTransition } from "react";
import { updateScheduledAutoPingDraft } from "@/app/(app)/app/inbox/actions";

type Props = {
  messageId: string;
  replyId: string;
  initialBody: string;
  scheduledAt: string;
  canEdit: boolean;
};

function scheduledLabel(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function ScheduledAutoPingDraft({ messageId, replyId, initialBody, scheduledAt, canEdit }: Props) {
  const [body, setBody] = useState(initialBody);
  const [savedBody, setSavedBody] = useState(initialBody);
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const changed = body.trim() !== savedBody.trim();

  function save() {
    setResult(null);
    startTransition(async () => {
      const data = new FormData();
      data.set("messageId", messageId);
      data.set("replyId", replyId);
      data.set("body", body);
      const response = await updateScheduledAutoPingDraft(data);
      setResult(response);
      if (response.ok) {
        setSavedBody(body.trim());
        setBody(body.trim());
        setEditing(false);
      }
    });
  }

  function cancel() {
    setBody(savedBody);
    setResult(null);
    setEditing(false);
  }

  return (
    <div className="mb-5 ml-auto max-w-[86%] rounded-[1.15rem] rounded-tr-md border border-dashed border-mint-300 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.08)] sm:max-w-[72%]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-mint-800">Вы</span>
          <span className="rounded-full bg-mint-50 px-2 py-0.5 text-[10px] font-semibold text-mint-800">Автопинг</span>
          <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-medium text-ink-500">Черновик</span>
        </div>
        {canEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-800 transition hover:bg-surface">
            Редактировать
          </button>
        )}
      </div>

      <div className="metric-number mt-2 flex items-center gap-1.5 text-[11px] font-medium text-mint-800">
        <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2.5" y="3.5" width="11" height="10" rx="2"/><path d="M5 2v3M11 2v3M2.5 6.5h11" strokeLinecap="round"/></svg>
        Отправка {scheduledLabel(scheduledAt)} МСК
      </div>

      {editing ? (
        <div className="mt-3">
          <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={6} autoFocus className="input w-full resize-y bg-white text-sm leading-relaxed" />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" disabled={pending || !body.trim() || !changed} onClick={save} className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40">
              {pending ? "Сохраняем…" : "Сохранить"}
            </button>
            <button type="button" disabled={pending} onClick={cancel} className="rounded-lg border border-line bg-white px-3.5 py-2 text-xs font-semibold text-ink-700 transition hover:bg-surface disabled:opacity-40">Отмена</button>
          </div>
        </div>
      ) : (
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-800">{savedBody}</p>
      )}

      <p className="mt-3 border-t border-line pt-2.5 text-[11px] leading-relaxed text-ink-500">Если клиент ответит раньше, этот черновик автоматически отменится.</p>
      {result?.error && <p className="mt-2 text-xs text-red-600">{result.error}</p>}
      {result?.ok && !editing && <p className="mt-2 text-xs font-medium text-mint-700">{result.ok}</p>}
    </div>
  );
}
