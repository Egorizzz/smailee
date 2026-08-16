"use client";

import { useState, useTransition } from "react";
import { sendManualInboxReply } from "@/app/(app)/app/inbox/actions";

export function InboxReplyComposer({ messageId }: { messageId: string }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok?: string; error?: string } | null>(null);

  if (!open) {
    return <div className="border-t border-line bg-white px-5 py-3"><button type="button" onClick={() => setOpen(true)} className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm hover:bg-surface">Написать самому</button></div>;
  }

  return (
    <div className="border-t border-line bg-white px-5 py-4">
      <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={4} autoFocus placeholder="Напишите ответ…" className="input w-full resize-y text-sm leading-relaxed" />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className={`text-xs ${result?.error ? "text-red-600" : "text-mint-700"}`}>{result?.error ?? result?.ok}</span>
        <div className="flex items-center gap-2">
          <button type="button" disabled={pending} onClick={() => { setOpen(false); setBody(""); setResult(null); }} className="rounded-full px-4 py-2 text-sm font-medium text-ink-500 hover:bg-surface">Отмена</button>
          <button type="button" disabled={pending || !body.trim()} onClick={() => startTransition(async () => { const data = new FormData(); data.set("messageId", messageId); data.set("body", body); const response = await sendManualInboxReply(data); setResult(response); if (response.ok) { setBody(""); setOpen(false); } })} className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">{pending ? "Отправляем…" : "Отправить"}</button>
        </div>
      </div>
    </div>
  );
}
