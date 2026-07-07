"use client";

import { useState, useTransition, useEffect } from "react";
import { planSeries, generateStep, launchSeries } from "../actions";

type LlmProvider = "deepseek" | "claude";
const LLM_PROVIDERS: { value: LlmProvider; label: string; available: boolean }[] = [
  { value: "deepseek", label: "DeepSeek", available: true },
  { value: "claude", label: "Claude (Скоро)", available: false },
];

type Step = {
  id: string;
  stepIndex: number;
  topic: string;
  angle: string;
  dayOffset: number;
  includeCta: boolean;
  ctaLabel: string | null;
  subject: string | null;
  body: string | null;
  status: "DRAFT" | "READY" | "SENT";
};

const statusLabels: Record<string, string> = {
  DRAFT: "Черновик",
  SCHEDULED: "Отложена",
  QUEUED: "В очереди",
  SENDING: "Идёт рассылка",
  SENT: "Завершена",
  PAUSED: "Пауза",
};

const stepStatusStyle: Record<Step["status"], string> = {
  DRAFT: "bg-surface text-ink-500",
  READY: "bg-indigo-50 text-indigo-700",
  SENT: "bg-mint-100 text-mint-700",
};

// Демо-подстановка плейсхолдеров для превью (реальные значения — только при отправке).
function previewHtml(html: string): string {
  return html
    .replace(/\{\{\s*name\s*\}\}/g, "Пётр")
    .replace(/\{\{\s*company\s*\}\}/g, "ООО «Ромашка»")
    .replace(/\{\{\s*unsubscribe_url\s*\}\}/g, "#")
    .replace(/\{\{\s*lead_cta_url\s*\}\}/g, "#");
}

