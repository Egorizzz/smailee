import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EMAIL_PRESETS } from "@/lib/emailPresets";
import { NewCampaignForm } from "../NewCampaignForm";
import { brandForUser } from "@/lib/mail/brandShell";

// Мастер кампании (R3): «Кому → Письмо → Запуск». Шаблоны — не отдельная
// вкладка, а панель «Оформление» на шаге письма (+ бренд-цвет и логотип).
export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; error?: string }>;
}) {
  const user = await requireUser();
  const { preset, error } = await searchParams;

  const [segmentsRaw, userTemplates] = await Promise.all([
    prisma.contact.groupBy({
      by: ["segment"],
      where: { userId: user.id, segment: { not: null } },
    }),
    prisma.emailTemplate.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
      take: 12,
    }),
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
          onboardingDone={Boolean(user.offer && user.targetAudience)}
          initialPreset={preset ?? null}
          presets={EMAIL_PRESETS.map((p) => ({ key: p.key, name: p.name }))}
          userTemplates={userTemplates}
          // poweredBy решается здесь, на сервере, по тарифу — чтобы
          // предпросмотр показывал ровно то, что получит адресат
          brand={brandForUser(user)}
        />
      </div>
    </div>
  );
}
