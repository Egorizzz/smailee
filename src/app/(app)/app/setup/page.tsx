import Link from "next/link";
import { requireOrganizationAdmin } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { supportedProviders } from "@/lib/mail/profiles";
import { MailboxForm } from "../mailboxes/MailboxForm";
import { getPublishedBusinessProfile, isBusinessProfileReady } from "@/lib/businessProfile/context";
import { PLANS } from "@/lib/plans";
import { chooseWorkingPlan, continueExploringSmailee, saveControlContact, skipSetupStep } from "./actions";
import { BusinessProfileManager } from "@/components/BusinessProfileManager";
import { loadBusinessProfileManagerData } from "@/lib/businessProfile/managerData";
import { OnboardingProspecting } from "@/components/OnboardingProspecting";
import { OnboardingCampaign } from "@/components/OnboardingCampaign";
import { launchCampaign } from "../campaigns/actions";

const BASE_STEPS = ["О бизнесе", "5 контактов", "Почта", "Проверка", "Кампания", "Ответ"];

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ s?: string; error?: string }> }) {
  const workspace = await requireOrganizationAdmin();
  const user = workspace.owner;
  const { s, error } = await searchParams;
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
  const step = firstIncomplete < 0 ? completedStep : requested >= 1 && requested <= firstIncomplete + 1 ? requested : firstIncomplete + 1;
  const profiles = supportedProviders();
  const profileManager = step === 1
    ? await loadBusinessProfileManagerData(workspace.organizationId, user)
    : null;

  return (
    <div className="mx-auto max-w-7xl py-6">
      <div className="mb-7">
        <div className="flex items-center justify-between text-sm text-ink-500">
          <span>Первый запуск</span>
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

        {step === 1 && <Step step={1} title="Расскажите о бизнесе" text="Smailee использует профиль компании, чтобы подобрать подходящих клиентов и написать им по делу.">
          {profileManager && <BusinessProfileManager {...profileManager} setupMode />}
        </Step>}

        {step === 2 && <Step step={2} title="Найдите первые 5 контактов" text="Опишите целевую аудиторию — AI найдёт компании и нужных людей. Пробный тариф включает до 5 реальных контактов.">
          <OnboardingProspecting workspace={workspace} />
          {contacts > 0 && <Continue step={3} note={`Найдено контактов: ${contacts}`} />}
        </Step>}

        {step === 3 && <Step step={3} title="Подключите используемую почту" text="Для первой проверки возьмите ящик, с которого вы уже ведёте переписку. Отметьте его как прогретый — кампания сможет отправиться сразу.">
          <MailboxForm
            providers={profiles.map((profile) => ({ value: profile.provider, label: profile.label, passwordHint: profile.passwordHint }))}
            onboarding
          />
          {mailbox && <Continue step={4} note={`Подключён: ${mailbox.email}`} />}
        </Step>}

        {step === 4 && <Step step={4} title="Добавьте контрольный контакт" text="Укажите свою вторую почту или адрес коллеги. Мы добавим его в ту же подборку: вы увидите реальную доставку, ответ и продолжение диалога.">
          <form action={saveControlContact} className="mt-5 space-y-3">
            <input name="name" className="input" placeholder="Имя получателя" defaultValue={control?.name ?? ""} />
            <input name="email" type="email" className="input" placeholder="Контрольный email" defaultValue={control?.email ?? ""} required />
            <button className="rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white">Сохранить контрольный контакт</button>
          </form>
          {control && <Continue step={5} note={`Контрольный адрес: ${control.email}`} />}
        </Step>}

        {step === 5 && <Step step={5} title="Создайте и запустите кампанию" text="AI подготовит письмо по профилю бизнеса и данным контактов. Проверьте текст и создайте кампанию на выбранный сегмент.">
          <OnboardingCampaign userId={user.id} />
          {campaign && <Continue step={6} note={`Кампания создана: ${campaign.name}`} />}
        </Step>}

        {step === 6 && <Step step={6} title="Ответьте на контрольное письмо" text="Откройте письмо на контрольном адресе и ответьте на него. Smailee распознает ответ и завершит проверку пути до лида.">
          <div className="flex flex-wrap gap-3">
            {campaign && campaign.status === "DRAFT" && <form action={launchCampaign}><input type="hidden" name="id" value={campaign.id} /><button className="rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white">Запустить кампанию</button></form>}
            <Link href="/app/setup?s=6" className="inline-flex rounded-lg border border-line bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 hover:border-mint-300">Проверить ответ</Link>
          </div>
        </Step>}

        {step === completedStep && <OnboardingPaywall />}
      </div>
    </div>
  );
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

function Step({ step, title, text, children }: { step: number; title: string; text: string; children: React.ReactNode }) {
  return <><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><h1 className="text-2xl font-bold text-slate-900">{title}</h1><form action={skipSetupStep} className="shrink-0"><input type="hidden" name="step" value={step} /><button className="rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-ink-500 transition hover:border-mint-300 hover:text-slate-900">Пропустить этап →</button></form></div><p className="mt-2 text-sm leading-6 text-ink-500">{text}</p><div className="mt-6">{children}</div></>;
}

function Continue({ step, note }: { step: number; note: string }) {
  return <div className="mt-5 rounded-xl border border-mint-200 bg-mint-50 p-4"><p className="text-sm text-mint-800">✓ {note}</p><Link href={`/app/setup?s=${step}`} className="mt-3 inline-flex text-sm font-semibold text-mint-800">Продолжить →</Link></div>;
}
