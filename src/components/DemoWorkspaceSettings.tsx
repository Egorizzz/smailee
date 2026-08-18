"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { enterDemoWorkspace, leaveDemoWorkspace } from "@/app/(app)/app/demo/actions";

type Props = {
  active: boolean;
  generated: boolean;
  generating?: boolean;
};

function ModeSubmit({ active, generated, generating = false }: Props) {
  const { pending } = useFormStatus();
  const label = active
    ? "Вернуться к рабочим данным"
    : generating
      ? "Открыть создание демо"
      : generated
      ? "Включить демо-режим"
      : "Создать демо-режим";
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-[10px] border border-slate-950 bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? (active ? "Возвращаем…" : generating ? "Открываем…" : generated ? "Включаем…" : "Готовим демо…") : label}
    </button>
  );
}

export function DemoWorkspaceSettings({ active, generated, generating = false }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-line bg-white">
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-950">Демо-режим</h2>
            <span className={`rounded-md px-2 py-1 text-xs font-semibold ${active ? "bg-mint-100 text-mint-800" : "bg-slate-100 text-slate-600"}`}>
              {active ? "Включён" : generating ? "Создаётся" : generated ? "Готов к включению" : "Ещё не создан"}
            </span>
          </div>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink-500">
            {active
              ? "Вы видите виртуальные контакты, кампании и диалоги. Рабочие кампании и прогрев реальных ящиков продолжаются в фоне."
              : generating
                ? "Песочница уже собирается. Можно вернуться на экран прогресса."
                : generated
                ? "Сохранённая песочница откроется в том же состоянии. Рабочие данные и настройки останутся без изменений."
                : "Песочница создаётся один раз из профиля компании. В ней нет реальных отправок и подключений к интеграциям."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => dialogRef.current?.showModal()}
          className="shrink-0 rounded-[10px] border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
        >
          {active ? "Вернуться к работе" : generating ? "Открыть прогресс" : generated ? "Открыть демо" : "Создать демо"}
        </button>
      </div>
      <div className="border-t border-line bg-[#f7f9f8] px-5 py-3 text-xs leading-relaxed text-ink-500">
        Переключение меняет только данные, которые отображаются в кабинете. Реальный флот, расписание и интеграции не выключаются и не перенастраиваются.
      </div>

      <dialog ref={dialogRef} className="m-auto w-[min(92vw,31rem)] rounded-2xl border border-line bg-white p-0 shadow-2xl backdrop:bg-slate-950/35">
        <div className="p-6">
          <h2 className="text-xl font-semibold tracking-[-0.02em] text-slate-950">
            {active ? "Вернуться к рабочим данным?" : generating ? "Открыть создание демо?" : generated ? "Включить демо-режим?" : "Создать демо-режим?"}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-500">
            {active
              ? "Песочница сохранится для следующего входа. Все реальные данные и текущий прогрев останутся в прежнем состоянии."
              : generating
                ? "Продолжим с текущего этапа — повторная генерация не запустится."
                : generated
                ? "Откроется ранее созданная песочница со всеми изменениями. Реальные процессы продолжат работать в фоне."
                : "Мы создадим виртуальную базу, кампании, ответы и флот на основе текущего профиля компании. Это может занять до минуты."}
          </p>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => dialogRef.current?.close()} className="rounded-[10px] border border-line px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50">
              Отмена
            </button>
            <form action={active ? leaveDemoWorkspace : enterDemoWorkspace}>
              <ModeSubmit active={active} generated={generated} generating={generating} />
            </form>
          </div>
        </div>
      </dialog>
    </section>
  );
}
