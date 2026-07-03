import Link from "next/link";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { LeadForm } from "@/components/LeadForm";
import { ProductMock } from "@/components/ProductMock";

const pains = [
  "Рассылки делаем постоянно — а ответов почти нет.",
  "Менеджер пишет письма с GPT, но результат слабый, и всё приходится перепроверять.",
  "Письма улетают в спам или их просто не открывают.",
  "На входящие ответы нет времени — отвечаем вручную и с задержкой.",
  "Непонятно, какой текст вообще работает, а какой нет.",
  "Нанимать отдельного маркетолога или SDR ради этого — дорого.",
];

const steps = [
  {
    n: "01",
    title: "Расскажите про бизнес",
    text: "Дайте ссылку на сайт и опишите, кого ищете. AI изучит ваш оффер и нишу.",
  },
  {
    n: "02",
    title: "Загрузите базу",
    text: "CSV с контактами. AI напишет персональные письма — не «рассылку», а похожие на личные.",
  },
  {
    n: "03",
    title: "Запустите кампанию",
    text: "Smailee сам отправляет письма с правильной доставляемостью и следит за ответами.",
  },
  {
    n: "04",
    title: "Получайте тёплых лидов",
    text: "AI отвечает откликнувшимся, квалифицирует и складывает готовых лидов вам в кабинет.",
  },
];

const features = [
  {
    img: "/generated/feature-writing.webp",
    title: "Персональные письма, а не спам",
    text: "AI пишет под ваш оффер и нишу так, будто письмо составил человек. Несколько вариантов на выбор.",
  },
  {
    img: "/generated/feature-dialog.webp",
    title: "AI ведёт диалог за вас",
    text: "Отвечает на входящие, задаёт уточняющие вопросы и доводит переписку до лида — без вашего участия.",
  },
  {
    img: "/generated/feature-leads.webp",
    title: "Только тёплые лиды",
    text: "Квалификация: тёплый / холодный / нецелевой. Вы тратите время только на тех, кто реально готов.",
  },
  {
    img: "/generated/feature-analytics.webp",
    title: "Доставляемость и аналитика",
    text: "SPF/DKIM, прогрев домена, open rate и reply rate — видно, что работает, а что нет.",
  },
];

