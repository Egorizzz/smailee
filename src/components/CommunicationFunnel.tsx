"use client";

import { useState } from "react";

type FunnelMetrics = {
  sent: number;
  delivered: number;
  opened: number;
  replied: number;
  warm: number;
};

type CommunicationFunnelProps = {
  metrics: FunnelMetrics;
  showOpens: boolean;
  compact?: boolean;
  title?: string;
};

type ConversionMode = "sent" | "previous";

function percent(value: number, base: number): string {
  return base > 0 ? `${Math.round((value / base) * 100)}%` : "—";
}

function stageWidth(value: number, sent: number): string {
  if (value === 0 || sent === 0) return "0%";
  return `${Math.max(1.5, Math.min(100, (value / sent) * 100))}%`;
}

export function CommunicationFunnel({
  metrics,
  showOpens,
  compact = false,
  title = "Воронка коммуникаций",
}: CommunicationFunnelProps) {
  const [mode, setMode] = useState<ConversionMode>("sent");
  const stages = [
    { key: "sent", label: "Отправлено", value: metrics.sent, previous: metrics.sent, base: true },
    { key: "delivered", label: "Доставлено", value: metrics.delivered, previous: metrics.sent },
    ...(showOpens ? [{ key: "opened", label: "Открыли", value: metrics.opened, previous: metrics.delivered }] : []),
    { key: "replied", label: "Ответили", value: metrics.replied, previous: showOpens ? metrics.opened : metrics.delivered },
    { key: "warm", label: "Тёплые лиды", value: metrics.warm, previous: metrics.replied, warm: true },
  ];

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-white">
      <div className={compact ? "p-4 sm:p-5" : "p-5 sm:p-7"}>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
          <div>
            <p className="text-sm font-semibold text-slate-900">{title}</p>
            <p className="mt-1 text-xs text-ink-500">Конверсия между ключевыми событиями коммуникации</p>
          </div>
          <div className="inline-flex rounded-lg border border-line bg-surface p-1" aria-label="Основание расчёта конверсии">
            {([
              ["sent", "От отправленных"],
              ["previous", "От предыдущего этапа"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                aria-pressed={mode === value}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  mode === value ? "bg-white text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.08)]" : "text-ink-500 hover:text-slate-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className={compact ? "mt-4 space-y-3" : "mt-6 space-y-4"}>
          {stages.map((stage, index) => {
            const base = mode === "sent" ? metrics.sent : stage.previous;
            const conversion = stage.base ? null : percent(stage.value, base);
            return (
              <div
                key={stage.key}
                className={`grid items-center gap-3 rounded-xl border px-4 py-3 sm:grid-cols-[minmax(150px,0.7fr)_minmax(180px,1.7fr)_auto] ${
                  stage.warm ? "border-mint-200 bg-mint-50" : stage.base ? "border-slate-300 bg-slate-50" : "border-line bg-white"
                } ${compact ? "sm:px-4" : "sm:px-5 sm:py-4"}`}
              >
                <div className="flex items-center justify-between gap-3 sm:block">
                  <div>
                    <p className={`text-xs font-semibold ${stage.warm ? "text-mint-700" : "text-ink-500"}`}>
                      {index + 1}. {stage.label}
                    </p>
                    <p className={`${stage.warm && !compact ? "text-4xl" : compact ? "text-2xl" : "text-3xl"} metric-number mt-1 font-semibold leading-none ${stage.warm ? "text-mint-700" : "text-slate-900"}`}>
                      {stage.value.toLocaleString("ru-RU")}
                    </p>
                  </div>
                  <span className={`sm:hidden metric-number text-sm font-semibold ${stage.warm ? "text-mint-700" : "text-slate-900"}`}>
                    {conversion ?? "База"}
                  </span>
                </div>

                <div className="h-3 overflow-hidden rounded-full bg-surface">
                  <div
                    className={`h-full rounded-full ${stage.warm ? "bg-mint-500" : stage.base ? "bg-slate-700" : "bg-slate-900"}`}
                    style={{ width: stageWidth(stage.value, metrics.sent) }}
                  />
                </div>

                <div className="hidden min-w-32 text-right sm:block">
                  <p className={`metric-number text-lg font-semibold ${stage.warm ? "text-mint-700" : "text-slate-900"}`}>
                    {conversion ?? "База"}
                  </p>
                  <p className="text-[11px] text-ink-500">
                    {stage.base ? "воронки" : mode === "sent" ? "от отправленных" : "от прошлого этапа"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
