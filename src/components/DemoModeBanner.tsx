"use client";

import { useRef } from "react";
import { leaveDemoWorkspace } from "@/app/(app)/app/demo/actions";

export function DemoModeBanner() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-mint-200 bg-[#eff8f2] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-mint-700 text-sm font-bold text-white">D</span>
          <div>
            <p className="text-sm font-semibold text-slate-950">Демо-режим включён</p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-600">Вы видите виртуальные данные. Реальные кампании и прогрев ящиков продолжаются в фоне.</p>
          </div>
        </div>
        <button type="button" onClick={() => dialogRef.current?.showModal()} className="shrink-0 rounded-xl border border-mint-300 bg-white px-4 py-2 text-xs font-semibold text-mint-900 transition hover:bg-mint-50">
          Отключить демо-режим
        </button>
      </div>
      <dialog ref={dialogRef} className="m-auto w-[min(92vw,30rem)] rounded-2xl border border-line bg-white p-0 shadow-2xl backdrop:bg-slate-950/35">
        <div className="p-6">
          <h2 className="text-xl font-semibold text-slate-950">Выключить демо-режим?</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-500">Песочница сохранится для следующего включения. Рабочие настройки, кампании, интеграции и прогрев реальных ящиков не изменятся.</p>
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" onClick={() => dialogRef.current?.close()} className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-slate-800">Остаться в демо</button>
            <form action={leaveDemoWorkspace}><button className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">Вернуться к работе</button></form>
          </div>
        </div>
      </dialog>
    </>
  );
}
