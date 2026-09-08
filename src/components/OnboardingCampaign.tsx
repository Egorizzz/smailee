import { NewCampaignForm } from "@/app/(app)/app/campaigns/NewCampaignForm";
import { getPublishedBusinessProfile, isBusinessProfileReady } from "@/lib/businessProfile/context";
import { prisma } from "@/lib/prisma";

export async function OnboardingCampaign({ userId }: { userId: string }) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const [segmentsRaw, businessProfile] = await Promise.all([
    prisma.contact.groupBy({
      by: ["segment"],
      where: { userId, isDemo: false, segment: { not: null } },
    }),
    getPublishedBusinessProfile(user),
  ]);
  const segments = segmentsRaw.map((item) => item.segment).filter((item): item is string => Boolean(item));

  return <NewCampaignForm
    segments={segments}
    onboardingDone={businessProfile.published && isBusinessProfileReady(businessProfile.profile)}
    onboarding
  />;
}
