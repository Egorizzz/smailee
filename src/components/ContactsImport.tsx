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
  mergeContactSegments,
  deleteInvalidContacts,
  type ImportAnalysis,
} from "@/app/(app)/app/contacts/actions";
import { FIELD_LABELS, type FieldKey } from "@/lib/contacts/tableParse";

const FIELD_KEYS: FieldKey[] = ["email", "name", "company", "inn", "segment", "custom", "skip"];

export function ContactsImport({ onDone, compact = false }: { onDone?: () => void; compact?: boolean } = {}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [mapping, setMapping] = useState<FieldKey[]>([]);
  const [autoSegment, setAutoSegment] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [invalidEmails, setInvalidEmails] = useState<string[]>([]);
  const [segmentMerges, setSegmentMerges] = useState<Array<{ from: string; to: string }>>([]);

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
      setInvalidEmails(res.invalidEmails ?? []);
      setSegmentMerges(res.segmentMerges ?? []);
      if (res.ok) {
        setAnalysis(null);
        if (fileRef.current) fileRef.current.value = "";
        onDone?.();
      }
    });
  }

  const hasEmail = Boolean(analysis?.workbook) || mapping.includes("email");

  return (
    <div className={compact ? "" : "rounded-2xl border border-line bg-white p-5"}>
      {!compact && <h2 className="text-sm font-semibold text-slate-900">Загрузить базу</h2>}
      <p className={`${compact ? "" : "mt-1"} text-xs text-ink-500`}>
        CSV, TSV или Excel (.xlsx) — колонки в любом порядке и с любыми
        названиями. Система разберёт файл и покажет, как поняла колонки.
      </p>

      <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-surface/50 p-4">
        <input
          ref={fileRef}
          type="file"
          id="contacts-file"
          accept=".csv,.tsv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          onChange={(event) => {
            setAnalysis(null);
            setMsg(null);
            setFileName(event.currentTarget.files?.[0]?.name ?? null);
          }}
        />
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <label htmlFor="contacts-file" className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"><span aria-hidden>↑</span> Выбрать файл</label>
            <p className="mt-2 text-xs text-ink-500">{fileName ?? "CSV, TSV или Excel"}</p>
          </div>
          <button type="button" onClick={handleAnalyze} disabled={pending} className="rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink-700 hover:border-mint-400 disabled:opacity-50">
            {pending && !analysis ? "Читаем файл…" : "Проверить и загрузить"}
          </button>
        </div>
      </div>

      {msg && (
        <p role="status" aria-live="polite" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{msg}</p>
      )}
      {invalidEmails.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800">
          <div className="font-medium">Не принимают почту: {invalidEmails.length}</div>
          <p className="mt-1 text-xs text-red-700">Предлагаем удалить подтверждённо нерабочие адреса. Они уже исключены из рассылок.</p>
          <div className="metric-number mt-2 max-h-24 overflow-y-auto text-xs">{invalidEmails.join(", ")}</div>
          <button onClick={() => startTransition(async () => { const data = new FormData(); data.set("emails", JSON.stringify(invalidEmails)); const result = await deleteInvalidContacts(data); if (result.ok) setInvalidEmails([]); })} className="mt-3 rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white">Удалить нерабочие из базы</button>
        </div>
      )}
      {segmentMerges.length > 0 && <div className="mt-3 rounded-lg border border-mint-200 bg-mint-50 p-3"><div className="text-sm font-medium text-mint-900">Похожие сегменты</div><p className="mt-1 text-xs text-mint-800">AI нашёл близкие по смыслу названия. Объедините их, чтобы фильтры и кампании не дублировались.</p><div className="mt-2 space-y-2">{segmentMerges.map((item) => <div key={`${item.from}:${item.to}`} className="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2 text-xs"><span>«{item.from}» → «{item.to}»</span><button onClick={() => startTransition(async () => { const data = new FormData(); data.set("from", item.from); data.set("to", item.to); const result = await mergeContactSegments(data); if (result.ok) setSegmentMerges((current) => current.filter((value) => value !== item)); })} className="font-semibold text-mint-800">Объединить</button></div>)}</div></div>}

      {analysis && (
        <div className="mt-4 border-t border-line pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-slate-900">
              Найдено контактов: <span className="metric-number">{analysis.totalRows}</span>
            </span>
            <span className="text-xs text-ink-500">
              {analysis.workbook
                ? "Связи между листами распознаны автоматически"
                : analysis.aiUsed
                ? "Колонки распознаны с помощью ИИ — проверьте"
                : "Колонки распознаны автоматически — проверьте"}
            </span>
          </div>

          {analysis.workbook ? (
            <div className="mt-3 space-y-2 rounded-xl border border-line bg-surface/50 p-3">
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-600">
                <span>Проверенных email: <span className="metric-number font-semibold text-slate-900">{analysis.workbook.prevalidated}</span></span>
                {analysis.workbook.unmatchedContextRows > 0 && <span>Неоднозначных строк без email: <span className="metric-number font-semibold text-slate-900">{analysis.workbook.unmatchedContextRows}</span></span>}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {analysis.workbook.sheets.map((sheet) => (
                  <div key={sheet.name} className="rounded-lg border border-line bg-white px-3 py-2">
                    <div className="truncate text-xs font-medium text-slate-900">{sheet.name}</div>
                    <div className="mt-1 flex justify-between gap-3 text-xs text-ink-500">
                      <span>{sheet.role === "contacts" ? "Контакты" : sheet.role === "email_validation" ? "Проверка email" : "Справка"}</span>
                      <span className="metric-number">связано {sheet.rowsMatched} из {sheet.rows}</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-ink-500">Все исходные поля сохранятся у контакта с названием листа. Строки с неоднозначным совпадением автоматически не объединяются.</p>
            </div>
          ) : <div className="mt-3 overflow-x-auto">
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
                          if (picked !== "skip" && picked !== "custom") {
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
          </div>}

          {!hasEmail && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
              Не указана колонка с Email — без неё отправлять некуда.
            </p>
          )}

          {!analysis.workbook && <label className="mt-3 flex items-start gap-2 rounded-lg bg-surface p-3">
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
          </label>}

          <button
            type="button"
            onClick={handleImport}
            disabled={pending || !hasEmail}
            className="mt-3 rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Ставим в обработку…" : `Загрузить ${analysis.totalRows} контактов`}
          </button>
        </div>
      )}
    </div>
  );
}
