import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { LeadForm } from "@/components/LeadForm";
import { ProductMock } from "@/components/ProductMock";
import { EmailGallery } from "@/components/EmailGallery";
import { Reveal } from "@/components/Reveal";
import { Counter } from "@/components/Counter";
import { PLANS } from "@/lib/plans";

const steps = [
  {
    n: "01",
    title: "Расскажите про бизнес",
    text: "Сайт и описание, кого ищете. AI изучает оффер и нишу — письма пишутся под них, а не по шаблону.",
    icon: "/generated/icon-write.jpg",
  },
  {
    n: "02",
    title: "Загрузите базу — AI отправит",
    text: "CSV с контактами. Каждое письмо уникально (spintax-движок), рассылка идёт с прогретого пула ящиков — без единого письма в спам.",
    icon: "/generated/icon-dialog.jpg",
  },
  {
    n: "03",
    title: "Получайте тёплых лидов",
    text: "AI сам отвечает откликнувшимся, квалифицирует и складывает готовых к разговору лидов в кабинет и CRM.",
    icon: "/generated/icon-leads.jpg",
  },
];

const metrics = [
  { to: 3, prefix: "до ×", suffix: "", label: "больше ответов из холодной базы" },
  { to: 150000, prefix: "до ", suffix: " ₽", label: "экономия в месяц против найма SDR" },
  { to: 14, prefix: "", suffix: " дней", label: "автоматический прогрев ящиков перед стартом" },
  { to: 24, prefix: "", suffix: "/7", label: "AI отвечает лидам без вашего участия" },
];

const comparisonRows: { label: string; manual: string; typical: string; smailee: string }[] = [
  { label: "Кто отвечает на входящие", manual: "менеджер вручную", typical: "никто — только рассылка", smailee: "AI, сразу" },
  { label: "Уникальность текста", manual: "один шаблон всем", typical: "один шаблон всем", smailee: "spintax на каждое письмо" },
  { label: "Прогрев ящиков", manual: "нет", typical: "нет", smailee: "14 дней, автоматически" },
  { label: "Квалификация ответивших", manual: "вручную, если есть время", typical: "—", smailee: "AI: тёплый / холодный / нецелевой" },
  { label: "Результат на выходе", manual: "список открытых писем", typical: "open rate в отчёте", smailee: "готовый лид в кабинете и CRM" },
];

