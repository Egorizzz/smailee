import "server-only";
import { publicCompanyName } from "@/lib/company-data/contactPresentation";
import { effectiveCommunicationName } from "@/lib/mail/recipientPersonalization";
import { prisma } from "@/lib/prisma";

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

export async function loadCampaignSegmentPreviews(userId: string, isDemo: boolean): Promise<CampaignSegmentPreview[]> {
  const where = { userId, isDemo, isControl: false, status: "ACTIVE" as const, segment: { not: null } };
  const [groups, contacts] = await Promise.all([
    prisma.contact.groupBy({ by: ["segment"], where, _count: { _all: true }, orderBy: { segment: "asc" } }),
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
        sourceCompany: { select: { communicationName: true, communicationNameConfidence: true, legalName: true } },
      },
    }),
  ]);

  return groups.flatMap((group) => {
    if (!group.segment) return [];
    const samples = contacts.filter((contact) => contact.segment === group.segment).slice(0, 8).map((contact) => ({
      id: contact.id,
      email: contact.email,
      name: contact.name,
      role: contact.role,
      company: effectiveCommunicationName({
        communicationNameOverride: contact.communicationNameOverride,
        communicationName: contact.sourceCompany?.communicationName,
        communicationNameConfidence: contact.sourceCompany?.communicationNameConfidence,
      }) ?? publicCompanyName(contact.sourceCompany?.legalName ?? contact.company),
    }));
    return [{ segment: group.segment, count: group._count._all, contacts: samples }];
  });
}
