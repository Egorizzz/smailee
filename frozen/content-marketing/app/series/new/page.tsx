import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NewSeriesForm } from "../NewSeriesForm";

export default async function NewSeriesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const { error } = await searchParams;

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
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-900">Новая серия контент-маркетинга</h1>
      <p className="mt-1 text-ink-500">
        Задайте тему — AI спланирует последовательность писем, напишет каждое и
        подберёт иллюстрацию. Вы проверяете и запускаете рассылку по расписанию.
      </p>
      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}
      <div className="mt-8">
        <NewSeriesForm
          segments={segments}
          senders={senders.map((s) => ({
            id: s.id,
            label: `${s.fromName} <${s.fromEmail}>${s.verified ? " ✓" : ""}`,
          }))}
        />
      </div>
    </div>
  );
}