export default function Home() {
  return (
    <>
      <Header />

      {/* ── HERO ── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 brand-gradient-soft -z-10" />
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-16 md:grid-cols-2 md:py-24">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-mint-200 bg-white px-3 py-1 text-xs font-medium text-mint-700">
              <span className="h-2 w-2 rounded-full bg-mint-500" />
              AI-агент для холодной лидогенерации
            </div>
            <h1 className="mt-5 text-4xl font-bold leading-tight tracking-tight text-slate-900 md:text-5xl">
              Тёплые лиды из холодной базы —{" "}
              <span className="text-gradient">без найма менеджера</span>
            </h1>
            <p className="mt-5 text-lg text-ink-700">
              Загрузите базу — AI напишет персональные письма, сам ответит тем,
              кто откликнулся, и отдаст вам только готовых к разговору лидов.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="#cta"
                className="rounded-full brand-gradient px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:opacity-90"
              >
                Получить тестовую кампанию
              </a>
              <a
                href="#how"
                className="rounded-full border border-line bg-white px-6 py-3 text-sm font-semibold text-ink-700 transition hover:border-ink-500"
              >
                Как это работает
              </a>
            </div>
            <div className="mt-6 flex items-center gap-6 text-sm text-ink-500">
              <span>Первые лиды — за несколько дней</span>
              <span className="hidden sm:inline">·</span>
              <span className="hidden sm:inline">Онбординг вручную</span>
            </div>
          </div>
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/generated/hero.webp"
              alt="AI сам отправляет письма, пока вы отдыхаете"
              className="w-full"
            />
          </div>
        </div>
      </section>

      {/* ── БОЛИ ── */}
      <section id="pains" className="mx-auto max-w-6xl px-5 py-16 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">
            Знакомо?
          </h2>
          <p className="mt-3 text-ink-700">
            Так выглядит email-маркетинг у большинства компаний, оказывающих
            услуги.
          </p>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {pains.map((p, i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-xl border border-line bg-white p-5"
            >
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-50 text-sm text-red-400">
                ✕
              </span>
              <p className="text-ink-700">{p}</p>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-10 max-w-2xl text-center text-lg font-medium text-slate-900">
          Проблема не в том, чтобы «написать письмо». Проблема — получить{" "}
          <span className="text-gradient">ответы и лидов</span> из холодной базы.
          Именно это делает Smailee.
        </p>
      </section>

      {/* ── КАК РАБОТАЕТ (Про продукт) ── */}
      <section id="how" className="bg-surface py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-5">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">
              Нажал — получил лида
            </h2>
            <p className="mt-3 text-ink-700">
              Четыре шага от вашей базы до тёплого лида в кабинете.
            </p>
          </div>

          <div className="mt-12 grid gap-10 lg:grid-cols-2 lg:items-center">
            <ol className="space-y-6">
              {steps.map((s) => (
                <li key={s.n} className="flex gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl brand-gradient text-sm font-bold text-white">
                    {s.n}
                  </span>
                  <div>
                    <div className="font-semibold text-slate-900">
                      {s.title}
                    </div>
                    <p className="mt-1 text-sm text-ink-700">{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div>
              <ProductMock />
              <p className="mt-3 text-center text-xs text-ink-500">
                Так выглядит диалог в кабинете: AI ответил клиенту и пометил лид
                как тёплый.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section id="features" className="mx-auto max-w-6xl px-5 py-16 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">
            Что умеет Smailee
          </h2>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {features.map((f) => (
            <div
              key={f.title}
              className="flex flex-col gap-4 rounded-2xl border border-line bg-white p-6 sm:flex-row sm:items-start"
            >
              <div className="shrink-0 overflow-hidden rounded-xl bg-surface sm:w-32">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.img} alt="" className="h-32 w-full object-cover sm:h-32" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">{f.title}</h3>
                <p className="mt-2 text-sm text-ink-700">{f.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── ЦЕНА ── */}
      <section id="pricing" className="bg-surface py-16 md:py-24">
        <div className="mx-auto max-w-3xl px-5 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">
            Дешевле, чем один менеджер по продажам
          </h2>
          <div className="mx-auto mt-10 max-w-md rounded-3xl border border-line bg-white p-8 shadow-xl shadow-slate-200/50">
            <div className="text-sm font-semibold uppercase tracking-wide text-mint-700">
              Тариф Старт
            </div>
            <div className="mt-4 flex items-end justify-center gap-1">
              <span className="text-5xl font-bold text-slate-900">7 999</span>
              <span className="mb-2 text-lg text-ink-500">₽/мес</span>
            </div>
            <ul className="mt-6 space-y-3 text-left text-sm text-ink-700">
              {[
                "Персональные AI-письма",
                "AI ведёт диалог и квалифицирует лидов",
                "Аналитика: open rate, reply rate",
                "Передача лидов в Битрикс24",
                "Ручной онбординг — настроим вместе",
              ].map((li) => (
                <li key={li} className="flex items-start gap-2">
                  <span className="mt-0.5 text-mint-500">✓</span>
                  {li}
                </li>
              ))}
            </ul>
            <a
              href="#cta"
              className="mt-8 block rounded-lg brand-gradient px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Оставить заявку
            </a>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section id="cta" className="mx-auto max-w-6xl px-5 py-16 md:py-24">
        <div className="grid gap-10 rounded-3xl border border-line bg-white p-8 shadow-lg md:grid-cols-2 md:items-center md:p-12">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">
              Покажем, как AI приведёт первых лидов из вашей базы
            </h2>
            <p className="mt-4 text-ink-700">
              Оставьте заявку — вместе настроим тестовую кампанию под вашу нишу и
              запустим её на вашей базе. Первые ответы увидите за несколько дней.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-ink-700">
              <li className="flex items-center gap-2"><span className="text-mint-500">✓</span> Без предоплаты за тест</li>
              <li className="flex items-center gap-2"><span className="text-mint-500">✓</span> Настройка домена и писем — на нас</li>
              <li className="flex items-center gap-2"><span className="text-mint-500">✓</span> Отвечаем в течение дня</li>
            </ul>
          </div>
          <div className="rounded-2xl bg-surface p-6">
            <LeadForm />
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
