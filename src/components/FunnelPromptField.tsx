"use client";

import { useRef, useState, useTransition } from "react";
import { suggestFunnelPrompt } from "@/app/(app)/app/onboarding/actions";

type Props = {
  initialDialogStyle: string;
  initialInstructions: string;
};

export function FunnelPromptField({ initialDialogStyle, initialInstructions }: Props) {
  const [dialogStyle, setDialogStyle] = useState(initialDialogStyle);
  const [instructions, setInstructions] = useState(initialInstructions);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function handleAnalyze() {
    const formData = new FormData();
    const file = fileRef.current?.files?.[0];
    if (file) formData.set("dialogs", file);

    startTransition(async () => {
      setMessage(null);
      const result = await suggestFunnelPrompt(formData);
      if (result.error) {
        setMessageKind("error");
        setMessage(result.error);
        return;
      }
      if (result.prompt) {
        setDialogStyle(result.prompt);
        setMessageKind("success");
        setMessage(
          result.notice ??
            "Диалоги проанализированы. Проверьте вывод ниже и сохраните настройки."
        );
      }
    });
  }

  return (
    <section aria-labelledby="ai-writing-title" className="rounded-xl border border-line bg-white p-5">
      <div className="max-w-xl">
        <h3 id="ai-writing-title" className="text-base font-semibold text-slate-900">
          Как должен писать ИИ
        </h3>
        <p className="mt-1 text-sm leading-6 text-ink-500">
          Примеры задают манеру, комментарии — обязательные правила.
        </p>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-mint-100 text-sm font-semibold text-emerald-800">
              1
            </span>
            <div>
              <h4 className="text-sm font-semibold text-slate-900">Примеры диалогов</h4>
              <p className="mt-1 text-xs leading-5 text-ink-500">
                Загрузите реальную переписку — ИИ выделит тон, аргументы и сценарий ответа.
              </p>
            </div>
          </div>

          <label className="mt-4 block">
            <span className="block text-xs font-medium text-slate-700">Файл TXT, CSV или MD до 2 МБ</span>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.csv,.md,text/plain,text/csv,text/markdown"
              className="mt-3 block w-full text-xs text-ink-600 file:mr-3 file:rounded-md file:border file:border-line file:bg-white file:px-3 file:py-2 file:text-xs file:font-semibold file:text-slate-900 hover:file:bg-mint-100/40"
            />
          </label>
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={pending}
            className="mt-4 rounded-lg brand-gradient px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-wait disabled:opacity-50"
          >
            {pending ? "ИИ анализирует диалоги…" : "Проанализировать диалоги"}
          </button>
        </div>

        <label className="block rounded-lg border border-line bg-white p-4">
          <span className="flex items-start gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">
              2
            </span>
            <span>
              <span className="block text-sm font-semibold text-slate-900">Дополнительные комментарии</span>
              <span className="mt-1 block text-xs leading-5 text-ink-500">
                Уточните, что предлагать, чего не обещать и к какому следующему шагу вести клиента.
              </span>
            </span>
          </span>
          <textarea
            name="funnelPrompt"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            rows={7}
            placeholder={
              "Например:\n— Точную цену в письме не называй.\n— Сначала уточни задачу и объём.\n— Не обещай сроки без подтверждения менеджера."
            }
            className="input mt-4 w-full text-sm"
          />
        </label>
      </div>

      {message && (
        <p
          role={messageKind === "error" ? "alert" : "status"}
          className={`mt-3 rounded-lg px-3 py-2 text-xs ${
            messageKind === "error"
              ? "bg-red-50 text-red-700"
              : "bg-emerald-50 text-emerald-800"
          }`}
        >
          {message}
        </p>
      )}

      {dialogStyle ? (
        <label className="mt-4 block border-t border-line pt-4">
          <span className="block text-sm font-medium text-slate-900">Что ИИ понял из диалогов</span>
          <span className="mt-1 block text-xs leading-5 text-ink-500">
            Проверьте вывод: его можно исправить вручную или удалить. Он сохранится после нажатия «Сохранить».
          </span>
          <textarea
            name="dialogStylePrompt"
            value={dialogStyle}
            onChange={(event) => setDialogStyle(event.target.value)}
            rows={6}
            className="input mt-2 w-full text-sm"
          />
          <button
            type="button"
            onClick={() => setDialogStyle("")}
            className="mt-2 text-xs font-medium text-ink-500 underline-offset-4 hover:text-slate-900 hover:underline"
          >
            Удалить вывод по диалогам
          </button>
        </label>
      ) : (
        <input type="hidden" name="dialogStylePrompt" value="" />
      )}
    </section>
  );
}
