"use client";

/**
 * Импорт базы контактов в два шага: разметка колонок → загрузка.
 *
 * Раньше импорт понимал только фиксированные названия колонок и на чужом
 * файле молча загружал ноль контактов — без объяснения, что не так. Теперь
 * система показывает, как она поняла файл, и даёт поправить до записи в базу.
 */

import { useRef, useState, useTransition } from "react";
import {
  analyzeContactsFile,
  importContactsMapped,
  type ImportAnalysis,
} from "@/app/(app)/app/contacts/actions";
import { FIELD_LABELS, type FieldKey } from "@/lib/contacts/tableParse";

const FIELD_KEYS: FieldKey[] = ["email", "name", "company", "segment", "skip"];

export function ContactsImport() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [mapping, setMapping] = useState<FieldKey[]>([]);
  const [autoSegment, setAutoSegment] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleAnalyze() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setMsg("Выберите файл с базой");
      return;
    }
    startTransition(async () => {
      setMsg(null);
      const fd = new FormData();
      fd.set("file", file);
      const res = await analyzeContactsFile(fd);
      if (res.error) {
        setMsg(res.error);
        setAnalysis(null);
        return;
      }
      setAnalysis(res);
      setMapping(res.mapping);
      setAutoSegment(!res.hasSegment);
    });
  }

  function handleImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("file", file);
      for (const m of mapping) fd.append("mapping", m);
      if (autoSegment) fd.set("autoSegment", "on");
      const res = await importContactsMapped(fd);
      setMsg(res.error ?? res.ok ?? null);
      if (res.ok) {
        setAnalysis(null);
        if (fileRef.current) fileRef.current.value = "";
      }
    });
  }

  const hasEmail = mapping.includes("email");

  return (
    <div className="rounded-2xl border border-line bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Загрузить базу</h2>
      <p className="mt-1 text-xs text-ink-500">
        CSV, TSV или Excel (.xlsx) — колонки в любом порядке и с любыми
        названиями. Система разберёт файл и покажет, как поняла колонки.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="block text-sm"
          onChange={() => {
            setAnalysis(null);
            setMsg(null);
          }}
        />
        <button
          type="button"
          onClick={handleAnalyze}
          disabled={pending}
          className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink-700 hover:border-mint-400 disabled:opacity-50"
        >
          {pending && !analysis ? "Читаем файл…" : "Разобрать файл"}
        </button>
      </div>

      {msg && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{msg}</p>
      )}

      {analysis && (
        <div className="mt-4 border-t border-line pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-slate-900">
              Найдено строк: {analysis.totalRows}
            </span>
            <span className="text-xs text-ink-500">
              {analysis.aiUsed
                ? "Колонки распознаны с помощью ИИ — проверьте"
                : "Колонки распознаны автоматически — проверьте"}
            </span>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead>
                <tr className="border-b border-line text-left text-ink-500">
                  <th className="py-2 pr-3 font-medium">Колонка в файле</th>
                  <th className="py-2 pr-3 font-medium">Пример значений</th>
                  <th className="py-2 font-medium">Загрузить как</th>
                </tr>
              </thead>
              <tbody>
                {analysis.headers.map((h, i) => (
                  <tr key={i} className="border-b border-line/60">
                    <td className="py-2 pr-3 font-medium text-slate-900">{h || `Колонка ${i + 1}`}</td>
                    <td className="max-w-[220px] truncate py-2 pr-3 text-ink-500">
                      {analysis.sampleRows.map((r) => r[i]).filter(Boolean).slice(0, 2).join(" · ") || "—"}
                    </td>
                    <td className="py-2">
                      <select
                        value={mapping[i] ?? "skip"}
                        onChange={(e) => {
                          const next = [...mapping];
                          const picked = e.target.value as FieldKey;
                          // одно поле — одна колонка: снимаем прежнюю привязку,
                          // иначе в базу молча уедет не та колонка
                          if (picked !== "skip") {
                            const prev = next.indexOf(picked);
                            if (prev > -1 && prev !== i) next[prev] = "skip";
                          }
                          next[i] = picked;
                          setMapping(next);
                        }}
                        className="input !py-1 text-xs"
                      >
                        {FIELD_KEYS.map((k) => (
                          <option key={k} value={k}>{FIELD_LABELS[k]}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!hasEmail && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
              Не указана колонка с Email — без неё отправлять некуда.
            </p>
          )}

          <label className="mt-3 flex items-start gap-2 rounded-lg bg-surface p-3">
            <input
              type="checkbox"
              checked={autoSegment}
              onChange={(e) => setAutoSegment(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-xs text-ink-700">
              <span className="font-medium text-slate-900">Разбить базу на сегменты автоматически</span>
              <span className="mt-0.5 block text-ink-500">
                ИИ определит нишу по названию компании. Сегменты из файла
                приоритетнее — их не перезапишем. Дальше можно запустить свою
                кампанию на каждый сегмент.
              </span>
            </span>
          </label>

          <button
            type="button"
            onClick={handleImport}
            disabled={pending || !hasEmail}
            className="mt-3 rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Загружаем…" : `Загрузить ${analysis.totalRows} контактов`}
          </button>
        </div>
      )}
    </div>
  );
}
