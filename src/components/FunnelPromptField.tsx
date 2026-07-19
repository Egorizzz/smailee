"use client";

/**
 * Инструкция ИИ по воронке: как отвечать клиентам (§5.5).
 *
 * Написать такие правила с нуля тяжело — поэтому можно загрузить выгрузку
 * реальной переписки отдела продаж, ИИ вытащит из неё закономерности и
 * предложит черновик. Черновик именно предлагается, а не применяется молча:
 * по этим правилам ИИ будет отвечать живым клиентам, их надо вычитать.
 */

import { useState, useTransition } from "react";
import { suggestFunnelPrompt } from "@/app/(app)/app/onboarding/actions";

export function FunnelPromptField({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSuggest(formData: FormData) {
    startTransition(async () => {
      setMsg(null);
      const res = await suggestFunnelPrompt(formData);
      if (res.error) {
        setMsg(res.error);
        return;
      }
      if (res.prompt) {
        setValue(res.prompt);
        setOpen(false);
        setMsg(
          res.notice ??
            "Черновик готов — вычитайте его и нажмите «Сохранить» внизу формы."
        );
      }
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-900">
          Как ИИ должен отвечать клиентам
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs font-semibold text-indigo-600 hover:underline"
        >
          {open ? "Свернуть" : "Составить по моим диалогам"}
        </button>
      </div>
      <span className="mt-0.5 block text-xs text-ink-500">
        Тон, что предлагать, куда вести клиента, что не обещать. Пусто — ИИ
        отвечает по общим правилам продаж.
      </span>

      {open && (
        <div className="mt-2 rounded-xl border border-line bg-surface p-3">
          <p className="text-xs text-ink-700">
            Загрузите выгрузку переписки с клиентами (.txt/.csv) или вставьте
            несколько диалогов текстом — ИИ составит из них черновик правил.
          </p>
          {/* отдельная форма: сабмит подсказки не должен отправлять форму настроек */}
          <form action={handleSuggest} className="mt-2 space-y-2">
            <input
              type="file"
              name="dialogs"
              accept=".txt,.csv,.md,text/plain"
              className="block w-full text-xs"
            />
            <textarea
              name="dialogsText"
              rows={4}
              placeholder="Или вставьте диалоги сюда…"
              className="input w-full text-xs"
            />
            <button
              disabled={pending}
              className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-700 hover:border-mint-400 disabled:opacity-50"
            >
              {pending ? "ИИ читает диалоги…" : "Составить инструкцию"}
            </button>
          </form>
        </div>
      )}

      {msg && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{msg}</p>
      )}

      <textarea
        name="funnelPrompt"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={6}
        placeholder={
          "Например:\n— Отвечай в деловом, но живом тоне.\n— Сначала уточни задачу и объём, потом предлагай созвон.\n— Точную цену в письме не называй.\n— Если клиент не готов — предложи вернуться позже, не дави."
        }
        className="input mt-2"
      />
    </div>
  );
}
