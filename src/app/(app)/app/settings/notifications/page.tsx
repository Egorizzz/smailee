import { redirect } from "next/navigation";
import { can, requireWorkspace, workspaceHome } from "@/lib/organization";
import { NotificationSettingsForm } from "@/components/NotificationSettingsForm";
import { SettingsTabs } from "@/components/SettingsTabs";
import { TelegramIntegrationControl } from "@/components/TelegramIntegrationControl";

function TelegramMark() {
  return (
    <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#229ED9] text-white">
      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current"><path d="M21.7 3.4 18.5 20c-.2 1.2-.9 1.5-1.9.9l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9.1-8.2c.4-.4-.1-.6-.6-.2L6 13.8 1.2 12.3c-1-.3-1-1 .2-1.5L20.1 3.6c.9-.3 1.7.2 1.6-.2Z" /></svg>
    </span>
  );
}

export default async function NotificationSettingsPage() {
  const workspace = await requireWorkspace();
  if (!can(workspace, "LEADS_REPLY_OWN") && !can(workspace, "LEADS_REPLY_ALL")) {
    redirect(workspaceHome(workspace));
  }
  const user = workspace.actor;
  const connected = Boolean(user.telegramChatId);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold text-slate-900">Настройки</h1>
      <p className="mt-1 text-ink-500">Личные параметры уведомлений о клиентских ответах.</p>
      <SettingsTabs active="notifications" organizationAdmin={workspace.role === "ORG_ADMIN"} />

      <div className="mt-7">
        <NotificationSettingsForm
          canReceiveAll={can(workspace, "LEADS_REPLY_ALL")}
          telegramConnected={connected}
          initial={{
            scope: user.customerNotificationScope,
            replyPolicy: user.replyNotificationPolicy,
            telegramReplyMode: user.telegramReplyMode,
            telegramWarmLeadMode: user.telegramWarmLeadMode,
            telegramGroupMinutes: user.telegramGroupMinutes,
            emailDigestReplies: user.emailDigestReplies,
            emailDigestWarmLeads: user.emailDigestWarmLeads,
            emailDigestFrequency: user.emailDigestFrequency,
            emailDigestHourMsk: user.emailDigestHourMsk,
          }}
        />
      </div>

      <section className="mt-6 rounded-xl border border-line bg-white p-5">
        <div className="flex items-start gap-4">
          <TelegramMark />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-900">Личный Telegram</h2>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${connected ? "bg-mint-100 text-mint-700" : "bg-slate-100 text-slate-500"}`}>
                {connected ? "Подключён" : "Не подключён"}
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-500">Привязка и настройки принадлежат только вам, а не всей организации.</p>
            {connected && user.telegramUsername && <p className="mt-2 text-sm text-slate-700">Аккаунт <span className="font-semibold">@{user.telegramUsername}</span></p>}
          </div>
        </div>
        <TelegramIntegrationControl connected={connected} />
      </section>
    </div>
  );
}
