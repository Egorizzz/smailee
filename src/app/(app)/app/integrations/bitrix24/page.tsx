import Image from "next/image";
import Link from "next/link";
import { CrmIntegrationForm } from "@/components/CrmIntegrationForm";
import { requireOrganizationAdmin } from "@/lib/organization";

export default async function Bitrix24IntegrationPage() {
  const { owner } = await requireOrganizationAdmin();
  const connected = Boolean(owner.bitrixWebhookEnc);

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/app/integrations" className="text-sm font-medium text-ink-500 hover:text-slate-900">
        ← Все интеграции
      </Link>

      <div className="mt-5 flex items-center gap-4 border-b border-line pb-6">
        <div className="flex h-20 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-100 bg-white p-2 shadow-sm">
          <Image src="/integrations/bitrix24.jpg" alt="" width={500} height={500} className="h-full w-full object-contain" priority />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900">Битрикс24</h1>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${connected ? "bg-mint-100 text-mint-700" : "bg-slate-100 text-slate-500"}`}>
              {connected ? "Подключено" : "Не подключено"}
            </span>
          </div>
          <p className="mt-1 text-sm leading-5 text-ink-500">
            Настройте передачу готовых лидов и момент, когда ИИ отдаёт диалог продавцу.
          </p>
        </div>
      </div>

      <CrmIntegrationForm
        connected={connected}
        selectedTriggers={owner.crmHandoffTriggers}
        customHandoffPrompt={owner.customHandoffPrompt ?? ""}
      />
    </div>
  );
}
