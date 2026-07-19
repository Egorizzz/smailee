"use client";

/**
 * Редактор черновика ИИ-ответа перед отправкой (§5.5, режим модерации).
 *
 * Раньше выбор был бинарный: отправить как есть или не отправлять вовсе. ИИ
 * ошибается в конкретике (цена, сроки, условия) — из-за одной неверной цифры
 * приходилось отклонять весь ответ и писать клиенту руками мимо системы.
 * Теперь текст правится прямо здесь и уходит уже утверждённым.
 */

import { useState } from "react";

export function DraftReplyEditor({
  replyId,
  initialBody,
  action,
}: {
  replyId: string;
  initialBody: string;
  action: (formData: FormData) => void;
}) {
  const [body, setBody] = useState(initialBody);
  const [editing, setEditing] = useState(false);
  const edited = body.trim() !== initialBody.trim();

  return (
    <form action={action} className="mt-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
      <input type="hidden" name="replyId" value={replyId} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-amber-800">
          Ответ ИИ готов, но не отправлен
          {edited && " · есть правки"}
        </span>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="shrink-0 rounded-md border border-amber-300 px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
        >
          {editing ? "Свернуть" : "Редактировать"}
        </button>
      </div>

      {editing ? (
        <textarea
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          className="input mt-2 w-full text-xs leading-relaxed"
        />
      ) : (
        // текст всё равно уходит в форму — иначе правки терялись бы при сворачивании
        <>
          <input type="hidden" name="body" value={body} />
          <div className="mt-2 max-h-40 overflow-y-auto whitespace-pre-line rounded-lg bg-white/70 p-2 text-xs leading-relaxed text-ink-700">
            {body}
          </div>
        </>
      )}

      <div className="mt-2 flex items-center gap-2">
        <button className="rounded-lg brand-gradient px-3 py-1.5 text-xs font-semibold text-white">
          {edited ? "Отправить с правками" : "Одобрить и отправить"}
        </button>
        {edited && (
          <button
            type="button"
            onClick={() => setBody(initialBody)}
            className="text-[11px] text-ink-500 underline underline-offset-2 hover:text-slate-900"
          >
            Вернуть текст ИИ
          </button>
        )}
      </div>
    </form>
  );
}
