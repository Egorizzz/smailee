import Image from "next/image";
import Link from "next/link";
import { requireOrganizationAdmin } from "@/lib/organization";

export default async function IntegrationsPage() {
  const { owner } = await requireOrganizationAdmin();
  const bitrixConnected = Boolean(owner.bitrixWebhookEnc);
  const telegramConnected = Boolean(owner.telegramChatId);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold text-slate-900">Интеграции</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-500">
        Подключайте сервисы, в которые Smailee будет передавать готовых лидов.
      </p>

      <div className="mt-7 grid gap-4 sm:grid-cols-2">
        <Link
          href="/app/integrations/bitrix24"
          className="group flex min-h-52 flex-col rounded-2xl border border-line bg-white p-5 shadow-[0_8px_24px_rgba(16,35,29,0.05)] transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-[#39bff0]/60 hover:shadow-[0_14px_32px_rgba(16,35,29,0.09)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#19bced] focus-visible:ring-offset-2"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex h-20 w-24 items-center justify-center overflow-hidden rounded-xl border border-slate-100 bg-white p-2">
              <Image src="/integrations/bitrix24.jpg" alt="Битрикс24" width={500} height={500} className="h-full w-full object-contain" priority />
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${bitrixConnected ? "bg-mint-100 text-mint-700" : "bg-slate-100 text-slate-500"}`}>
              {bitrixConnected ? "Подключено" : "Не подключено"}
            </span>
          </div>

          <div className="mt-auto pt-6">
            <h2 className="text-lg font-bold text-slate-900">Битрикс24</h2>
            <p className="mt-1 text-sm leading-5 text-ink-500">
              Передавайте созревших лидов вместе с контекстом переписки в CRM.
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#0876a5]">
              {bitrixConnected ? "Настроить" : "Подключить"}
              <span aria-hidden className="transition-transform group-hover:translate-x-1">→</span>
            </span>
          </div>
        </Link>

        <Link
          href="/app/integrations/telegram"
          className="group flex min-h-52 flex-col rounded-2xl border border-line bg-white p-5 shadow-[0_8px_24px_rgba(16,35,29,0.05)] transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-[#229ED9]/60 hover:shadow-[0_14px_32px_rgba(16,35,29,0.09)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#229ED9] focus-visible:ring-offset-2"
        >
          <div className="flex items-start justify-between gap-4">
            <span aria-hidden className="flex h-20 w-20 items-center justify-center rounded-2xl bg-[#229ED9] text-white">
              <svg viewBox="0 0 24 24" className="h-10 w-10 fill-current"><path d="M21.7 3.4 18.5 20c-.2 1.2-.9 1.5-1.9.9l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9.1-8.2c.4-.4-.1-.6-.6-.2L6 13.8 1.2 12.3c-1-.3-1-1 .2-1.5L20.1 3.6c.9-.3 1.7.2 1.6-.2Z" /></svg>
            </span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${telegramConnected ? "bg-mint-100 text-mint-700" : "bg-slate-100 text-slate-500"}`}>{telegramConnected ? "Подключено" : "Не подключено"}</span>
          </div>
          <div className="mt-auto pt-6">
            <h2 className="text-lg font-bold text-slate-900">Telegram</h2>
            <p className="mt-1 text-sm leading-5 text-ink-500">Получайте уведомления о готовых лидах в личном чате с ботом.</p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#167fab]">{telegramConnected ? "Настроить" : "Подключить"}<span aria-hidden className="transition-transform group-hover:translate-x-1">→</span></span>
          </div>
        </Link>
      </div>
    </div>
  );
}
