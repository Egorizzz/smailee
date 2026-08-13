import Link from "next/link";
import { requireOrganizationAdmin } from "@/lib/organization";
import { TelegramIntegrationControl } from "@/components/TelegramIntegrationControl";

function TelegramMark() {
  return <span aria-hidden className="flex h-16 w-16 items-center justify-center rounded-full bg-[#229ED9] text-white"><svg viewBox="0 0 24 24" className="h-8 w-8 fill-current"><path d="M21.7 3.4 18.5 20c-.2 1.2-.9 1.5-1.9.9l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9.1-8.2c.4-.4-.1-.6-.6-.2L6 13.8 1.2 12.3c-1-.3-1-1 .2-1.5L20.1 3.6c.9-.3 1.7.2 1.6-.2Z" /></svg></span>;
}

export default async function TelegramIntegrationPage() {
  const { owner } = await requireOrganizationAdmin();
  const connected = Boolean(owner.telegramChatId);

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/app/integrations" className="text-sm font-medium text-ink-500 hover:text-slate-900">← Все интеграции</Link>
      <div className="mt-5 flex items-center gap-4 border-b border-line pb-6">
        <TelegramMark />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900">Telegram</h1>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${connected ? "bg-mint-100 text-mint-700" : "bg-slate-100 text-slate-500"}`}>{connected ? "Подключено" : "Не подключено"}</span>
          </div>
          <p className="mt-1 text-sm text-ink-500">Получайте уведомления о готовых лидах сразу в личном чате с ботом.</p>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-line bg-surface p-5">
        <h2 className="text-base font-semibold text-slate-900">Как это работает</h2>
        <ol className="mt-3 space-y-3 text-sm text-ink-500">
          <li><span className="mr-2 font-semibold text-slate-900">1.</span>Нажмите «Подключить Telegram» — откроется общий бот Smailee.</li>
          <li><span className="mr-2 font-semibold text-slate-900">2.</span>Нажмите Start. Одноразовая ссылка безопасно свяжет чат с вашим кабинетом.</li>
          <li><span className="mr-2 font-semibold text-slate-900">3.</span>Когда лид созреет, бот пришлёт контакт, краткое резюме и ссылку на кабинет.</li>
        </ol>
      </div>

      {connected && owner.telegramUsername && <p className="mt-4 text-sm text-ink-500">Подключён аккаунт <span className="font-semibold text-slate-900">@{owner.telegramUsername}</span></p>}
      <TelegramIntegrationControl connected={connected} />
    </div>
  );
}
