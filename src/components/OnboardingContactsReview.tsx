import { ContactsWorkspace, type ContactWorkspaceItem } from "@/components/ContactsWorkspace";
import { publicCompanyFacts, publicCompanyName, publicSegment } from "@/lib/company-data/contactPresentation";
import { effectiveCommunicationName } from "@/lib/mail/recipientPersonalization";
import { can, type Workspace } from "@/lib/organization";
import { prisma } from "@/lib/prisma";

export async function OnboardingContactsReview({ workspace, initialSegment }: { workspace: Workspace; initialSegment?: string }) {
  const contacts = await prisma.contact.findMany({
    where: { userId: workspace.owner.id, isDemo: false, isControl: false },
    orderBy: { createdAt: "desc" },
    take: 500,
    include: { sourceCompany: { include: { siteIntelligence: true } } },
  });

  const items: ContactWorkspaceItem[] = contacts.map((contact) => {
    const intelligence = asRecord(contact.sourceCompany?.siteIntelligence?.intelligence);
    const companyData = asRecord(contact.sourceCompany?.data);
    const companyFacts = publicCompanyFacts(companyData, { inn: contact.sourceCompany?.inn });
    const activity = companyFacts.find((fact) => fact.key === "activity")?.value;
    const autoCommunicationName = effectiveCommunicationName({
      communicationName: contact.sourceCompany?.communicationName,
      communicationNameConfidence: contact.sourceCompany?.communicationNameConfidence,
    });
    const communicationName = effectiveCommunicationName({
      communicationNameOverride: contact.communicationNameOverride,
      communicationName: contact.sourceCompany?.communicationName,
      communicationNameConfidence: contact.sourceCompany?.communicationNameConfidence,
    });

    return {
      id: contact.id,
      email: contact.email,
      name: contact.name,
      company: communicationName,
      autoCommunicationName,
      communicationNameOverride: contact.communicationNameOverride,
      legalCompanyName: publicCompanyName(contact.sourceCompany?.legalName ?? contact.company),
      segment: publicSegment(contact.segment, activity),
      role: contact.role,
      source: contact.source,
      domain: contact.sourceCompany?.domain ?? contact.domain,
      website: contact.sourceCompany?.website ?? contact.website,
      status: contact.status,
      verificationState: contact.verificationState,
      verificationScore: contact.verificationScore,
      relevanceStatus: contact.relevanceStatus,
      irrelevanceReason: contact.irrelevanceReason,
      createdAt: contact.createdAt.toISOString(),
      customFields: asRecord(contact.customFields),
      companyFacts,
      siteIntelligence: intelligence ? {
        summary: typeof intelligence.summary === "string" ? intelligence.summary : undefined,
        facts: Array.isArray(intelligence.facts) ? intelligence.facts as Array<{ category?: string; value?: string }> : undefined,
        personalizationHooks: Array.isArray(intelligence.personalizationHooks) ? intelligence.personalizationHooks as Array<{ value?: string } | string> : undefined,
      } : null,
    };
  });

  return (
    <ContactsWorkspace
      key={initialSegment ?? "all"}
      contacts={items}
      total={contacts.length}
      canManage={can(workspace, "CONTACTS_MANAGE")}
      embedded
      initialSegment={initialSegment}
    />
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
