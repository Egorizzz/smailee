"use client";

type FunnelMetrics = {
  sent: number;
  opened: number;
  replied: number;
  warm: number;
};

type CommunicationFunnelProps = {
  metrics: FunnelMetrics;
  showOpens: boolean;
  compact?: boolean;
  title?: string;
  issues?: Array<{ label: string; count: number }>;
};

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
  issues = [],
}: CommunicationFunnelProps) {
  const stages = [
    {
      key: "sent",
      label: "Отправлено",
      value: metrics.sent,
      previous: metrics.sent,
      base: true,
    },
    ...(showOpens
      ? [
          {
            key: "opened",
            label: "Открыли",
            value: metrics.opened,
            previous: metrics.sent,
          },
        ]
      : []),
    {
      key: "replied",
      label: "Ответили",
      value: metrics.replied,
      previous: metrics.sent,
    },
    {
      key: "warm",
      label: "Тёплые лиды",
      value: metrics.warm,
      previous: metrics.replied,
      warm: true,
    },
  ];

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-white">
      <div className={compact ? "p-4 sm:p-5" : "p-5 sm:p-7"}>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
          <div>
            <p className="text-sm font-semibold text-slate-900">{title}</p>
            <p className="mt-1 text-xs text-ink-500">
              Конверсии считаются от общего числа отправленных писем
            </p>
          </div>
        </div>

        <div className={compact ? "mt-4 space-y-3" : "mt-6 space-y-4"}>
          {stages.map((stage, index) => {
            const base = metrics.sent;
            const conversion = stage.base ? null : percent(stage.value, base);
            return (
              <div
                key={stage.key}
                className={`grid items-center gap-3 rounded-xl border px-4 py-3 sm:grid-cols-[minmax(150px,0.7fr)_minmax(180px,1.7fr)_auto] ${
                  stage.warm
                    ? "border-mint-200 bg-mint-50"
                    : stage.base
                      ? "border-slate-300 bg-slate-50"
                      : "border-line bg-white"
                } ${compact ? "sm:px-4" : "sm:px-5 sm:py-4"}`}
              >
                <div className="flex items-center justify-between gap-3 sm:block">
                  <div>
                    <p
                      className={`text-xs font-semibold ${stage.warm ? "text-mint-700" : "text-ink-500"}`}
                    >
                      {index + 1}. {stage.label}
                    </p>
                    <p
                      className={`${stage.warm && !compact ? "text-4xl" : compact ? "text-2xl" : "text-3xl"} metric-number mt-1 font-semibold leading-none ${stage.warm ? "text-mint-700" : "text-slate-900"}`}
                    >
                      {stage.value.toLocaleString("ru-RU")}
                    </p>
                    {stage.base && issues.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {issues.map((issue) => (
                          <span
                            key={issue.label}
                            className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900"
                          >
                            <span className="metric-number">{issue.count}</span>{" "}
                            · {issue.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span
                    className={`sm:hidden metric-number text-sm font-semibold ${stage.warm ? "text-mint-700" : "text-slate-900"}`}
                  >
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
                  <p
                    className={`metric-number text-lg font-semibold ${stage.warm ? "text-mint-700" : "text-slate-900"}`}
                  >
                    {conversion ?? "База"}
                  </p>
                  <p className="text-[11px] text-ink-500">
                    {stage.base ? "воронки" : "от отправленных"}
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
