import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { calcInfraPlan } from "@/lib/mail/planCalculator";
import { supportedProviders } from "@/lib/mail/profiles";
import { MailboxForm } from "../mailboxes/MailboxForm";
import { closeSetup, saveBusinessStep, requestSetupHelp } from "./actions";

/**
 * Онбординг-визард (UX TO BE, R2): последовательная настройка «за руку» —
 * с пути сойти нельзя (шаг открывается только когда предыдущий завершён),
 * но выйти можно всегда: ✕ или «Настройте всё за меня».
 *
 * Прогресс не хранится отдельным полем — он ВЫВОДИТСЯ из данных (заполнен ли
 * бизнес, есть ли ящики/контакты/кампании), поэтому визард всегда честно
 * показывает реальное состояние кабинета и продолжается с нужного места.
 */

const STEPS = [
  "О бизнесе",
  "Инфраструктура",
  "Подключение ящиков",
  "Прогрев",
  "Контакты",
  "Первая кампания",
];

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; volume?: string; help?: string; error?: string }>;
}) {
  const user = await requireUser();
  const { s, volume, help, error } = await searchParams;

  const [mailboxes, contactsCount, campaignsCount] = await Promise.all([
    prisma.mailbox.findMany({ where: { userId: user.id } }),
    prisma.contact.count({ where: { userId: user.id } }),
    prisma.campaign.count({ where: { userId: user.id } }),
  ]);

  const businessDone = Boolean(user.offer && user.targetAudience);
  const mailboxesDone = mailboxes.length > 0;
  const warming = mailboxes.filter((m) => m.warmupState !== "off");
  const warmupStarted = warming.length > 0;
  const hasWarm = mailboxes.some((m) => m.warmupState === "warm");
  const contactsDone = contactsCount > 0;
  const campaignDone = campaignsCount > 0;

  const done = [businessDone, mailboxesDone, mailboxesDone, warmupStarted || hasWarm, contactsDone, campaignDone];
  const firstIncomplete = done.findIndex((d) => !d) + 1; // 1..6, 0 → всё готово
  const allDone = firstIncomplete === 0;

  // шаги 2 и 4 — информационные: с них можно шагнуть вперёд на один
  const maxAllowed = allDone
    ? 6
    : firstIncomplete === 2 || firstIncomplete === 4
      ? firstIncomplete + 1
      : firstIncomplete;
  const requested = Number(s) || 0;
  const step = allDone
    ? 7 // финальный экран
    : requested >= 1 && requested <= maxAllowed
      ? requested
      : firstIncomplete;

  // экран 0 (велком): совсем пустой кабинет и шаг не запрошен явно
  const showWelcome = !businessDone && !mailboxesDone && !contactsDone && !campaignDone && !requested && !help;

  const rampDays = config.warmup.rampDays;
  const dayMs = config.warmup.dayMs;
  const maxWarmupDay = warming.reduce((m, x) => Math.max(m, x.warmupDay), 0);
  const readyDate =
    warming.length > 0 && warming[0].warmupStartedAt
      ? new Date(
          Math.min(...warming.map((m) => (m.warmupStartedAt ?? new Date()).getTime())) + rampDays * dayMs
        )
      : null;

  const profiles = supportedProviders();
  const parsedVolume = volume ? Math.max(0, Math.floor(Number(volume))) : 0;
  const plan = parsedVolume > 0 ? calcInfraPlan(parsedVolume, user.companyName ?? undefined) : null;

  // ── «Настройте всё за меня» ──
  if (help) {
    return (
      <Shell>
        <div className="mx-auto max-w-lg text-center">
          <h1 className="text-2xl font-bold text-slate-900">Настроим всё за вас</h1>
          <p className="mt-2 text-ink-500">
            Оставьте контакт — специалист свяжется, поможет поднять домены и ящики
            и запустит первую кампанию вместе с вами.
          </p>
          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
          )}
          <form action={requestSetupHelp} className="mt-6 space-y-3 text-left">
            <input name="name" placeholder="Ваше имя" className="input" required />
            <input name="contact" placeholder="Телефон / Telegram / email" className="input" required />
            <input name="preferredTime" placeholder="Удобное время (по желанию)" className="input" />
            <button className="w-full rounded-lg brand-gradient px-6 py-3 text-sm font-semibold text-white">
              Записаться на онлайн-настройку
            </button>
          </form>
          <Link href="/app/setup" className="mt-4 inline-block text-sm text-ink-500 hover:text-slate-900">
            ← Вернуться к самостоятельной настройке
          </Link>
        </div>
      </Shell>
    );
  }

  // ── Экран 0: время и результат ДО первой формы ──
  if (showWelcome) {
    return (
      <Shell>
        <div className="mx-auto max-w-xl text-center">
          <h1 className="text-3xl font-bold text-slate-900">
            Настроим рассылку, которая сама приносит лидов
          </h1>
          <div className="mt-6 space-y-3 text-left">
            <div className="rounded-xl border border-line bg-white p-4">
              ⏱ <b>~30 минут вашего времени</b> + 14 дней автоматического прогрева ящиков
              (идёт сам, без вашего участия).
            </div>
            <div className="rounded-xl border border-mint-400 bg-mint-100/40 p-4">
              🎯 <b>Результат:</b> ИИ-рассылка, которая сама ведёт переписку с ответившими
              и отдаёт тёплых лидов — в этот кабинет и вашу CRM.
            </div>
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/app/setup?s=1"
              className="rounded-lg brand-gradient px-8 py-3 text-sm font-semibold text-white"
            >
              Начать настройку
            </Link>
            <Link
              href="/app/setup?help=1"
              className="rounded-lg border border-indigo-200 bg-indigo-50 px-6 py-3 text-sm font-semibold text-indigo-700"
            >
              Настройте всё за меня →
            </Link>
          </div>
          <p className="mt-3 text-xs text-ink-500">
            «Настройте за меня» — запись на онлайн-настройку со специалистом.
          </p>
        </div>
      </Shell>
    );
  }

  // ── Финал: всё настроено ──
  if (allDone) {
    return (
      <Shell>
        <div className="mx-auto max-w-lg text-center">
          <div className="text-4xl">🎉</div>
          <h1 className="mt-3 text-2xl font-bold text-slate-900">Всё настроено</h1>
          <p className="mt-2 text-ink-500">
            {hasWarm
              ? "Ящики прогреты — кампания готова к запуску."
              : readyDate
                ? `Ящики прогреваются: кампанию можно запустить после прогрева — примерно ${readyDate.toLocaleDateString("ru-RU")}. Поставьте «Запустить после прогрева» в карточке кампании — она стартует сама.`
                : "Прогрев стартует автоматически в ближайшие минуты."}
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link href="/app/campaigns" className="rounded-lg brand-gradient px-6 py-3 text-sm font-semibold text-white">
              К кампаниям
            </Link>
            <Link href="/app/leads" className="rounded-lg border border-line px-6 py-3 text-sm font-semibold text-ink-700">
              К лидам
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* шапка визарда: прогресс + ✕ */}
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm font-semibold text-slate-900">
            Шаг {step} из 6 · {STEPS[step - 1]}
          </div>
          <div className="flex items-center gap-3">
            <Link href="/app/setup?help=1" className="text-xs text-indigo-600 hover:underline">
              Настройте всё за меня
            </Link>
            <form action={closeSetup}>
              <button className="rounded-md px-2 py-1 text-lg leading-none text-ink-500 hover:text-slate-900" aria-label="Закрыть настройку">
                ✕
              </button>
            </form>
          </div>
        </div>
        <div className="mt-3 flex gap-1.5">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full ${i + 1 < step || done[i] ? "brand-gradient" : i + 1 === step ? "bg-mint-100" : "bg-surface"}`}
            />
          ))}
        </div>

        <div className="mt-8">
          {step === 1 && (
            <>
              <h1 className="text-xl font-bold text-slate-900">Расскажите про ваш бизнес</h1>
              <p className="mt-1 text-sm text-ink-500">
                На этом ИИ построит письма и переписку. 3 поля — самое важное.
              </p>
              <form action={saveBusinessStep} className="mt-5 space-y-4">
                <input
                  name="companyName"
                  defaultValue={user.companyName ?? ""}
                  placeholder="Название компании"
                  className="input"
                />
                <input
                  name="websiteUrl"
                  defaultValue={user.websiteUrl ?? ""}
                  placeholder="Сайт (https://…)"
                  className="input"
                />
                <textarea
                  name="offer"
                  defaultValue={user.offer ?? ""}
                  rows={3}
                  placeholder="Ваш оффер: что предлагаете и в чём выгода клиента"
                  className="input"
                  required
                />
                <textarea
                  name="targetAudience"
                  defaultValue={user.targetAudience ?? ""}
                  rows={2}
                  placeholder="Целевая аудитория: ниша, роль, размер бизнеса"
                  className="input"
                  required
                />
                <button className="rounded-lg brand-gradient px-6 py-3 text-sm font-semibold text-white">
                  Дальше →
                </button>
              </form>
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="text-xl font-bold text-slate-900">Сколько нужно инфраструктуры</h1>
              <p className="mt-1 text-sm text-ink-500">
                Рассылка идёт с ВАШИХ доменов и ящиков (это защищает основной домен
                компании). Посчитаем, сколько их нужно под ваш объём.
              </p>
              <form method="get" className="mt-5 flex items-end gap-3">
                <input type="hidden" name="s" value="2" />
                <label className="block flex-1">
                  <span className="text-sm font-medium text-slate-900">Получателей в месяц</span>
                  <input
                    name="volume"
                    type="number"
                    min={1}
                    defaultValue={parsedVolume || undefined}
                    placeholder="напр. 2000"
                    className="input mt-1"
                    required
                  />
                </label>
                <button className="rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white">
                  Рассчитать
                </button>
              </form>

              {plan && (
                <div className="mt-5 space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { l: "Доменов", v: plan.domains },
                      { l: "Ящиков", v: plan.mailboxes },
                      { l: "Писем/день", v: plan.perDayNeeded },
                    ].map((x) => (
                      <div key={x.l} className="rounded-xl border border-line bg-white p-3 text-center">
                        <div className="text-xl font-bold text-slate-900">{x.v}</div>
                        <div className="text-xs text-ink-500">{x.l}</div>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-xl border border-line bg-white p-4 text-sm">
                    <b>Чек-лист (делается один раз, ~2–4 часа + ожидание DNS):</b>
                    <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-700">
                      <li>Купите нейтральный домен ({plan.domainNameHints.slice(0, 2).join(", ")}…) — не основной домен компании</li>
                      <li>Заведите Яндекс 360 для бизнеса и подтвердите домен</li>
                      <li>Добавьте DNS-записи: MX, SPF, DKIM (Яндекс покажет точные значения)</li>
                      <li>Создайте ящики-персоны ({plan.scheme}), в каждом включите IMAP и создайте пароль приложения</li>
                    </ol>
                  </div>
                </div>
              )}

              <div className="mt-6 flex gap-3">
                <Link
                  href="/app/setup?s=3"
                  className="rounded-lg brand-gradient px-6 py-3 text-sm font-semibold text-white"
                >
                  Ящики готовы — подключить →
                </Link>
              </div>
              <p className="mt-2 text-xs text-ink-500">
                Инфраструктура ещё не готова? Закройте настройку (✕) — визард продолжится
                с этого места, когда вернётесь.
              </p>
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="text-xl font-bold text-slate-900">Подключите ящики</h1>
              <p className="mt-1 text-sm text-ink-500">
                Email + пароль (приложения или от аккаунта — на выбор). Каждый ящик
                проверяется реальным подключением к почтовому серверу.
              </p>
              <div className="mt-5">
                <MailboxForm
                  providers={profiles.map((p) => ({ value: p.provider, label: p.label }))}
                  passwordHint={profiles[0]?.passwordHint ?? ""}
                  passwordSetup={profiles[0]?.passwordSetup ?? { app: [], account: [] }}
                />
              </div>
              {mailboxes.length > 0 && (
                <div className="mt-4 space-y-2">
                  {mailboxes.map((m) => (
                    <div key={m.id} className="flex items-center justify-between rounded-lg border border-line bg-white px-3 py-2 text-sm">
                      <span className="font-medium text-slate-900">{m.email}</span>
                      <span className={m.connState === "ok" ? "text-mint-700" : m.connState === "paused" ? "text-amber-700" : "text-red-600"}>
                        {m.connState === "ok" ? "✓ подключён" : m.connState === "paused" ? "ожидает проверки" : `ошибка: ${m.connError ?? m.connState}`}
                      </span>
                    </div>
                  ))}
                  <Link
                    href="/app/setup?s=4"
                    className="mt-2 inline-block rounded-lg brand-gradient px-6 py-3 text-sm font-semibold text-white"
                  >
                    Дальше →
                  </Link>
                </div>
              )}
            </>
          )}

          {step === 4 && (
            <>
              <h1 className="text-xl font-bold text-slate-900">Прогрев запущен</h1>
              <p className="mt-1 text-sm text-ink-500">
                {rampDays} дней ящики автоматически обмениваются письмами, наращивая
                репутацию у почтовых провайдеров. Это идёт само — ваше участие не нужно.
              </p>
              <div className="mt-5 rounded-xl border border-line bg-white p-5">
                {warmupStarted ? (
                  <>
                    <div className="flex items-baseline justify-between text-sm">
                      <b className="text-slate-900">День {maxWarmupDay} из {rampDays}</b>
                      {readyDate && (
                        <span className="text-ink-500">кампании можно запускать ≈ {readyDate.toLocaleDateString("ru-RU")}</span>
                      )}
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface">
                      <div
                        className="h-full brand-gradient"
                        style={{ width: `${Math.min(100, Math.round((maxWarmupDay / rampDays) * 100))}%` }}
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-ink-700">
                    Прогрев стартует автоматически в ближайшие минуты (его запускает
                    фоновый обработчик). Можно смело идти дальше.
                  </p>
                )}
              </div>
              <p className="mt-3 text-sm text-ink-700">
                Пока ящики греются — подготовим базу и первую кампанию: она{" "}
                <b>запустится сама</b>, как только прогрев завершится.
              </p>
              <Link
                href="/app/setup?s=5"
                className="mt-4 inline-block rounded-lg brand-gradient px-6 py-3 text-sm font-semibold text-white"
              >
                Дальше →
              </Link>
            </>
          )}

          {step === 5 && (
            <>
              <h1 className="text-xl font-bold text-slate-900">Загрузите базу контактов</h1>
              <p className="mt-1 text-sm text-ink-500">
                CSV: колонка <code>email</code> обязательна; <code>name</code>,{" "}
                <code>company</code>, <code>segment</code> — по желанию (сегменты позволят
                слать разным нишам разные письма).
              </p>
              <ContactsStepForm />
              {contactsDone && (
                <div className="mt-4">
                  <div className="rounded-lg border border-mint-400 bg-mint-100/40 px-4 py-3 text-sm">
                    ✓ Загружено контактов: <b>{contactsCount}</b>
                  </div>
                  <Link
                    href="/app/setup?s=6"
                    className="mt-3 inline-block rounded-lg brand-gradient px-6 py-3 text-sm font-semibold text-white"
                  >
                    Дальше →
                  </Link>
                </div>
              )}
            </>
          )}

          {step === 6 && (
            <>
              <h1 className="text-xl font-bold text-slate-900">Создайте первую кампанию</h1>
              <p className="mt-1 text-sm text-ink-500">
                ИИ напишет варианты письма по данным о вашем бизнесе — вы выберете и
                поправите. 3 коротких шага.
              </p>
              <Link
                href="/app/campaigns/new"
                className="mt-5 inline-block rounded-lg brand-gradient px-8 py-3 text-sm font-semibold text-white"
              >
                Создать кампанию →
              </Link>
              <p className="mt-3 text-xs text-ink-500">
                После создания вернитесь сюда — настройка завершится автоматически.
              </p>
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}

// форма загрузки контактов внутри шага (uploadContacts остаётся на этой же
// странице при успехе — шаг перерисуется и покажет «Дальше»)
async function ContactsStepForm() {
  const { uploadContacts } = await import("../contacts/actions");
  return (
    <form action={uploadContacts} className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white p-5">
      <input type="file" name="file" accept=".csv,text/csv" required className="text-sm" />
      <button className="rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white">
        Загрузить
      </button>
    </form>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-3xl py-6">{children}</div>;
}
