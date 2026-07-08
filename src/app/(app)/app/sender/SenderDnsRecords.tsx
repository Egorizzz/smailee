"use client";

import { useState, useTransition } from "react";
import { getSenderDnsRecords } from "./actions";

type Record = { type: string; name: string; value: string };

export function SenderDnsRecords({ senderId }: { senderId: string }) {
  const [records, setRecords] = useState<Record[] | null>(null);
  const [live, setLive] = useState(false);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (records) return;
    startTransition(async () => {
      const res = await getSenderDnsRecords(senderId);
      if (res) {
        setRecords(res.records);
        setLive(res.live);
      }
    });
  }

  function copy(value: string) {
    navigator.clipboard?.writeText(value);
    setCopied(value);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={toggle}
        className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink-700 transition hover:border-mint-400"
      >
        {open ? "Скрыть DNS-записи" : "Показать DNS-записи для настройки"}
      </button>

      {open && (
        <div className="mt-3 rounded-xl border border-line bg-surface p-4">
          <p className="text-sm text-ink-700">
            Добавьте эти записи в DNS вашего домена (в панели регистратора или
            хостинга DNS). Обычно раздел называется «DNS», «Управление зоной» или
            «Ресурсные записи». После добавления нажмите «Проверить DNS» — проверка
            может занять до нескольких часов, пока записи разойдутся.
          </p>
          {!live && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Показаны примерные записи. Точные значения (в частности код
              подтверждения и DKIM-ключ) сформируются после подключения вашего
              Project в Unisender — их пришлём при настройке. Если что-то не
              получается — поможем на созвоне и настроим вручную.
            </p>
          )}
          {pending && <p className="mt-3 text-sm text-ink-500">Загружаем записи…</p>}

          {records && (
            <div className="mt-3 space-y-2">
              {records.map((r, i) => (
                <div key={i} className="rounded-lg border border-line bg-white p-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                      {r.type}
                    </span>
                    <span className="font-mono text-xs text-ink-700 break-all">{r.name}</span>
                  </div>
                  <div className="mt-2 flex items-start gap-2">
                    <code className="flex-1 break-all rounded bg-surface px-2 py-1 text-xs text-slate-900">
                      {r.value}
                    </code>
                    <button
                      type="button"
                      onClick={() => copy(r.value)}
                      className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-ink-700 hover:border-mint-400"
                    >
                      {copied === r.value ? "✓" : "Копировать"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
