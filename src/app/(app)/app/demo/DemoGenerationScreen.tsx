"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { pollDemoGeneration, type DemoGenerationSnapshot } from "./actions";

const STEPS = [
  { title: "Проверяем сайт", description: "Строим карту и определяем глубину обхода." },
  { title: "Читаем ключевые страницы", description: "Собираем продукты, услуги, аудитории, цены и кейсы." },
  { title: "Собираем профиль компании", description: "ИИ сопоставляет факты, источники и ограничения." },
  { title: "Готовим демо-пространство", description: "Создаём контакты, кампании, статистику и диалоги." },
] as const;

function activeStep(snapshot: DemoGenerationSnapshot) {
  if (snapshot.demoStatus === "ACTIVE") return 4;
  if (!snapshot.crawl || snapshot.crawl.status === "PENDING") return 0;
  if (snapshot.crawl.status === "CRAWLING") return snapshot.crawl.crawledCount > 0 ? 1 : 0;
  if (snapshot.crawl.status === "ANALYZING") return 2;
  if (snapshot.crawl.status === "READY_FOR_REVIEW") return 3;
  return 0;
}

export function DemoGenerationScreen({ initial }: { initial: DemoGenerationSnapshot }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initial);
  const step = activeStep(snapshot);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      const next = await pollDemoGeneration();
      if (disposed) return;
      setSnapshot(next);
      if (next.demoStatus === "ACTIVE") {
        router.replace("/app/analytics?demo=ready");
        router.refresh();
        return;
      }
      if (next.demoStatus === "FAILED") {
        router.refresh();
        return;
      }
      timer = window.setTimeout(poll, 4000);
    };
    timer = window.setTimeout(poll, 1200);
    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [router]);

  const crawl = snapshot.crawl;
  const detail = crawl?.status === "ANALYZING"
    ? `Изучено ИИ: ${crawl.analyzedCount} из ${Math.max(crawl.crawledCount, 1)}`
    : crawl?.status === "CRAWLING"
      ? `Прочитано страниц: ${crawl.crawledCount} из ${Math.max(crawl.pageLimit, crawl.discoveredCount, 1)}`
      : "Задача поставлена в очередь";

  return (
    <div className="mx-auto flex min-h-[calc(100vh-13rem)] max-w-3xl items-center py-8">
      <section className="w-full rounded-xl border border-line bg-white p-7 shadow-[0_12px_36px_rgba(15,23,42,0.07)] sm:p-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-mint-800">Создаём ваш кабинет</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-slate-950">Анализируем компанию</h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-500">
              Используем полный рабочий анализ сайта. Найденные факты, источники и профиль останутся в кабинете после демо.
            </p>
          </div>
          <span className="metric-number shrink-0 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink-600">{detail}</span>
        </div>

        <div className="mt-8 space-y-1">
          {STEPS.map((item, index) => {
            const done = index < step;
            const current = index === step;
            return (
              <div key={item.title} className={`flex gap-4 rounded-lg border px-4 py-4 transition ${current ? "border-mint-200 bg-mint-50/70" : "border-transparent"}`}>
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${done ? "border-mint-700 bg-mint-700 text-white" : current ? "border-mint-700 bg-white text-mint-800" : "border-slate-200 bg-white text-slate-400"}`}>
                  {done ? "✓" : current ? <span className="h-2 w-2 animate-pulse rounded-full bg-mint-700" /> : index + 1}
                </span>
                <div>
                  <p className={`text-sm font-semibold ${done || current ? "text-slate-950" : "text-slate-400"}`}>{item.title}</p>
                  <p className={`mt-0.5 text-xs leading-relaxed ${done || current ? "text-ink-500" : "text-slate-400"}`}>{item.description}</p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-7 border-t border-line pt-5">
          <p className="text-xs leading-relaxed text-ink-500">
            Анализ продолжится в фоне, даже если закрыть эту вкладку. Обычно время зависит от размера сайта и количества страниц.
          </p>
        </div>
      </section>
    </div>
  );
}
