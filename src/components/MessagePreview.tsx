"use client";

import { useEffect, useState } from "react";

/**
 * Предпросмотр письма кампании с реальными переменными контакта.
 *
 * Открывается модалкой во весь экран: письмо — основной продукт, и оценивать
 * его в узкой полосе на 384px внутри карточки было нельзя (вёрстка, отступы и
 * длина текста в такой рамке выглядят иначе, чем в почте у получателя).
 * iframe грузится лениво — только когда модалку реально открыли.
 */
export function MessagePreview({ messageId }: { messageId: string }) {
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(true);

  // Esc закрывает — модалка перекрывает страницу целиком, нужен быстрый выход
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    // фон не должен прокручиваться под модалкой
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
      >
        Предпросмотр письма
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <span className="text-sm font-semibold text-slate-900">Предпросмотр письма</span>
              <div className="flex items-center gap-2">
                {/* мобильная ширина — большинство писем читают с телефона */}
                <div className="flex rounded-lg border border-line p-0.5">
                  {(
                    [
                      { v: true, label: "Десктоп" },
                      { v: false, label: "Телефон" },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.label}
                      type="button"
                      onClick={() => setWide(o.v)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                        wide === o.v ? "bg-surface text-slate-900" : "text-ink-500 hover:text-slate-900"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-line px-3 py-1 text-xs font-medium text-ink-500 hover:text-slate-900"
                >
                  Закрыть
                </button>
              </div>
            </div>
            <div className="flex flex-1 justify-center overflow-auto bg-surface p-4">
              <iframe
                src={`/api/templates/preview?message=${messageId}`}
                title="Предпросмотр письма"
                className={`h-full rounded-lg border border-line bg-white ${
                  wide ? "w-full" : "w-[390px]"
                }`}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