export function SeriesReview({
  campaign,
  steps,
  stats,
  leads,
}: {
  campaign: {
    id: string;
    name: string;
    seriesTopic: string;
    seriesFrequencyDays: number;
    seriesTotalSteps: number;
    segment: string | null;
    status: string;
  };
  steps: Step[];
  stats: { sent: number; opened: number; nudges: number };
  leads: { id: string; summary: string; contactEmail: string }[];
}) {
  const [provider, setProvider] = useState<LlmProvider>("deepseek");
  const [pending, startTransition] = useTransition();
  const [pendingStepId, setPendingStepId] = useState<string | null>(null);
  const [previewStepId, setPreviewStepId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  function handlePlan() {
    startTransition(async () => {
      const res = await planSeries(campaign.id, provider);
      if (res.notice) setToast(res.notice);
    });
  }

  function handleGenerateStep(stepId: string) {
    setPendingStepId(stepId);
    startTransition(async () => {
      const res = await generateStep(stepId, campaign.id, provider);
      if (res.notice) setToast(res.notice);
      setPendingStepId(null);
    });
  }

  function handleLaunch() {
    startTransition(async () => {
      await launchSeries(campaign.id);
    });
  }

  const canLaunch =
    campaign.status === "DRAFT" && steps.some((s) => s.status !== "DRAFT");
  const opened = stats.sent ? Math.round((stats.opened / stats.sent) * 100) : 0;

  return (
    <div className="mx-auto max-w-3xl">
      {toast && (
        <div
          role="alert"
          className="fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-lg"
        >
          <div className="flex items-start gap-2">
            <span aria-hidden className="mt-0.5">⚠️</span>
            <div className="flex-1">{toast}</div>
            <button type="button" onClick={() => setToast(null)} className="text-amber-600 hover:text-amber-900">×</button>
          </div>
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{campaign.name}</h1>
          <p className="mt-1 text-ink-500">
            «{campaign.seriesTopic}» · раз в {campaign.seriesFrequencyDays} дн. ·{" "}
            {campaign.segment ?? "все контакты"}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-surface px-3 py-1 text-xs font-semibold text-ink-700">
          {statusLabels[campaign.status] ?? campaign.status}
        </span>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-4">
        {[
          { l: "Отправлено", v: stats.sent },
          { l: "Open rate", v: `${opened}%` },
          { l: "Персональных касаний", v: stats.nudges },
        ].map((s) => (
          <div key={s.l} className="rounded-xl border border-line bg-white p-4">
            <div className="text-xl font-bold text-slate-900">{s.v}</div>
            <div className="text-sm text-ink-500">{s.l}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">План серии</h2>
        <div className="flex items-center gap-2">
          <select
            className="input !py-1.5 text-sm"
            value={provider}
            onChange={(e) => setProvider(e.target.value as LlmProvider)}
          >
            {LLM_PROVIDERS.map((p) => (
              <option key={p.value} value={p.value} disabled={!p.available}>
                {p.label}
              </option>
            ))}
          </select>
          {steps.length === 0 && (
            <button
              type="button"
              onClick={handlePlan}
              disabled={pending}
              className="rounded-lg brand-gradient px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {pending ? "Планируем…" : "Сгенерировать план"}
            </button>
          )}
        </div>
      </div>

      {steps.length === 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-line bg-white p-8 text-center text-ink-500">
          План ещё не создан. Нажмите «Сгенерировать план» — AI подберёт темы и
          расписание для {campaign.seriesTotalSteps} писем.
        </div>
      )}

      <div className="mt-4 space-y-3">
        {steps.map((s) => (
          <div key={s.id} className="rounded-xl border border-line bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                  Шаг {s.stepIndex + 1} · день {s.dayOffset}
                  {s.includeCta && (
                    <span className="ml-2 rounded-full bg-mint-100 px-2 py-0.5 text-mint-700">
                      CTA: {s.ctaLabel}
                    </span>
                  )}
                </div>
                <div className="mt-1 font-semibold text-slate-900">{s.topic}</div>
                <div className="mt-0.5 text-xs text-ink-500">{s.angle}</div>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${stepStatusStyle[s.status]}`}>
                {s.status === "DRAFT" ? "Не написано" : s.status === "READY" ? "Готово" : "Отправлено"}
              </span>
            </div>

            <div className="mt-3 flex items-center gap-2">
              {s.status === "DRAFT" ? (
                <button
                  type="button"
                  onClick={() => handleGenerateStep(s.id)}
                  disabled={pending}
                  className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 disabled:opacity-60"
                >
                  {pending && pendingStepId === s.id ? "Пишем текст и картинку…" : "Сгенерировать контент"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setPreviewStepId(previewStepId === s.id ? null : s.id)}
                  className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-700 hover:border-mint-400"
                >
                  {previewStepId === s.id ? "Скрыть превью" : "Показать превью"}
                </button>
              )}
            </div>

            {previewStepId === s.id && s.body && (
              <iframe
                srcDoc={previewHtml(s.body)}
                title={`Превью: ${s.subject}`}
                className="mt-3 h-96 w-full rounded-lg border border-line"
              />
            )}
          </div>
        ))}
      </div>

      {steps.length > 0 && (
        <div className="mt-6 flex items-center justify-between rounded-xl border border-line bg-white p-5">
          <div className="text-sm text-ink-500">
            {canLaunch
              ? "Хотя бы один шаг готов — можно запускать серию по расписанию."
              : campaign.status === "DRAFT"
                ? "Сгенерируйте контент минимум для первого шага, чтобы запустить серию."
                : "Серия уже запущена — новые шаги материализуются автоматически по расписанию."}
          </div>
          {campaign.status === "DRAFT" && (
            <button
              type="button"
              onClick={handleLaunch}
              disabled={!canLaunch || pending}
              className="shrink-0 rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              ▶ Запустить серию
            </button>
          )}
        </div>
      )}

      {leads.length > 0 && (
        <>
          <h2 className="mt-8 text-lg font-semibold text-slate-900">Заявки из серии</h2>
          <div className="mt-3 space-y-2">
            {leads.map((l) => (
              <div key={l.id} className="rounded-xl border border-line bg-white p-4 text-sm">
                <div className="font-semibold text-slate-900">{l.contactEmail}</div>
                <div className="mt-0.5 text-ink-500">{l.summary}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
