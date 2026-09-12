"use client";

import { useState, useTransition } from "react";
import { approveQueuedCampaignMessage, cancelQueuedCampaignMessage, updateQueuedCampaignMessage } from "@/app/(app)/app/inbox/actions";

export function QueuedCampaignMessage({
  messageId,
  initialSubject,
  initialBody,
  reason,
  canEdit,
  canCancel,
  requiresManualReview = false,
}: {
  messageId: string;
  initialSubject: string;
  initialBody: string;
  reason: string;
  canEdit: boolean;
  canCancel: boolean;
  requiresManualReview?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [savedSubject, setSavedSubject] = useState(initialSubject);
  const [savedBody, setSavedBody] = useState(initialBody);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const emptyDraft = !subject.trim() || !body.trim();
  const unchangedReviewDraft = requiresManualReview && subject.trim() === savedSubject && body.trim() === savedBody;

  function save() {
    const data = new FormData();
    data.set("messageId", messageId);
    data.set("subject", subject);
    data.set("body", body);
    startTransition(async () => {
      const result = await updateQueuedCampaignMessage(data);
      setNotice(result.error ?? result.ok ?? null);
      if (result.ok) {
        setSavedSubject(subject);
        setSavedBody(body);
        setEditing(false);
      }
    });
  }

  function cancel() {
    if (!window.confirm("Отменить отправку этого письма?")) return;
    const data = new FormData();
    data.set("messageId", messageId);
    startTransition(async () => {
      const result = await cancelQueuedCampaignMessage(data);
      setNotice(result.error ?? result.ok ?? null);
    });
  }

  function approve() {
    if (!window.confirm("Письмо не прошло автоматическую проверку. Отправить текущий текст вручную?")) return;
    const data = new FormData();
    data.set("messageId", messageId);
    startTransition(async () => {
      const result = await approveQueuedCampaignMessage(data);
      setNotice(result.error ?? result.ok ?? null);
    });
  }

  return (
    <section className={`mb-5 ml-auto max-w-[48rem] overflow-hidden rounded-2xl border shadow-sm ${requiresManualReview ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-[#fffaf0]"}`}>
      <div className={`flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4 ${requiresManualReview ? "border-rose-200" : "border-amber-200/70"}`}>
        <div>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${requiresManualReview ? "bg-rose-600" : "bg-amber-500"}`} />
            <p className={`text-sm font-semibold ${requiresManualReview ? "text-rose-950" : "text-amber-950"}`}>{requiresManualReview ? "Не прошло проверку" : "Пока не отправили"}</p>
          </div>
          <p className={`mt-1 pl-4 text-xs leading-5 ${requiresManualReview ? "text-rose-900/80" : "text-amber-900/75"}`}>{reason}</p>
        </div>
        <div className="flex gap-2">
          {canEdit && !editing && <button type="button" onClick={() => { setSubject(savedSubject); setBody(savedBody); setEditing(true); }} className={`rounded-lg border bg-white px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-300 ${requiresManualReview ? "border-rose-300 text-rose-800 hover:bg-rose-100/60" : "border-amber-200 text-slate-900 hover:border-amber-300"}`}>{requiresManualReview ? "Исправить письмо" : "Редактировать"}</button>}
          {canEdit && requiresManualReview && !editing && <button type="button" onClick={approve} disabled={pending} className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">Отправить вручную</button>}
          {canCancel && <button type="button" onClick={cancel} disabled={pending} className="rounded-lg border border-transparent px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50">Отменить</button>}
        </div>
      </div>
      {editing ? (
        <div className="space-y-3 p-5">
          <label className="block"><span className="text-xs font-medium text-ink-500">Тема</span><input value={subject} onChange={(event) => setSubject(event.target.value)} className="input mt-1.5" /></label>
          <label className="block"><span className="text-xs font-medium text-ink-500">Письмо</span><textarea value={body} onChange={(event) => setBody(event.target.value)} rows={9} className="input mt-1.5 text-sm leading-6" /></label>
          <div className="flex gap-2"><button type="button" onClick={save} disabled={pending || emptyDraft || unchangedReviewDraft} className="rounded-lg bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50">{pending ? "Сохраняем…" : requiresManualReview ? "Исправить и отправить" : "Сохранить"}</button><button type="button" onClick={() => { setSubject(savedSubject); setBody(savedBody); setEditing(false); }} className="rounded-lg border border-line bg-white px-4 py-2.5 text-xs font-semibold text-ink-700">Не менять</button></div>
        </div>
      ) : (
        <article className="p-5">
          <p className="text-xs text-ink-500">Вы</p>
          <h3 className="mt-2 text-sm font-semibold text-slate-900">{savedSubject}</h3>
          <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-ink-700">{savedBody}</div>
        </article>
      )}
      {notice && <p role="status" className={`border-t px-5 py-2.5 text-xs ${requiresManualReview ? "border-rose-200 text-rose-900" : "border-amber-200/70 text-amber-900"}`}>{notice}</p>}
    </section>
  );
}
