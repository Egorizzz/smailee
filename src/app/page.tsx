import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { LeadForm } from "@/components/LeadForm";
import { ProductMock } from "@/components/ProductMock";
import { EmailGallery } from "@/components/EmailGallery";

const pains = [
  "Рассылки делаем постоянно — а ответов почти нет.",
  "Менеджер пишет письма с GPT, но результат слабый, и всё приходится перепроверять.",
  "Письма улетают в спам или их просто не открывают.",
  "На входящие ответы нет времени — отвечаем вручную и с задержкой.",
  "Непонятно, какой текст вообще работает, а какой нет.",
  "Нанимать отдельного маркетолога или SDR ради этого — дорого.",
];

const steps = [
  { n: "01", title: "Расскажите про бизнес", text: "Дайте ссылку на сайт и опишите, кого ищете. AI изучит ваш оффер и нишу." },
  { n: "02", title: "Загрузите базу", text: "CSV с контактами. AI напишет персональные письма — не «рассылку», а похожие на личные." },
  { n: "03", title: "Запустите кампанию", text: "Smailee сам отправляет письма с правильной доставляемостью и следит за ответами." },
  { n: "04", title: "Получайте тёплых лидов", text: "AI отвечает откликнувшимся, квалифицирует и складывает готовых лидов вам в кабинет." },
];

const features = [
  { img: "/generated/feature-writing.webp", title: "Персональные письма, а не спам", text: "AI пишет под ваш оффер и нишу так, будто письмо составил человек. Несколько вариантов на выбор." },
  { img: "/generated/feature-dialog.webp", title: "AI ведёт переписку за вас", text: "Отвечает на входящие письма, задаёт уточняющие вопросы и доводит до лида — без вашего участия." },
  { img: "/generated/feature-leads.webp", title: "Только тёплые лиды", text: "Квалификация: тёплый / холодный / нецелевой. Вы тратите время только на тех, кто реально готов." },
  { img: "/generated/feature-analytics.webp", title: "Доставляемость и аналитика", text: "SPF/DKIM, прогрев домена, отписки, open/reply rate — репутация в порядке, видно что работает." },
];

// Цифры-гипотезы (формат «до X» — юридически безопасно)
const metrics = [
  { value: "до ×3", label: "больше ответов из холодной базы" },
  { value: "до 150 000 ₽", label: "экономия в месяц vs найм SDR" },
  { value: "~5 минут", label: "до запуска первой кампании" },
  { value: "24/7", label: "AI отвечает лидам без вас" },
];

