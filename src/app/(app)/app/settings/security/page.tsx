import { requireUser } from "@/lib/auth";
import { SettingsTabs } from "@/components/SettingsTabs";
import { SecurityForm } from "./SecurityForm";

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ changed?: string }> }) {
  const user = await requireUser();
  const { changed } = await searchParams;
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-900">Настройки</h1>
      <p className="mt-1 text-ink-500">Управление входом в личный кабинет.</p>
      <SettingsTabs active="security" organizationAdmin={user.organizationRole === "ORG_ADMIN"} />
      {changed && <p className="mt-6 rounded-lg border border-mint-200 bg-mint-50 px-4 py-3 text-sm text-mint-800">Данные для входа обновлены.</p>}
      <SecurityForm email={user.email} verified={Boolean(user.emailVerifiedAt)} passwordEnabled={user.passwordEnabled} />
    </div>
  );
}
