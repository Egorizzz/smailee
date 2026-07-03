import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NewCampaignForm } from "../NewCampaignForm";

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; error?: string }>;
}) {
  const user = await requireUser();
  const { preset, error } = await searchParams;

  const [segmentsRaw, senders] = await Promise.all([
    prisma.contact.groupBy({
      by: ["segment"],
      where: { userId: user.id, segment: { not: null } },
    }),
    prisma.sender.findMany({ where: { userId: user.id } }),
  ]);

  const segments = segmentsRaw
    .map((s) => s.segment)
    .filter((s): s is string => Boolean(s));

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold text-slate-900">Новая кампания</h1>
      <p className="mt-1 text-ink-500">
        AI напишет письма, вы выберете вариант, проверите и запустите рассылку.
      </p>
      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}
      <div className="mt-8">
        <NewCampaignForm
          segments={segments}
          senders={senders.map((s) => ({
            id: s.id,
            label: `${s.fromName} <${s.fromEmail}>${s.verified ? " ✓" : ""}`,
          }))}
          onboardingDone={Boolean(user.offer && user.targetAudience)}
          initialPreset={preset ?? null}
        />
      </div>
    </div>
  );
}
