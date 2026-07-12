/**
 * EmailThread — отображение переписки как EMAIL-тред (не чат).
 * Показывает: тема, From/To, время, тело. Отражает реальность: общение идёт
 * по почте, клиент отвечает из своего ящика, AI формирует ответное письмо.
 */

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
              <div className="whitespace-pre-line text-xs leading-relaxed text-ink-700">
                {t.body}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
