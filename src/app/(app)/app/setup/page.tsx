import Link from "next/link";
import { requireOrganizationAdmin } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { supportedProviders } from "@/lib/mail/profiles";
import { MailboxForm } from "../mailboxes/MailboxForm";
import { getPublishedBusinessProfile, isBusinessProfileReady } from "@/lib/businessProfile/context";
import { PLANS } from "@/lib/plans";
import { chooseWorkingPlan, completeContactsReview, continueExploringSmailee, saveControlContact, skipSetupStep } from "./actions";
import { BusinessProfileManager } from "@/components/BusinessProfileManager";
import { loadBusinessProfileManagerData } from "@/lib/businessProfile/managerData";
import { OnboardingProspecting } from "@/components/OnboardingProspecting";
import { OnboardingCampaign } from "@/components/OnboardingCampaign";
import { OnboardingContactsReview } from "@/components/OnboardingContactsReview";
import { InboxView, type InboxSearchParams } from "../inbox/page";
import type { BusinessProfileData } from "@/lib/businessProfile/types";

const BASE_STEPS = ["О бизнесе", "5 контактов", "База", "Почта", "Личный адрес", "Кампания", "Ответ"];

type SetupSearchParams = InboxSearchParams & { s?: string; error?: string; segment?: string };

export default async function SetupPage({ searchParams }: { searchParams: Promise<SetupSearchParams> }) {
  const workspace = await requireOrganizationAdmin();
  const user = workspace.owner;
  const query = await searchParams;
  const { s, error, segment } = query;
  const [businessProfile, contacts, mailbox, control, campaign, controlReply] = await Promise.all([
    getPublishedBusinessProfile(user),
    prisma.contact.count({ where: { userId: user.id, isDemo: false, isControl: false } }),
    prisma.mailbox.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    prisma.contact.findFirst({ where: { userId: user.id, isControl: true } }),
    prisma.campaign.findFirst({ where: { userId: user.id, isDemo: false }, orderBy: { createdAt: "desc" } }),
    prisma.message.findFirst({
      where: { campaign: { userId: user.id, isDemo: false }, contact: { isControl: true }, repliedAt: { not: null } },
      select: { id: true },
    }),
  ]);

  const completed = [
    businessProfile.published && isBusinessProfileReady(businessProfile.profile),
    contacts > 0,
    Boolean(user.setupReviewedContactsAt),
    Boolean(mailbox),
    Boolean(control),
    Boolean(campaign),
    Boolean(controlReply),
  ];
  const skipped = new Set(user.setupSkippedSteps);
  const done = completed.map((value, index) => value || skipped.has(index + 1));
  const steps = BASE_STEPS;
  const firstIncomplete = done.findIndex((value) => !value);
  const requested = Number(s);
  const completedStep = steps.length + 1;
  const maxReachableStep = firstIncomplete < 0 ? completedStep : firstIncomplete + 1;
  const step = requested >= 1 && requested <= maxReachableStep
    ? requested
    : firstIncomplete < 0
      ? completedStep
      : firstIncomplete + 1;
  const previousStep = step > 1 ? step - 1 : null;
  const nextStep = step < maxReachableStep ? step + 1 : null;
  const completedDetails = [
    businessProfile.profile.companyName
      ? `Профиль компании «${businessProfile.profile.companyName}» готов.`
      : "Профиль компании готов.",
    `${contacts} ${pluralizeContacts(contacts)} готовы к работе.`,
    "Найденная база проверена.",
    mailbox ? `Подключён ящик ${mailbox.email}.` : "Почтовый ящик подключён.",
    control ? `Контрольный адрес ${control.email} сохранён.` : "Контрольный адрес сохранён.",
    campaign ? `Кампания «${campaign.name}» создана.` : "Кампания создана.",
    "Ответ на контрольное письмо получен.",
  ];
  const profiles = supportedProviders();
  const profileManager = step === 1 && !completed[0]
    ? await loadBusinessProfileManagerData(workspace.organizationId, user)
    : null;

  return (
    <div className="mx-auto max-w-7xl py-6">
      <div className="mb-7">
        <div className="flex items-center justify-between text-sm text-ink-500">
          <div className="flex items-center gap-2" aria-label="Навигация по этапам">
            <StepArrow direction="previous" step={previousStep} />
            <StepArrow direction="next" step={nextStep} />
          </div>
          <span className="metric-number">{Math.min(step, steps.length)} из {steps.length}</span>
        </div>
        <div className="mt-3 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
          {steps.map((label, index) => (
            <div key={label}>
              <div className={`h-1.5 rounded-full ${completed[index] ? "brand-gradient" : skipped.has(index + 1) ? "bg-amber-300" : index + 1 === step ? "bg-mint-300" : "bg-surface"}`} />
              <div className="mt-1 hidden text-[11px] text-ink-500 sm:block">{label}{skipped.has(index + 1) && !completed[index] ? " · пропущено" : ""}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8">
        {error && <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {step >= 4 && step <= 6 && completed[step - 1] ? (
          <CompletedStep title={steps[step - 1]} detail={completedDetails[step - 1]} />
        ) : null}

        {step === 1 && (completed[0] ? (
          <BusinessProfileReview profile={businessProfile.profile} />
        ) : (
          <Step step={1} title="Расскажите о бизнесе" text="Smailee использует профиль компании, чтобы подобрать подходящих клиентов и написать им по делу.">
            {profileManager && <BusinessProfileManager {...profileManager} setupMode />}
          </Step>
        ))}

        {step === 2 && (completed[1] ? (
          <CompletedStep title="Контакты найдены" detail={`${contacts} ${pluralizeContacts(contacts)} готовы к проверке.`} next={{ href: "/app/setup?s=3", label: "Посмотреть базу" }} />
        ) : (
          <Step step={2} title="Найдите первые 5 контактов" text="Опишите целевую аудиторию — AI найдёт компании и нужных людей. Пробный тариф включает до 5 реальных контактов.">
            <OnboardingProspecting workspace={workspace} />
          </Step>
        ))}

        {step === 3 && <Step step={3} showSkip={!completed[2]} title="Проверьте найденную базу" text="Откройте карточки контактов и проверьте компании, роли и данные для персонализации перед созданием кампании.">
          <OnboardingContactsReview workspace={workspace} initialSegment={segment} />
          <form action={completeContactsReview} className="mt-5 flex justify-end">
            <button className="rounded-lg brand-gradient px-6 py-3 text-sm font-semibold text-white">Дальше: подключить почту →</button>
          </form>
        </Step>}

        {step === 4 && !completed[3] && <Step step={4} title="Подключите используемую почту" text="Для первой проверки возьмите ящик, с которого вы уже ведёте переписку. Мы пометим его как тестовый и сразу допустим к первой кампании — прогрев для него не запускается.">
          <MailboxForm
            providers={profiles.map((profile) => ({ value: profile.provider, label: profile.label, passwordHint: profile.passwordHint }))}
            onboarding
          />
          {mailbox && <Continue step={5} note={`Подключён: ${mailbox.email}`} />}
        </Step>}

        {step === 5 && !completed[4] && <Step step={5} title="Добавьте контрольный контакт" text="Укажите свою вторую почту или адрес коллеги. Он появится как отдельная аудитория «Личный адрес»: кампанию можно отправить контрагентам, только себе или всем вместе.">
          <form action={saveControlContact} className="mt-5 space-y-3">
            <input name="name" className="input" placeholder="Имя получателя" defaultValue={control?.name ?? ""} />
            <input name="email" type="email" className="input" placeholder="Контрольный email" defaultValue={control?.email ?? ""} required />
            <button className="rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white">Сохранить контрольный контакт</button>
          </form>
          {control && <Continue step={6} note={`Личный адрес: ${control.email}`} />}
        </Step>}

        {step === 6 && !completed[5] && <Step step={6} title="Создайте и запустите кампанию" text="AI подготовит письмо по профилю бизнеса и данным контактов. Проверьте текст и создайте кампанию на выбранный сегмент.">
          <OnboardingCampaign userId={user.id} />
          {campaign && <Continue step={7} note={`Кампания создана: ${campaign.name}`} />}
        </Step>}

        {step === 7 && <Step step={7} showSkip={!completed[6]} title="Проверьте отправку и ответ" text="Здесь работает полноценный Inbox: все письма кампании, ответы, будущие follow-up и действия по диалогу.">
          <div className="mb-4 flex flex-wrap gap-3">
            <Link href="/app/setup?s=7" className="inline-flex rounded-lg border border-line bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 hover:border-mint-300">Обновить Inbox</Link>
          </div>
          <InboxView workspace={workspace} query={query} embedded />
        </Step>}

        {step === completedStep && <OnboardingPaywall />}
      </div>
    </div>
  );
}

function StepArrow({ direction, step }: { direction: "previous" | "next"; step: number | null }) {
  const isPrevious = direction === "previous";
  const label = isPrevious ? "Предыдущий этап" : "Следующий этап";
  const arrow = isPrevious ? "←" : "→";
  const className = "flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-white text-lg font-semibold text-slate-900 transition";

  if (!step) {
    return <span aria-hidden="true" className={`${className} cursor-not-allowed opacity-35`}>{arrow}</span>;
  }

  return <Link href={`/app/setup?s=${step}`} aria-label={label} className={`${className} hover:border-mint-300 hover:bg-mint-50`}>{arrow}</Link>;
}

function CompletedStep({ title, detail, next }: { title: string; detail: string; next?: { href: string; label: string } }) {
  return (
    <div className="py-5 sm:py-8">
      <div className="inline-flex items-center gap-2 rounded-full border border-mint-200 bg-mint-50 px-3 py-1.5 text-sm font-semibold text-mint-800">
        <span aria-hidden="true">✓</span>
        Готово
      </div>
      <h1 className="mt-5 text-balance font-display text-3xl font-semibold tracking-[-0.03em] text-slate-900">{title}</h1>
      <p className="mt-3 max-w-xl text-pretty text-sm leading-6 text-ink-500">{detail}</p>
      {next && <Link href={next.href} className="mt-6 inline-flex rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white">{next.label} →</Link>}
    </div>
  );
}

function BusinessProfileReview({ profile }: { profile: BusinessProfileData }) {
  const sections = [
    { label: "Оффер", values: profile.offers },
    { label: "Целевая аудитория", values: profile.targetAudiences },
    { label: "Продукты", values: profile.products.map((item) => `${item.name}${item.description ? ` — ${item.description}` : ""}`) },
    { label: "Отличия", values: profile.differentiators },
    { label: "Кейсы и доказательства", values: profile.proof },
    { label: "Ограничения", values: profile.restrictions },
  ].filter((section) => section.values.length > 0);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-2 rounded-full border border-mint-200 bg-mint-50 px-3 py-1.5 text-sm font-semibold text-mint-800"><span aria-hidden="true">✓</span>Профиль опубликован</span>
      </div>
      <h1 className="mt-5 text-balance font-display text-3xl font-semibold tracking-[-0.03em] text-slate-900">{profile.companyName || "Профиль компании"}</h1>
      {profile.summary && <p className="mt-3 max-w-3xl text-pretty text-sm leading-6 text-ink-600">{profile.summary}</p>}
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {sections.map((section) => <section key={section.label} className="rounded-xl border border-line bg-[#fafbf9] p-4"><h2 className="text-xs font-medium text-ink-500">{section.label}</h2><div className="mt-2 space-y-1.5">{section.values.map((value, index) => <p key={`${section.label}-${index}`} className="text-sm leading-5 text-slate-800">{value}</p>)}</div></section>)}
      </div>
      <div className="mt-6 flex justify-end"><Link href="/app/setup?s=2" className="rounded-lg brand-gradient px-6 py-3 text-sm font-semibold text-white">Дальше: найти контакты →</Link></div>
    </div>
  );
}

function pluralizeContacts(value: number) {
  const lastTwo = value % 100;
  const last = value % 10;

  if (lastTwo >= 11 && lastTwo <= 14) return "контактов";
  if (last === 1) return "контакт";
  if (last >= 2 && last <= 4) return "контакта";
  return "контактов";
}

function OnboardingPaywall() {
  const plan = PLANS.BASIC;

  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-semibold text-mint-700">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-mint-100" aria-hidden="true">✓</span>
        Полный путь проверен
      </div>
      <h1 className="mt-5 text-balance font-display text-3xl font-semibold tracking-[-0.03em] text-slate-900 sm:text-4xl">
        Первая кампания прошла весь путь
      </h1>
      <p className="mt-3 max-w-xl text-pretty text-sm leading-6 text-ink-600">
        Smailee подобрал контакты, отправил письмо и собрал ответ в Inbox. Для следующей рабочей кампании рекомендуем начать с базового тарифа.
      </p>

      <div className="mt-7 overflow-hidden rounded-2xl border border-mint-300 bg-[linear-gradient(135deg,#f0fff6_0%,#ffffff_58%)]">
        <div className="grid gap-6 p-5 sm:grid-cols-[1fr_auto] sm:items-end sm:p-6">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">{plan.name}</span>
              <span className="rounded-full border border-mint-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-mint-700">Для первого рабочего запуска</span>
            </div>
            <div className="mt-3 flex items-end gap-1.5">
              <span className="metric-number text-3xl font-bold tracking-tight text-slate-900">{plan.priceRub.toLocaleString("ru-RU")}</span>
              <span className="mb-1 text-sm text-ink-500">₽/мес</span>
            </div>
            <div className="mt-5 grid gap-2 text-sm text-ink-700 sm:grid-cols-3">
              <span><span className="metric-number font-semibold text-slate-900">{plan.maxContacts.toLocaleString("ru-RU")}</span> контактов</span>
              <span><span className="metric-number font-semibold text-slate-900">{plan.maxEmailsPerMonth.toLocaleString("ru-RU")}</span> писем в месяц</span>
              <span><span className="metric-number font-semibold text-slate-900">{plan.mailboxQuota}</span> почтовых ящика</span>
            </div>
          </div>
          <div className="rounded-xl border border-mint-200 bg-white px-4 py-3 text-sm text-ink-600 sm:max-w-52">
            <span className="font-semibold text-slate-900">Первые 45 дней</span>
            <span className="mt-1 block text-xs leading-5">30 дней работы и ещё 15 дней на прогрев новых ящиков.</span>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <form action={chooseWorkingPlan}>
          <button className="w-full rounded-lg brand-gradient px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90">
            Перейти на рабочий тариф
          </button>
        </form>
        <form action={continueExploringSmailee}>
          <button className="w-full rounded-lg border border-line bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition hover:border-mint-400">
            Продолжить исследование Smailee
          </button>
        </form>
      </div>
      <p className="mt-3 text-center text-xs leading-5 text-ink-500">
        Оплата не начнётся автоматически: сначала вы увидите все тарифы и условия.
      </p>
    </div>
  );
}

function Step({ step, title, text, children, showSkip = true }: { step: number; title: string; text: string; children: React.ReactNode; showSkip?: boolean }) {
  return <><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><h1 className="text-2xl font-bold text-slate-900">{title}</h1>{showSkip && <form action={skipSetupStep} className="shrink-0"><input type="hidden" name="step" value={step} /><button className="rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-ink-500 transition hover:border-mint-300 hover:text-slate-900">Пропустить этап →</button></form>}</div><p className="mt-2 text-sm leading-6 text-ink-500">{text}</p><div className="mt-6">{children}</div></>;
}

function Continue({ step, note }: { step: number; note: string }) {
  return <div className="mt-5 rounded-xl border border-mint-200 bg-mint-50 p-4"><p className="text-sm text-mint-800">✓ {note}</p><Link href={`/app/setup?s=${step}`} className="mt-3 inline-flex text-sm font-semibold text-mint-800">Продолжить →</Link></div>;
}