export default function Home() {
  return (
    <>
      <Header />

      {/* ── HERO ── */}
      <section className="grain-bg-subtle relative overflow-hidden bg-[color:var(--background)]">
        <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-12 px-5 py-24 md:grid-cols-12 md:py-32">
          <div className="md:col-span-7">
            <div className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-1 text-xs font-medium text-ink-500">
              <span className="h-1.5 w-1.5 rounded-full bg-mint-500" />
              AI для холодной лидогенерации
            </div>
            <h1 className="font-display mt-6 text-5xl font-semibold leading-[1.05] text-[color:var(--foreground)] md:text-6xl lg:text-7xl">
              Тёплые лиды из холодной базы — без найма менеджера
            </h1>
            <p className="mt-6 max-w-lg text-lg text-ink-700">
              Загрузите базу — AI напишет письма, сам ответит откликнувшимся
              и отдаст только готовых к разговору лидов.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-6">
              <a href="#cta" className="rounded-lg bg-mint-500 px-7 py-3.5 text-sm font-semibold text-white transition hover:bg-mint-600">
                Попробовать
              </a>
              <a href="#how" className="group inline-flex items-center gap-1.5 text-sm font-medium text-ink-700 transition hover:text-[color:var(--foreground)]">
                Как это работает
                <span className="transition group-hover:translate-x-0.5">→</span>
              </a>
            </div>
            <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ink-500">
              <span><span className="font-mono tabular text-[color:var(--foreground)]">≤30</span> писем/день с ящика</span>
              <span className="hidden sm:inline text-line">·</span>
              <span><span className="font-mono tabular text-[color:var(--foreground)]">14</span> дней прогрева перед стартом</span>
              <span className="hidden sm:inline text-line">·</span>
              <span>онбординг вручную</span>
            </div>
          </div>
          <div className="md:col-span-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/generated/hero-v2.jpg"
              alt=""
              className="w-full rounded-xl border border-line"
            />
          </div>
        </div>
      </section>

      {/* ── ЦИФРЫ (тёмная секция) ── */}
      <section
        className="relative overflow-hidden bg-dark-bg bg-cover bg-center"
        style={{ backgroundImage: "url(/generated/dark-texture.jpg)" }}
      >
        <div className="absolute inset-0 bg-dark-bg/70" />
        <Reveal>
          <div className="relative z-10 mx-auto grid max-w-6xl grid-cols-2 gap-8 px-5 py-20 lg:grid-cols-4">
            {metrics.map((m) => (
              <div key={m.label}>
                <div className="text-3xl font-semibold text-lime-400 md:text-4xl">
                  <Counter to={m.to} prefix={m.prefix} suffix={m.suffix} />
                </div>
                <div className="mt-2 text-sm text-white/60">{m.label}</div>
              </div>
            ))}
          </div>
        </Reveal>
        <p className="relative z-10 pb-10 text-center text-xs text-white/40">
          Оценочные ориентиры на основе типовых сценариев. Реальные результаты зависят от базы и ниши.
        </p>
      </section>

      {/* ── БОЛИ ── */}
      <section id="pains" className="mx-auto max-w-6xl px-5 py-28 md:py-36">
        <Reveal>
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl font-semibold text-[color:var(--foreground)] md:text-4xl">Знакомо?</h2>
            <p className="mt-3 text-ink-700">Так выглядит email-маркетинг у большинства сервисных компаний.</p>
          </div>
        </Reveal>
        <div className="mt-10 grid gap-3 md:grid-cols-2">
          {[
            "Рассылки делаем постоянно — а ответов почти нет.",
            "Менеджер пишет письма с GPT, но результат слабый, и всё приходится перепроверять.",
            "Письма улетают в спам или их просто не открывают.",
            "На входящие ответы нет времени — отвечаем вручную и с задержкой.",
            "Непонятно, какой текст вообще работает, а какой нет.",
            "Нанимать отдельного маркетолога или SDR ради этого — дорого.",
          ].map((p, i) => (
            <Reveal key={i} delay={i * 40}>
              <div className="flex items-start gap-3 rounded-xl border border-line bg-white p-5">
                <span className="mt-0.5 font-mono text-sm text-ink-500">{String(i + 1).padStart(2, "0")}</span>
                <p className="text-ink-700">{p}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal>
          <p className="mt-10 max-w-2xl text-lg font-medium text-[color:var(--foreground)]">
            Проблема не в том, чтобы «написать письмо». Проблема — получить{" "}
            <span className="text-gradient">ответы и лидов</span> из холодной базы.
          </p>
        </Reveal>
      </section>

      {/* ── КАК РАБОТАЕТ (асимметрия 5/7) ── */}
      <section id="how" className="bg-surface py-28 md:py-36">
        <div className="mx-auto max-w-6xl px-5">
          <Reveal>
            <div className="max-w-2xl">
              <h2 className="font-display text-3xl font-semibold text-[color:var(--foreground)] md:text-4xl">Три шага до лида</h2>
              <p className="mt-3 text-ink-700">От вашей базы до тёплого лида в кабинете.</p>
            </div>
          </Reveal>
          <div className="mt-14 grid gap-12 md:grid-cols-12 md:items-start">
            <ol className="space-y-8 md:col-span-5">
              {steps.map((s) => (
                <Reveal key={s.n}>
                  <li className="flex gap-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.icon} alt="" className="h-14 w-14 shrink-0 rounded-lg border border-line object-cover" />
                    <div>
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-xs text-mint-600">{s.n}</span>
                        <div className="font-display font-semibold text-[color:var(--foreground)]">{s.title}</div>
                      </div>
                      <p className="mt-1 text-sm text-ink-700">{s.text}</p>
                    </div>
                  </li>
                </Reveal>
              ))}
            </ol>
            <div className="md:col-span-7">
              <Reveal>
                <ProductMock />
                <p className="mt-3 text-xs text-ink-500">
                  Так выглядит переписка в кабинете. Клиент отвечает из своей почты — AI отвечает письмом и помечает лид.
                </p>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* ── ГАЛЕРЕЯ ПИСЕМ ── */}
      <section id="emails" className="mx-auto max-w-6xl px-5 py-28 md:py-36">
        <Reveal>
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl font-semibold text-[color:var(--foreground)] md:text-4xl">
              Не просто текст — готовые письма
            </h2>
            <p className="mt-3 text-ink-700">
              AI генерирует и оформление, и содержание. Шаблоны для холодных писем,
              анонсов, дайджестов и промо — под ваш оффер.
            </p>
          </div>
        </Reveal>
        <Reveal>
          <div className="mt-12">
            <EmailGallery />
          </div>
        </Reveal>
      </section>

      {/* ── ВОЗМОЖНОСТИ: bento, один блок крупный ── */}
      <section id="features" className="bg-surface py-28 md:py-36">
        <div className="mx-auto max-w-6xl px-5">
          <Reveal>
            <div className="max-w-2xl">
              <h2 className="font-display text-3xl font-semibold text-[color:var(--foreground)] md:text-4xl">Что внутри</h2>
            </div>
          </Reveal>

          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {/* крупный блок — УТП продукта */}
            <Reveal className="md:col-span-2 md:row-span-2">
              <div className="flex h-full flex-col justify-between rounded-xl border border-line bg-white p-7">
                <div>
                  <h3 className="font-display text-xl font-semibold text-[color:var(--foreground)]">
                    AI сам ведёт переписку с ответившими
                  </h3>
                  <p className="mt-2 max-w-md text-sm text-ink-700">
                    Не «прислали ответы вам» — AI отвечает письмом от вашего имени,
                    квалифицирует и передаёт готового лида.
                  </p>
                </div>
                <div className="mt-6 space-y-2">
                  <div className="max-w-sm rounded-lg border border-line bg-surface px-4 py-2.5 text-xs text-ink-700">
                    Здравствуйте! Интересно, сколько это стоит для команды 20 человек?
                  </div>
                  <div className="ml-6 max-w-sm rounded-lg border border-mint-200 bg-mint-50 px-4 py-2.5 text-xs text-ink-700">
                    Добрый день! Отлично подойдёт для 20 человек. На какой email прислать расчёт?
                  </div>
                  <div className="ml-6 inline-flex items-center gap-1.5 rounded-lg bg-mint-100 px-2.5 py-1 text-xs font-semibold text-mint-700">
                    Тёплый лид
                  </div>
                </div>
              </div>
            </Reveal>

            <Reveal>
              <div className="rounded-xl border border-line bg-white p-6">
                <h3 className="font-medium text-[color:var(--foreground)]">Каждое письмо уникально</h3>
                <p className="mt-2 text-sm text-ink-700">Spintax-движок ротирует формулировки — без спам-фильтров за копипаст.</p>
                <div className="mt-4 rounded-lg bg-surface px-3 py-2 font-mono text-xs text-ink-500">
                  {"{Добрый день|Здравствуйте}, {{name}}"}
                </div>
              </div>
            </Reveal>

            <Reveal>
              <div className="rounded-xl border border-line bg-white p-6">
                <h3 className="font-medium text-[color:var(--foreground)]">Прогрев без вас</h3>
                <p className="mt-2 text-sm text-ink-700">Ящики 14 дней автоматически наращивают репутацию перед стартом.</p>
                <div className="mt-4">
                  <div className="flex justify-between font-mono text-xs text-ink-500">
                    <span>день 9 из 14</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface">
                    <div className="h-full w-[64%] bg-mint-500" />
                  </div>
                </div>
              </div>
            </Reveal>

            <Reveal>
              <div className="rounded-xl border border-line bg-white p-6">
                <h3 className="font-medium text-[color:var(--foreground)]">Здоровье флота ящиков</h3>
                <p className="mt-2 text-sm text-ink-700">Отслеживаем отказы и авто-приостанавливаем выгоревшие ящики.</p>
                <div className="mt-4 font-mono text-2xl text-mint-600">92</div>
                <div className="text-xs text-ink-500">health score</div>
              </div>
            </Reveal>

            <Reveal>
              <div className="rounded-xl border border-line bg-white p-6">
                <h3 className="font-medium text-[color:var(--foreground)]">Воронка на виду</h3>
                <p className="mt-2 text-sm text-ink-700">Open rate, reply rate, конверсия в тёплых — без лишних отчётов.</p>
                <div className="mt-4 flex gap-4 font-mono text-sm text-[color:var(--foreground)]">
                  <span>33% <span className="text-ink-500">open</span></span>
                  <span>17% <span className="text-ink-500">reply</span></span>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── ОТСТРОЙКА: сравнение ── */}
      <section className="mx-auto max-w-5xl px-5 py-28 md:py-36">
        <Reveal>
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl font-semibold text-[color:var(--foreground)] md:text-4xl">
              Не рассылка. Не абонемент на письма.
            </h2>
            <p className="mt-3 text-ink-700">Чем это отличается от ручной работы и типового сервиса рассылок.</p>
          </div>
        </Reveal>
        <Reveal>
          <div className="mt-10 overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-5 py-3 font-medium"> </th>
                  <th className="px-5 py-3 font-medium">Вручную</th>
                  <th className="px-5 py-3 font-medium">Типовой сервис</th>
                  <th className="px-5 py-3 font-medium text-mint-700">Smailee</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {comparisonRows.map((r) => (
                  <tr key={r.label} className="border-b border-line last:border-0">
                    <td className="px-5 py-4 font-sans text-ink-700">{r.label}</td>
                    <td className="px-5 py-4 text-ink-500">{r.manual}</td>
                    <td className="px-5 py-4 text-ink-500">{r.typical}</td>
                    <td className="px-5 py-4 text-[color:var(--foreground)]">{r.smailee}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </section>

      {/* ── ЦЕНЫ (реальные тарифы, средний — рамка изумруда) ── */}
      <section id="pricing" className="bg-surface py-28 md:py-36">
        <div className="mx-auto max-w-5xl px-5">
          <Reveal>
            <div className="max-w-2xl">
              <h2 className="font-display text-3xl font-semibold text-[color:var(--foreground)] md:text-4xl">
                Дешевле, чем один менеджер по продажам
              </h2>
            </div>
          </Reveal>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {(["TRIAL", "START", "PRO"] as const).map((key) => {
              const p = PLANS[key];
              const isMiddle = key === "START";
              return (
                <Reveal key={key}>
                  <div
                    className={`h-full rounded-xl border bg-white p-7 ${
                      isMiddle ? "border-2 border-mint-500" : "border-line"
                    }`}
                  >
                    {isMiddle && (
                      <div className="mb-3 inline-block rounded-md bg-mint-100 px-2 py-0.5 text-xs font-semibold text-mint-700">
                        Популярный
                      </div>
                    )}
                    <div className="text-sm font-medium text-ink-500">{p.name}</div>
                    <div className="mt-2 flex items-end gap-1">
                      <span className="font-mono text-4xl font-semibold text-[color:var(--foreground)]">
                        {p.priceRub === 0 ? "0" : p.priceRub.toLocaleString("ru-RU")}
                      </span>
                      <span className="mb-1 text-sm text-ink-500">₽/мес</span>
                    </div>
                    <ul className="mt-6 space-y-2.5 text-sm text-ink-700">
                      <li>до <span className="font-mono">{p.maxContacts.toLocaleString("ru-RU")}</span> контактов в базе</li>
                      <li>до <span className="font-mono">{p.maxEmailsPerMonth.toLocaleString("ru-RU")}</span> писем в месяц</li>
                      <li>AI-диалог и квалификация лидов</li>
                      <li>прогрев и мониторинг флота ящиков</li>
                    </ul>
                    <a
                      href="#cta"
                      className={`mt-7 block rounded-lg px-4 py-3 text-center text-sm font-semibold transition ${
                        isMiddle
                          ? "bg-mint-500 text-white hover:bg-mint-600"
                          : "border border-line text-ink-700 hover:border-mint-400"
                      }`}
                    >
                      Попробовать
                    </a>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── ФИНАЛЬНЫЙ CTA (тёмная секция) ── */}
      <section id="cta" className="grain-bg relative overflow-hidden bg-dark-bg py-28 md:py-36">
        <div className="relative z-10 mx-auto grid max-w-6xl gap-12 px-5 md:grid-cols-2 md:items-center">
          <Reveal>
            <div>
              <h2 className="font-display text-3xl font-semibold text-white md:text-4xl">
                Покажем, как AI приведёт первых лидов из вашей базы
              </h2>
              <p className="mt-4 text-white/60">
                Запишитесь на демо — покажем продукт вживую, вместе настроим
                тестовую кампанию под вашу нишу и запустим на вашей базе.
              </p>
              <ul className="mt-6 space-y-2 text-sm text-white/70">
                <li>Демо продукта под вашу задачу</li>
                <li>Настройка домена и писем — на нас</li>
                <li>Отвечаем в течение дня</li>
              </ul>
            </div>
          </Reveal>
          <Reveal>
            <div className="rounded-xl bg-white p-6">
              <LeadForm />
            </div>
          </Reveal>
        </div>
      </section>

      <Footer />
    </>
  );
}
