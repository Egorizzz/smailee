import Image from "next/image";
import Link from "next/link";
import { requireOrganizationAdmin } from "@/lib/organization";

export default async function IntegrationsPage() {
  const { owner } = await requireOrganizationAdmin();
  const connected = Boolean(owner.bitrixWebhookEnc);

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
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${connected ? "bg-mint-100 text-mint-700" : "bg-slate-100 text-slate-500"}`}>
              {connected ? "Подключено" : "Не подключено"}
            </span>
          </div>

          <div className="mt-auto pt-6">
            <h2 className="text-lg font-bold text-slate-900">Битрикс24</h2>
            <p className="mt-1 text-sm leading-5 text-ink-500">
              Передавайте созревших лидов вместе с контекстом переписки в CRM.
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#0876a5]">
              {connected ? "Настроить" : "Подключить"}
              <span aria-hidden className="transition-transform group-hover:translate-x-1">→</span>
            </span>
          </div>
        </Link>
      </div>
    </div>
  );
}
