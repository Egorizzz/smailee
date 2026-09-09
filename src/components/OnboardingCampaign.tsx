import { NewCampaignForm } from "@/app/(app)/app/campaigns/NewCampaignForm";
import { getPublishedBusinessProfile, isBusinessProfileReady } from "@/lib/businessProfile/context";
import { prisma } from "@/lib/prisma";
import { loadCampaignSegmentPreviews } from "@/lib/campaigns/segmentPreviews";

export async function OnboardingCampaign({ userId }: { userId: string }) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const [segmentPreviews, businessProfile, control] = await Promise.all([
    loadCampaignSegmentPreviews(userId, false),
    getPublishedBusinessProfile(user),
    prisma.contact.findFirst({
      where: { userId, isDemo: false, isControl: true },
      select: { id: true, email: true, name: true, company: true, role: true },
    }),
  ]);
  const segments = segmentPreviews.map((item) => item.segment);

  return <NewCampaignForm
    segments={segments}
    segmentPreviews={segmentPreviews}
    onboardingDone={businessProfile.published && isBusinessProfileReady(businessProfile.profile)}
    onboarding
    controlAddress={control ? { email: control.email, name: control.name } : null}
  />;
}
