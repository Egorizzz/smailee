"use client";

import { useState } from "react";
import { parseReplyBody } from "@/lib/mail/quotedText";

export type InboxTimelineItem = {
  id: string;
  direction: string;
  subject?: string | null;
  fromEmail?: string | null;
  toEmail?: string | null;
  body: string;
  isAi: boolean;
  status?: string;
  createdAt: Date;
};

function MessageBody({ body, inbound }: { body: string; inbound: boolean }) {
  const [showQuoted, setShowQuoted] = useState(false);
  const { visible, quoted } = inbound ? parseReplyBody(body) : { visible: body, quoted: "" };
  return (
    <div className="text-sm leading-relaxed text-slate-800">
      <div className="whitespace-pre-line">{visible}</div>
      {quoted && (
        <div className="mt-2">
          <button type="button" onClick={() => setShowQuoted((value) => !value)} className="text-xs font-medium text-ink-500 underline decoration-slate-300 underline-offset-4 hover:text-slate-900">
            {showQuoted ? "Скрыть цитату" : "Показать предыдущую переписку"}
          </button>
          {showQuoted && <div className="mt-2 max-h-64 overflow-y-auto whitespace-pre-line border-l-2 border-slate-200 pl-3 text-xs leading-relaxed text-ink-500">{quoted}</div>}
        </div>
      )}
    </div>
  );
}

function dayLabel(date: Date) {
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Сегодня";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Вчера";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

export function EmailThread({ thread }: { thread: InboxTimelineItem[] }) {
  const sent = thread.filter((item) => item.status !== "DRAFT");
  if (!sent.length) return null;
  let previousDay = "";
  return (
    <div className="space-y-2 py-5">
      {sent.map((item) => {
        const inbound = item.direction === "inbound";
        const day = new Date(item.createdAt).toDateString();
        const showDay = day !== previousDay;
        previousDay = day;
        return (
          <div key={item.id}>
            {showDay && (
              <div className="my-4 flex justify-center">
                <span className="metric-number rounded-full border border-white/80 bg-white/85 px-3 py-1 text-[11px] font-medium text-ink-500 shadow-sm backdrop-blur">{dayLabel(new Date(item.createdAt))}</span>
              </div>
            )}
            <div className={`flex ${inbound ? "justify-start" : "justify-end"}`}>
              <article className={`relative max-w-[86%] px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.08)] sm:max-w-[72%] ${inbound ? "rounded-[1.15rem] rounded-tl-md border border-white bg-white" : "rounded-[1.15rem] rounded-tr-md border border-mint-200 bg-[#daf5e8]"}`}>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className={`text-xs font-semibold ${inbound ? "text-slate-700" : "text-mint-800"}`}>{inbound ? "Клиент" : "Вы"}</span>
                </div>
                <MessageBody body={item.body} inbound={inbound} />
                <div className={`metric-number mt-1.5 flex justify-end text-[10px] ${inbound ? "text-ink-500" : "text-mint-800/70"}`}>
                  {new Date(item.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                  {!inbound && <span className="ml-1 font-semibold">✓✓</span>}
                </div>
              </article>
            </div>
          </div>
        );
      })}
    </div>
  );
}
