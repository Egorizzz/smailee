import "server-only";
import { publicCompanyName } from "@/lib/company-data/contactPresentation";
import { effectiveCommunicationName } from "@/lib/mail/recipientPersonalization";
import { prisma } from "@/lib/prisma";
import {
  blockedCompanyIdsForCampaign,
  campaignHistoryEligibilityWhere,
} from "@/server/contactHistory";
import type { Prisma } from "@prisma/client";

export type CampaignSegmentPreview = {
  segment: string;
  count: number;
  contacts: Array<{
    id: string;
    email: string;
    name: string | null;
    company: string | null;
    role: string | null;
  }>;
};

export async function loadCampaignSegmentPreviews(
  userId: string,
  isDemo: boolean,
): Promise<CampaignSegmentPreview[]> {
  const blockedCompanyIds = isDemo
    ? []
    : await blockedCompanyIdsForCampaign(userId);
  const where: Prisma.ContactWhereInput = {
    userId,
    isDemo,
    isControl: false,
    status: "ACTIVE",
    relevanceStatus: "RELEVANT",
    segment: { not: null },
    ...(!isDemo ? campaignHistoryEligibilityWhere(blockedCompanyIds) : {}),
  };
  const [groups, contacts] = await Promise.all([
    prisma.contact.groupBy({
      by: ["segment"],
      where,
      _count: { _all: true },
      orderBy: { segment: "asc" },
    }),
    prisma.contact.findMany({
      where,
      orderBy: [{ segment: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        email: true,
        name: true,
        company: true,
        role: true,
        segment: true,
        communicationNameOverride: true,
        sourceCompany: {
          select: {
            communicationName: true,
            communicationNameConfidence: true,
            legalName: true,
          },
        },
      },
    }),
  ]);

  return groups.flatMap((group) => {
    if (!group.segment) return [];
    const samples = contacts
      .filter((contact) => contact.segment === group.segment)
      .slice(0, 8)
      .map((contact) => ({
        id: contact.id,
        email: contact.email,
        name: contact.name,
        role: contact.role,
        company:
          effectiveCommunicationName({
            communicationNameOverride: contact.communicationNameOverride,
            communicationName: contact.sourceCompany?.communicationName,
            communicationNameConfidence:
              contact.sourceCompany?.communicationNameConfidence,
          }) ??
          publicCompanyName(
            contact.sourceCompany?.legalName ?? contact.company,
          ),
      }));
    return [
      { segment: group.segment, count: group._count._all, contacts: samples },
    ];
  });
}
