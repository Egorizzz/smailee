import { requireOrganizationAdmin } from "@/lib/organization";
import { BusinessProfileManager } from "@/components/BusinessProfileManager";
import { SettingsTabs } from "@/components/SettingsTabs";
import { loadBusinessProfileManagerData } from "@/lib/businessProfile/managerData";

export default async function BusinessProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string }>;
}) {
  const workspace = await requireOrganizationAdmin();
  const { setup } = await searchParams;
  const manager = await loadBusinessProfileManagerData(workspace.organizationId, workspace.owner);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-900">Настройки</h1>
      <p className="mt-1 text-ink-500">Контекст организации, которым пользуется ИИ.</p>
      <SettingsTabs active="profile" organizationAdmin />
      <BusinessProfileManager
        {...manager}
        setupMode={setup === "1"}
      />
    </div>
  );
}
