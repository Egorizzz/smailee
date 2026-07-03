import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function AppOverview() {
  const user = await requireUser();

  const [contacts, campaigns, messages, leads] = await Promise.all([
    prisma.contact.count({ where: { userId: user.id } }),
    prisma.campaign.count({ where: { userId: user.id } }),
    prisma.message.count({ where: { campaign: { userId: user.id } } }),
    prisma.lead.count({ where: { userId: user.id, qualification: "HOT" } }),
  ]);

  const opened = await prisma.message.count({
    where: { campaign: { userId: user.id }, openedAt: { not: null } },
  });
  const replied = await prisma.message.count({
    where: { campaign: { userId: user.id }, repliedAt: { not: null } },
  });

  const openRate = messages ? Math.round((opened / messages) * 100) : 0;
  const replyRate = messages ? Math.round((replied / messages) * 100) : 0;

  const onboardingDone = Boolean(user.offer && user.targetAudience);

  const stats = [
    { label: "Контактов в базе", value: contacts },
    { label: "Кампаний", value: campaigns },
    { label: "Отправлено писем", value: messages },
    { label: "Тёплых лидов", value: leads },
    { label: "Open rate", value: `${openRate}%` },
    { label: "Reply rate", value: `${replyRate}%` },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold text-slate-900">
        Здравствуйте{user.name ? `, ${user.name}` : ""}!
      </h1>
      <p className="mt-1 text-ink-500">Обзор вашего аккаунта Smailee</p>

      {!onboardingDone && (
        <div className="mt-6 flex items-center justify-between gap-4 rounded-xl border border-indigo-200 bg-indigo-50 p-5">
          <div>
            <div className="font-semibold text-indigo-700">
              Начните с настройки бизнеса
            </div>
            <p className="text-sm text-indigo-700/80">
              Расскажите AI про ваш оффер и целевую аудиторию — тогда письма
              будут персональными.
            </p>
          </div>
          <Link
            href="/app/onboarding"
            className="shrink-0 rounded-lg brand-gradient px-4 py-2 text-sm font-semibold text-white"
          >
            Настроить →
          </Link>
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-line bg-white p-5"
          >
            <div className="text-2xl font-bold text-slate-900">{s.value}</div>
            <div className="mt-1 text-sm text-ink-500">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Link
          href="/app/contacts"
          className="rounded-xl border border-line bg-white p-5 transition hover:border-mint-400"
        >
          <div className="font-semibold text-slate-900">1. Загрузить базу</div>
          <p className="mt-1 text-sm text-ink-500">CSV с контактами</p>
        </Link>
        <Link
          href="/app/campaigns/new"
          className="rounded-xl border border-line bg-white p-5 transition hover:border-mint-400"
        >
          <div className="font-semibold text-slate-900">2. Создать кампанию</div>
          <p className="mt-1 text-sm text-ink-500">AI напишет письма</p>
        </Link>
        <Link
          href="/app/leads"
          className="rounded-xl border border-line bg-white p-5 transition hover:border-mint-400"
        >
          <div className="font-semibold text-slate-900">3. Смотреть лидов</div>
          <p className="mt-1 text-sm text-ink-500">Тёплые — в приоритете</p>
        </Link>
      </div>
    </div>
  );
}
