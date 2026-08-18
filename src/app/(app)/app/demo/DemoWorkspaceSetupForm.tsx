"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { createDemoWorkspace } from "./actions";

function SubmitState({ website }: { website: string }) {
  const { pending } = useFormStatus();
  return (
    <>
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Запускаем…" : "Собрать демо"}
      </button>
      {pending && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-white/95 px-5 backdrop-blur-sm" role="status" aria-live="polite">
          <div className="w-full max-w-xl rounded-xl border border-line bg-white p-7 shadow-[0_14px_45px_rgba(15,23,42,0.10)] sm:p-9">
            <div className="flex items-start gap-4">
              <span className="mt-0.5 h-7 w-7 shrink-0 animate-spin rounded-full border-2 border-slate-200 border-t-mint-700" aria-hidden="true" />
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.02em] text-slate-950">Запускаем анализ компании</h2>
                <p className="mt-1 text-sm leading-relaxed text-ink-500">
                  {website.trim() ? "Проверяем адрес и создаём задание для полного анализа сайта." : "Готовим стандартный профиль и безопасную песочницу."}
                </p>
              </div>
            </div>
            <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full w-1/4 animate-pulse rounded-full bg-mint-600" />
            </div>
            <p className="mt-4 truncate text-xs text-ink-500">{website.trim() || "Стандартный демо-профиль"}</p>
          </div>
        </div>
      )}
    </>
  );
}

export function DemoWorkspaceSetupForm({ defaultWebsite = "" }: { defaultWebsite?: string }) {
  const [website, setWebsite] = useState(defaultWebsite);
  return (
    <form action={createDemoWorkspace} className="mt-8">
      <label htmlFor="demo-website" className="text-sm font-semibold text-slate-900">Сайт компании</label>
      <p className="mt-1 text-xs leading-relaxed text-ink-500">
        Проведём такой же полный анализ, как в рабочем режиме. Профиль сохранится после отключения демо.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          id="demo-website"
          name="websiteUrl"
          type="text"
          inputMode="url"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
          placeholder="company.ru"
          className="input min-w-0 flex-1"
        />
        <SubmitState website={website} />
      </div>
    </form>
  );
}