export default function Home() {
  return (
    <>
      <Header />

      {/* ── HERO ── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 brand-gradient-soft -z-10" />
        <div className="grid-bg absolute inset-0 -z-10 opacity-60" />
        <div className="blob blur-3xl left-[-80px] top-[-60px] h-72 w-72 bg-mint-300" />
        <div className="blob blur-3xl right-[-60px] top-[120px] h-72 w-72 bg-indigo-300" />

        <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-10 px-5 py-16 md:grid-cols-2 md:py-24">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-mint-200 bg-white/80 px-3 py-1 text-xs font-medium text-mint-700 backdrop-blur">
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
              <a href="#cta" className="rounded-full brand-gradient-vivid px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:opacity-90 glow">
                Записаться на демо
              </a>
              <a href="#how" className="rounded-full border border-line bg-white px-6 py-3 text-sm font-semibold text-ink-700 transition hover:border-ink-500">
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
            <img src="/generated/hero.webp" alt="AI сам отправляет письма, пока вы отдыхаете" className="w-full drop-shadow-xl" />
          </div>
        </div>
      </section>

      {/* ── ЦИФРЫ (до X) ── */}
      <section className="relative border-y border-line bg-slate-900">
        <div className="grid-bg absolute inset-0 opacity-20" />
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-5 py-12 lg:grid-cols-4">
          {metrics.map((m) => (
            <div key={m.label} className="text-center">
              <div className="text-3xl font-extrabold text-white md:text-4xl">
                <span className="bg-gradient-to-r from-mint-400 to-indigo-300 bg-clip-text text-transparent">
                  {m.value}
                </span>
              </div>
              <div className="mt-2 text-sm text-slate-300">{m.label}</div>
            </div>
          ))}
        </div>
        <p className="pb-8 text-center text-xs text-slate-400">
          Оценочные ориентиры на основе типовых сценариев. Реальные результаты зависят от базы и ниши.
        </p>
      </section>

      {/* ── БОЛИ ── */}
      <section id="pains" className="mx-auto max-w-6xl px-5 py-16 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">Знакомо?</h2>
          <p className="mt-3 text-ink-700">Так выглядит email-маркетинг у большинства компаний, оказывающих услуги.</p>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {pains.map((p, i) => (
            <div key={i} className="flex items-start gap-3 rounded-xl border border-line bg-white p-5">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-50 text-sm text-red-400">✕</span>
              <p className="text-ink-700">{p}</p>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-10 max-w-2xl text-center text-lg font-medium text-slate-900">
          Проблема не в том, чтобы «написать письмо». Проблема — получить{" "}
          <span className="text-gradient">ответы и лидов</span> из холодной базы. Именно это делает Smailee.
        </p>
      </section>

      {/* ── КАК РАБОТАЕТ ── */}
      <section id="how" className="relative overflow-hidden bg-surface py-16 md:py-24">
        <div className="blob blur-3xl left-1/2 top-0 h-72 w-72 bg-indigo-200" />
        <div className="relative z-10 mx-auto max-w-6xl px-5">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">Нажал — получил лида</h2>
            <p className="mt-3 text-ink-700">Четыре шага от вашей базы до тёплого лида в кабинете.</p>
          </div>
          <div className="mt-12 grid gap-10 lg:grid-cols-2 lg:items-center">
            <ol className="space-y-6">
              {steps.map((s) => (
                <li key={s.n} className="flex gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl brand-gradient-vivid text-sm font-bold text-white glow">{s.n}</span>
                  <div>
                    <div className="font-semibold text-slate-900">{s.title}</div>
                    <p className="mt-1 text-sm text-ink-700">{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div>
              <ProductMock />
              <p className="mt-3 text-center text-xs text-ink-500">
                Так вы видите переписку в кабинете. Клиент отвечает из своей почты — AI отвечает ему письмом и помечает лид.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── ГАЛЕРЕЯ ПИСЕМ ── */}
      <section id="emails" className="mx-auto max-w-6xl px-5 py-16 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">
            Не просто текст — <span className="text-gradient">красивые письма</span>
          </h2>
          <p className="mt-3 text-ink-700">
            Smailee генерирует и оформление, и содержание. Готовые HTML-шаблоны для
            холодных писем, анонсов, дайджестов и промо — AI наполнит их под ваш оффер.
          </p>
        </div>
        <div className="mt-12">
          <EmailGallery />
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section id="features" className="bg-surface py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-5">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">Что умеет Smailee</h2>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            {features.map((f) => (
              <div key={f.title} className="flex flex-col gap-4 rounded-2xl border border-line bg-white p-6 transition hover:shadow-lg hover:shadow-indigo-100 sm:flex-row sm:items-start">
                <div className="shrink-0 overflow-hidden rounded-xl bg-surface sm:w-32">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.img} alt="" className="h-32 w-full object-cover" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">{f.title}</h3>
                  <p className="mt-2 text-sm text-ink-700">{f.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ЦЕНА ── */}
      <section id="pricing" className="py-16 md:py-24">
        <div className="mx-auto max-w-3xl px-5 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">Дешевле, чем один менеджер по продажам</h2>
          <div className="relative mx-auto mt-10 max-w-md overflow-hidden rounded-3xl border border-line bg-white p-8 shadow-xl shadow-indigo-100">
            <div className="blob blur-3xl right-[-40px] top-[-40px] h-40 w-40 bg-mint-300" />
            <div className="relative z-10 text-sm font-semibold uppercase tracking-wide text-mint-700">Тариф Старт</div>
            <div className="mt-4 flex items-end justify-center gap-1">
              <span className="text-5xl font-bold text-slate-900">7 999</span>
              <span className="mb-2 text-lg text-ink-500">₽/мес</span>
            </div>
            <ul className="mt-6 space-y-3 text-left text-sm text-ink-700">
              {[
                "Персональные AI-письма + HTML-шаблоны",
                "AI ведёт переписку и квалифицирует лидов",
                "Доставляемость: SPF/DKIM, прогрев, отписки",
                "Аналитика: open rate, reply rate, клики",
                "Передача лидов в Битрикс24",
                "Ручной онбординг — настроим вместе",
              ].map((li) => (
                <li key={li} className="flex items-start gap-2">
                  <span className="mt-0.5 text-mint-500">✓</span>{li}
                </li>
              ))}
            </ul>
            <a href="#cta" className="mt-8 block rounded-lg brand-gradient-vivid px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 glow">
              Записаться на демо
            </a>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section id="cta" className="mx-auto max-w-6xl px-5 py-16 md:py-24">
        <div className="relative grid gap-10 overflow-hidden rounded-3xl border border-line bg-white p-8 shadow-lg md:grid-cols-2 md:items-center md:p-12">
          <div className="blob blur-3xl left-[-40px] bottom-[-40px] h-56 w-56 bg-indigo-200" />
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">
              Покажем, как AI приведёт первых лидов из вашей базы
            </h2>
            <p className="mt-4 text-ink-700">
              Запишитесь на демо — покажем продукт вживую, вместе настроим тестовую
              кампанию под вашу нишу и запустим на вашей базе. Первые ответы за несколько дней.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-ink-700">
              <li className="flex items-center gap-2"><span className="text-mint-500">✓</span> Демо продукта под вашу задачу</li>
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
