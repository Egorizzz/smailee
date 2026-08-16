"use client";

import { useState } from "react";

export function DraftReplyEditor({ replyId, initialBody, action }: { replyId: string; initialBody: string; action: (formData: FormData) => void }) {
  const [body, setBody] = useState(initialBody);
  const [editing, setEditing] = useState(false);
  const edited = body.trim() !== initialBody.trim();
  return (
    <form action={action} className="mb-5 ml-auto max-w-[86%] rounded-2xl rounded-tr-md border border-amber-200 bg-amber-50 p-4 shadow-sm sm:max-w-[72%]">
      <input type="hidden" name="replyId" value={replyId} />
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-xs font-semibold text-amber-900">Ответ готов</p><p className="mt-0.5 text-[11px] text-amber-800/70">Проверьте и отправьте клиенту</p></div>
        <button type="button" onClick={() => setEditing((value) => !value)} className="shrink-0 rounded-full border border-amber-300 bg-white/70 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-white">{editing ? "Готово" : "Редактировать"}</button>
      </div>
      {editing ? (
        <textarea name="body" value={body} onChange={(event) => setBody(event.target.value)} rows={7} autoFocus className="input mt-3 w-full resize-y bg-white text-sm leading-relaxed" />
      ) : (
        <><input type="hidden" name="body" value={body} /><div className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-800">{body}</div></>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800">{edited ? "Отправить с правками" : "Одобрить и отправить"}</button>
        {edited && <button type="button" onClick={() => setBody(initialBody)} className="text-xs font-medium text-ink-500 hover:text-slate-900">Вернуть исходный текст</button>}
      </div>
    </form>
  );
}
