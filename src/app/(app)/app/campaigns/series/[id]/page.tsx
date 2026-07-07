import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SeriesReview } from "./SeriesReview";

export default async function SeriesDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  const campaign = await prisma.campaign.findFirst({
    where: { id, userId: user.id, type: "SERIES" },
    include: { contentSteps: { orderBy: { stepIndex: "asc" } } },
  });
  if (!campaign) notFound();

  const messages = await prisma.message.findMany({
    where: { campaignId: campaign.id },
    select: { status: true, openedAt: true, isPersonalNudge: true },
  });
  const leads = await prisma.lead.findMany({
    where: { message: { campaignId: campaign.id } },
    include: { message: { include: { contact: true } } },
    orderBy: { createdAt: "desc" },
  });

  const stats = {
    sent: messages.filter((m) => m.status !== "PENDING").length,
    opened: messages.filter((m) => m.openedAt).length,
    nudges: messages.filter((m) => m.isPersonalNudge).length,
  };

  return (
    <SeriesReview
      campaign={{
        id: campaign.id,
        name: campaign.name,
        seriesTopic: campaign.seriesTopic ?? "",
        seriesFrequencyDays: campaign.seriesFrequencyDays ?? 0,
        seriesTotalSteps: campaign.seriesTotalSteps ?? 0,
        segment: campaign.segment,
        status: campaign.status,
      }}
      steps={campaign.contentSteps.map((s) => ({
        id: s.id,
        stepIndex: s.stepIndex,
        topic: s.topic,
        angle: s.angle,
        dayOffset: s.dayOffset,
        includeCta: s.includeCta,
        ctaLabel: s.ctaLabel,
        subject: s.subject,
        body: s.body,
        status: s.status,
      }))}
      stats={stats}
      leads={leads.map((l) => ({
        id: l.id,
        summary: l.summary ?? "",
        contactEmail: l.message.contact.email,
      }))}
    />
  );
}
