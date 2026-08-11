/**
 * Архивная секция лендинга: числовые ориентиры на тёмном текстурном фоне.
 * Снята с активной страницы 2026-08-06, сохранена для возможного возврата.
 */
import { Counter } from "@/components/Counter";
import { Reveal } from "@/components/Reveal";

const metrics = [
  { to: 3, prefix: "до ×", suffix: "", label: "больше ответов из холодной базы" },
  { to: 150000, prefix: "до ", suffix: " ₽", label: "экономия в месяц против найма SDR" },
  { to: 14, prefix: "", suffix: " дней", label: "автоматический прогрев ящиков перед стартом" },
  { to: 24, prefix: "", suffix: "/7", label: "AI отвечает лидам без вашего участия" },
];

export function ArchivedStatsSection() {
  return (
    <section
      className="relative overflow-hidden bg-dark-bg bg-cover bg-center"
      style={{ backgroundImage: "url(/generated/dark-texture.jpg)" }}
    >
      <div className="absolute inset-0 bg-dark-bg/70" />
      <Reveal>
        <div className="relative z-10 mx-auto grid max-w-6xl grid-cols-2 gap-8 px-5 py-20 lg:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.label}>
              <div className="text-3xl font-semibold text-lime-400 md:text-4xl">
                <Counter
                  to={metric.to}
                  prefix={metric.prefix}
                  suffix={metric.suffix}
                />
              </div>
              <div className="mt-2 text-sm text-white/60">{metric.label}</div>
            </div>
          ))}
        </div>
      </Reveal>
      <p className="relative z-10 pb-10 text-center text-xs text-white/40">
        Оценочные ориентиры на основе типовых сценариев. Реальные результаты
        зависят от базы и ниши.
      </p>
    </section>
  );
}
