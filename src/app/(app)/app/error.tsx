"use client";

import { useEffect } from "react";

export default function AppError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  useEffect(() => { console.error("[SYS-9001] app boundary", error); }, [error]);
  const code = error.digest ? `SYS-${error.digest.slice(0, 8)}` : "SYS-9001";
  return <div className="mx-auto mt-16 max-w-lg rounded-2xl border border-line bg-white p-7 text-center"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-800">!</div><h1 className="mt-4 text-xl font-semibold text-slate-900">Не удалось открыть этот раздел</h1><p className="mt-2 text-sm leading-6 text-ink-500">Повторите попытку. Если ошибка вернётся, отправьте поддержке код <span className="metric-number font-medium text-slate-900">{code}</span>.</p><button onClick={() => unstable_retry()} className="btn-primary mt-5 px-4 py-2.5 text-sm font-semibold">Попробовать снова</button></div>;
}
