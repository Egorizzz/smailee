import Link from "next/link";
import { requireOrganizationAdmin } from "@/lib/organization";
import { planDisplayName } from "@/lib/plans";
import { saveAiSettings } from "../onboarding/actions";
import { FunnelPromptField } from "@/components/FunnelPromptField";
import { TeamManagement } from "@/components/TeamManagement";
import { prisma } from "@/lib/prisma";
import { parseBusinessProfile } from "@/lib/businessProfile/types";
import { AutoPingGlobalSettings } from "@/components/AutoPingGlobalSettings";
import { SettingsTabs } from "@/components/SettingsTabs";

/**
 * Настройки (TO BE, R1): всё редко используемое в одном месте —
 * Тариф, режим модерации и инструкции для переписки. Данные организации
 * редактируются только в отдельном профиле, чтобы не было двух источников.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const workspace = await requireOrganizationAdmin();
  const user = workspace.owner;
  const { tab } = await searchParams;
  const members = workspace.organizationId
    ? await prisma.user.findMany({
        where: { organizationId: workspace.organizationId },
        select: { id: true, email: true, name: true, organizationRole: true, organizationPermissions: true },
        orderBy: [{ organizationRole: "asc" }, { createdAt: "asc" }],
      })
    : [{ id: user.id, email: user.email, name: user.name, organizationRole: user.organizationRole, organizationPermissions: user.organizationPermissions }];
  const storedProfile = workspace.organizationId
    ? await prisma.organizationProfile.findUnique({
        where: { organizationId: workspace.organizationId },
        select: { publishedData: true, publishedAt: true, staleAt: true },
      })
    : null;
  const publishedProfile = storedProfile?.publishedData
    ? parseBusinessProfile(storedProfile.publishedData)
    : null;

  const tabs = <SettingsTabs active={tab === "team" ? "team" : "main"} organizationAdmin membersCount={members.length} />;

  if (tab === "team") {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold text-slate-900">Настройки</h1>
        <p className="mt-1 text-ink-500">Управление кабинетом и доступом сотрудников.</p>
        {tabs}
        <TeamManagement members={members.map((member) => ({ ...member, isOwner: member.id === user.id }))} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-900">Настройки</h1>
      <p className="mt-1 text-ink-500">
        Тариф, настройки ответов ИИ и доступ сотрудников.
      </p>
      {tabs}

      {/* тариф */}
      <div className="mt-6 flex flex-col items-stretch justify-between gap-4 rounded-xl border border-line bg-white p-5 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <div className="text-sm text-ink-500">Тариф</div>
          <div className="text-lg font-bold text-slate-900">{planDisplayName(user)}</div>
          {user.planExpiresAt && (
            <div className="text-xs text-ink-500">
              до {user.planExpiresAt.toLocaleDateString("ru-RU")}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
          {user.isDemo && <p className="text-xs text-ink-500">Бесплатный доступ к тарифу «Стандартный».</p>}
          <Link
            href="/app/billing"
            className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-center text-sm font-semibold text-indigo-700"
          >
            Управлять тарифом →
          </Link>
        </div>
      </div>

      <section className="mt-8 rounded-xl border border-line bg-white p-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-900">Профиль организации</h2>
              {(!publishedProfile || (storedProfile?.staleAt && storedProfile.staleAt <= new Date())) && (
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${publishedProfile ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
                  {publishedProfile ? "Нужно обновить" : "Не заполнен"}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-ink-500">
              Единый источник данных о компании, оффере и аудитории для писем и ответов.
            </p>
            {publishedProfile && (
              <p className="mt-3 text-sm text-slate-700">
                {publishedProfile.companyName || "Организация"}
                {publishedProfile.websiteUrl ? ` · ${publishedProfile.websiteUrl}` : ""}
                {storedProfile?.publishedAt ? ` · обновлён ${storedProfile.publishedAt.toLocaleDateString("ru-RU")}` : ""}
              </p>
            )}
          </div>
          <Link href="/app/settings/profile" className="shrink-0 rounded-lg border border-line bg-white px-4 py-2.5 text-center text-sm font-semibold text-slate-900 hover:bg-surface">
            {publishedProfile ? "Открыть профиль →" : "Заполнить профиль →"}
          </Link>
        </div>
      </section>

      <h2 className="mt-8 text-lg font-semibold text-slate-900">Ответы ИИ</h2>
      <p className="mt-1 text-sm text-ink-500">Настройте правила переписки и режим проверки ответов.</p>
      <form action={saveAiSettings} className="mt-4 space-y-5">
        <FunnelPromptField
          initialDialogStyle={user.dialogStylePrompt ?? ""}
          initialInstructions={user.funnelPrompt ?? ""}
        />

        <label className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4">
          <input
            type="checkbox"
            name="aiModerationEnabled"
            defaultChecked={user.aiModerationEnabled}
            className="mt-1"
          />
          <span>
            <span className="block text-sm font-medium text-slate-900">
              Модерация ответов ИИ
            </span>
            <span className="mt-0.5 block text-xs text-ink-500">
              Пока включено — ИИ готовит ответ клиенту, но не отправляет сам:
              вы одобряете каждый ответ в Inbox. Выключите, когда будете
              готовы доверить ИИ отправку без проверки.
            </span>
          </span>
        </label>

        <AutoPingGlobalSettings
          initialEnabled={user.autoPingEnabled}
          initialStartAfterDays={user.autoPingStartAfterDays}
          initialIntervalDays={user.autoPingIntervalDays}
          initialMaxAttempts={user.autoPingMaxAttempts}
        />

        <button className="rounded-lg brand-gradient px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90">
          Сохранить
        </button>
      </form>

    </div>
  );
}
