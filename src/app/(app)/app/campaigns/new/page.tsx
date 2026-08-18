import { requireCapability } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { getPublishedBusinessProfile, isBusinessProfileReady } from "@/lib/businessProfile/context";
import { NewCampaignForm } from "../NewCampaignForm";
import { isDemoWorkspaceActive } from "@/lib/demoWorkspace";

// Мастер кампании: «Кому → Письмо → Запуск». Письмо создаётся в текстовом
// формате; HTML-альтернатива используется отправкой только для Open Rate.
export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const workspace = await requireCapability("CAMPAIGNS_CREATE");
  const user = workspace.owner;
  const { error } = await searchParams;
  const demoActive = await isDemoWorkspaceActive(workspace.organizationId);

  const [segmentsRaw, businessProfile] = await Promise.all([
    prisma.contact.groupBy({
      by: ["segment"],
      where: { userId: user.id, isDemo: demoActive, segment: { not: null } },
    }),
    getPublishedBusinessProfile(user),
  ]);

  const segments = segmentsRaw
    .map((s) => s.segment)
    .filter((s): s is string => Boolean(s));

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold text-slate-900">Новая кампания</h1>
      <p className="mt-1 text-ink-500">
        Три шага: кому → письмо (ИИ напишет сам) → запуск.
      </p>
      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}
      <div className="mt-6">
        <NewCampaignForm
          segments={segments}
          onboardingDone={businessProfile.published && isBusinessProfileReady(businessProfile.profile)}
        />
      </div>
    </div>
  );
}
