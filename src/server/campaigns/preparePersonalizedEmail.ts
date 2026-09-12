import { getBusinessContext } from "@/lib/businessProfile/context";
import {
  buildPersonalizedRecipientContext,
  hasSubstantivePersonalization,
  personalizedEmailContextHash,
  withRelationshipMemory,
  type PersonalizedEmailGenerationInput,
} from "@/lib/campaigns/personalizedEmail";
import { loadRelationshipMemory } from "@/server/contactHistory";

type Owner = Parameters<typeof getBusinessContext>[0] & {
  id: string;
  name: string | null;
  companyName: string | null;
};

type ContactForPersonalization = Parameters<
  typeof buildPersonalizedRecipientContext
>[0]["contact"] & {
  id: string;
  sourceCompanyId: string | null;
  sourceCompany?: Parameters<
    typeof buildPersonalizedRecipientContext
  >[0]["company"];
};

export type CampaignPersonalizationBrief = {
  name: string;
  segment: string | null;
  step: number;
  subjectGuide: string;
  bodyGuide: string;
};

/**
 * Единый конструктор входа персонализации для preview и фоновой отправки.
 * Здесь сосредоточены лимиты контекста, история контакта/компании и выбор
 * generic-режима. UI и worker больше не могут собрать разные письма из одних
 * и тех же исходных данных.
 */
export async function preparePersonalizedEmail(input: {
  owner: Owner;
  contact: ContactForPersonalization;
  campaign: CampaignPersonalizationBrief;
  excludeMessageId?: string;
  business?: Awaited<ReturnType<typeof getBusinessContext>>;
}): Promise<{
  generationInput: PersonalizedEmailGenerationInput;
  contextHash: string;
  business: Awaited<ReturnType<typeof getBusinessContext>>;
}> {
  const [relationship, business] = await Promise.all([
    loadRelationshipMemory({
      userId: input.owner.id,
      contactId: input.contact.id,
      companyId: input.contact.sourceCompanyId,
      excludeMessageId: input.excludeMessageId,
    }),
    input.business ?? getBusinessContext(input.owner),
  ]);
  const recipient = withRelationshipMemory(
    buildPersonalizedRecipientContext({
      contact: input.contact,
      company: input.contact.sourceCompany,
    }),
    relationship,
  );
  const generationInput: PersonalizedEmailGenerationInput = {
    personalizationMode: hasSubstantivePersonalization(recipient)
      ? "personalized"
      : "generic",
    campaign: {
      ...input.campaign,
      subjectGuide: input.campaign.subjectGuide.slice(0, 1_000),
      bodyGuide: input.campaign.bodyGuide.slice(0, 8_000),
    },
    sender: {
      name: input.owner.name,
      companyName: business.profile.companyName ?? input.owner.companyName,
      offer: business.offer,
      targetAudience: business.targetAudience,
      websiteUrl: business.websiteUrl,
      businessContext: business.promptContext,
    },
    recipient,
    previousEmails: relationship.previousEmails,
  };
  return {
    generationInput,
    contextHash: personalizedEmailContextHash(generationInput),
    business,
  };
}
