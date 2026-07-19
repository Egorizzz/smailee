"use client";

/**
 * EmailThread — отображение переписки как EMAIL-тред (не чат).
 * Показывает: тема, From/To, время, тело. Отражает реальность: общение идёт
 * по почте, клиент отвечает из своего ящика, AI формирует ответное письмо.
 *
 * Тело ВХОДЯЩЕГО письма прогоняется через parseReplyBody: почтовые клиенты
 * подклеивают к ответу всю прошлую переписку и служебную обвязку, а HTML-письма
 * без текстовой части приходили в тред сырой разметкой. Цитата прячется под
 * кнопку «Показать предыдущую переписку».
 */

import { useState } from "react";
import { parseReplyBody } from "@/lib/mail/quotedText";

type ThreadItem = {
  id: string;
  direction: string; // inbound | outbound
  subject?: string | null;
  fromEmail?: string | null;
  toEmail?: string | null;
  body: string;
  isAi: boolean;
  status?: string; // DRAFT | SENT — для outbound AI-ответов (режим модерации, §5.5)
  createdAt: Date;
};

function MessageBody({ body, inbound }: { body: string; inbound: boolean }) {
  const [showQuoted, setShowQuoted] = useState(false);
  // режем только входящие: исходящие мы формируем сами, цитат там нет
  const { visible, quoted } = inbound
    ? parseReplyBody(body)
    : { visible: body, quoted: "" };

  return (
    <div className="text-xs leading-relaxed text-ink-700">
      <div className="whitespace-pre-line">{visible}</div>
      {quoted && (
        <>
          <button
            type="button"
            onClick={() => setShowQuoted((v) => !v)}
            className="mt-2 rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-ink-500 hover:border-ink-300 hover:text-slate-900"
          >
            {showQuoted ? "Скрыть предыдущую переписку" : "Показать предыдущую переписку"}
          </button>
          {showQuoted && (
            <div className="mt-2 max-h-64 overflow-y-auto whitespace-pre-line border-l-2 border-line pl-3 text-[11px] text-ink-500">
              {quoted}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function EmailThread({ thread }: { thread: ThreadItem[] }) {
  if (thread.length === 0) return null;
  return (
    <div className="mt-3 space-y-2 border-t border-line pt-3">
      {thread.map((t) => {
        const inbound = t.direction === "inbound";
        return (
          <div
            key={t.id}
            className={`overflow-hidden rounded-xl border ${
              inbound ? "border-line bg-white" : "border-indigo-100 bg-indigo-50/40"
            }`}
          >
            {/* заголовок письма */}
            <div className="flex items-center justify-between gap-2 border-b border-line/70 px-3 py-2">
              <div className="flex items-center gap-2 text-xs">
                <span
                  className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white ${
                    inbound ? "bg-slate-400" : "brand-gradient"
                  }`}
                >
                  {inbound ? "К" : t.isAi ? "AI" : "Я"}
                </span>
                <span className="font-medium text-slate-900">
                  {inbound ? "Клиент" : t.isAi ? "Smailee AI" : "Вы"}
                </span>
                <span className="text-ink-500">
                  {t.fromEmail ? `<${t.fromEmail}>` : ""}
                </span>
                {t.status === "DRAFT" && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                    Черновик — ждёт одобрения
                  </span>
                )}
              </div>
              <time className="shrink-0 text-[11px] text-ink-500">
                {new Date(t.createdAt).toLocaleString("ru-RU", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </div>
            {/* тема + тело */}
            <div className="px-3 py-2">
              {t.subject && (
                <div className="mb-1 text-xs font-semibold text-ink-700">
                  {t.subject}
                </div>
              )}
              <MessageBody body={t.body} inbound={inbound} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
