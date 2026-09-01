import Link from "next/link";
import { requireOrganizationAdmin } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { supportedProviders } from "@/lib/mail/profiles";
import { MailboxForm } from "../mailboxes/MailboxForm";
import { getPublishedBusinessProfile, isBusinessProfileReady } from "@/lib/businessProfile/context";
import { saveControlContact } from "./actions";

const BASE_STEPS = ["О бизнесе", "5 контактов", "Почта", "Проверка", "Кампания", "Ответ"];

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ s?: string; error?: string }> }) {
  const { owner: user } = await requireOrganizationAdmin();
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

  const done = [
    businessProfile.published && isBusinessProfileReady(businessProfile.profile),
    contacts > 0,
    Boolean(mailbox),
    Boolean(control),
    Boolean(campaign),
    Boolean(controlReply),
  ];
  const steps = BASE_STEPS;
  const firstIncomplete = done.findIndex((value) => !value);
  const requested = Number(s);
  const completedStep = steps.length + 1;
  const step = firstIncomplete < 0 ? completedStep : requested >= 1 && requested <= firstIncomplete + 1 ? requested : firstIncomplete + 1;
  const profiles = supportedProviders();

  return (
    <div className="mx-auto max-w-3xl py-6">
      <div className="mb-7">
        <div className="flex items-center justify-between text-sm text-ink-500">
          <span>Первый запуск</span>
          <span className="metric-number">{Math.min(step, steps.length)} из {steps.length}</span>
        </div>
        <div className="mt-3 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
          {steps.map((label, index) => (
            <div key={label}>
              <div className={`h-1.5 rounded-full ${index + 1 <= Math.min(step, steps.length) ? "brand-gradient" : "bg-surface"}`} />
              <div className="mt-1 hidden text-[11px] text-ink-500 sm:block">{label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8">
        {error && <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {step === 1 && <Step title="Расскажите о бизнесе" text="Smailee использует профиль компании, чтобы подобрать подходящих клиентов и написать им по делу.">
          <Link href="/app/settings/profile?setup=1#website-analysis" className="inline-flex rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white">Создать профиль компании →</Link>
        </Step>}

        {step === 2 && <Step title="Найдите первые 5 контактов" text="Опишите целевую аудиторию — AI найдёт компании и нужных людей. Пробный тариф включает до 5 реальных контактов.">
          <Link href="/app/contacts/discover?onboarding=1" className="inline-flex rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white">Подобрать контакты →</Link>
          {contacts > 0 && <Continue step={3} note={`Найдено контактов: ${contacts}`} />}
        </Step>}

        {step === 3 && <Step title="Подключите используемую почту" text="Для первой проверки возьмите ящик, с которого вы уже ведёте переписку. Отметьте его как прогретый — кампания сможет отправиться сразу.">
          <MailboxForm providers={profiles.map((p) => ({ value: p.provider, label: p.label }))} passwordHint={profiles[0]?.passwordHint ?? ""} />
          {mailbox && <Continue step={4} note={`Подключён: ${mailbox.email}`} />}
        </Step>}

        {step === 4 && <Step title="Добавьте контрольный контакт" text="Укажите свою вторую почту или адрес коллеги. Мы добавим его в ту же подборку: вы увидите реальную доставку, ответ и продолжение диалога.">
          <form action={saveControlContact} className="mt-5 space-y-3">
            <input name="name" className="input" placeholder="Имя получателя" defaultValue={control?.name ?? ""} />
            <input name="email" type="email" className="input" placeholder="Контрольный email" defaultValue={control?.email ?? ""} required />
            <button className="rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white">Сохранить контрольный контакт</button>
          </form>
          {control && <Continue step={5} note={`Контрольный адрес: ${control.email}`} />}
        </Step>}

        {step === 5 && <Step title="Создайте и запустите кампанию" text="AI подготовит письмо по профилю бизнеса и данным контактов. Проверьте текст и запустите отправку на выбранный сегмент.">
          <Link href="/app/campaigns/new" className="inline-flex rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white">Создать кампанию →</Link>
          {campaign && <Continue step={6} note={`Кампания создана: ${campaign.name}`} />}
        </Step>}

        {step === 6 && <Step title="Ответьте на контрольное письмо" text="Откройте письмо на контрольном адресе и ответьте на него. Smailee распознает ответ и покажет диалог — так вы проверите весь путь до лида.">
          {campaign && <Link href={`/app/campaigns/${campaign.id}`} className="inline-flex rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white">Открыть кампанию →</Link>}
          <Link href="/app/setup?s=6" className="ml-3 text-sm font-semibold text-mint-700">Проверить ответ</Link>
        </Step>}

        {step === completedStep && <Step title="Первый путь пройден" text="Контакты найдены, письмо отправлено, ответ появился в Smailee. Пробный тариф остаётся доступен без ограничения по времени.">
          <Link href="/app/inbox" className="inline-flex rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white">Открыть диалоги →</Link>
          <Link href="/app/billing" className="ml-3 text-sm font-semibold text-mint-700">Посмотреть тарифы</Link>
        </Step>}
      </div>
    </div>
  );
}

function Step({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return <><h1 className="text-2xl font-bold text-slate-900">{title}</h1><p className="mt-2 text-sm leading-6 text-ink-500">{text}</p><div className="mt-6">{children}</div></>;
}

function Continue({ step, note }: { step: number; note: string }) {
  return <div className="mt-5 rounded-xl border border-mint-200 bg-mint-50 p-4"><p className="text-sm text-mint-800">✓ {note}</p><Link href={`/app/setup?s=${step}`} className="mt-3 inline-flex text-sm font-semibold text-mint-800">Продолжить →</Link></div>;
}
