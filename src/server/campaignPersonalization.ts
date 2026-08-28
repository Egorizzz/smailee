import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getBusinessContext } from "@/lib/businessProfile/context";
import {
  PERSONALIZED_EMAIL_REVISION,
  buildPersonalizedRecipientContext,
  hasSubstantivePersonalization,
  personalizedEmailContextHash,
} from "@/lib/campaigns/personalizedEmail";
import {
  FOLLOWUP_EMAIL_REVISION,
  followupEmailContextHash,
  type FollowupEmailGenerationInput,
} from "@/lib/campaigns/followupEmail";
import { generateFollowupEmail, generatePersonalizedEmail, LlmPersonalizationRejectedError } from "@/lib/services/llm";

const GENERATION_BATCH_SIZE = 5;
const CLAIM_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

export type CampaignPersonalizationResult = {
  claimed: number;
  ready: number;
  retrying: number;
  failed: number;
};

/**
 * Materializes final copy before SMTP sees it. The segment copy stored on the
 * campaign is a creative brief; Message.subject/body become recipient-specific.
 */
export async function processCampaignPersonalization(
  campaignId: string,
  now = new Date(),
  limit = GENERATION_BATCH_SIZE,
): Promise<CampaignPersonalizationResult> {
  const result: CampaignPersonalizationResult = { claimed: 0, ready: 0, retrying: 0, failed: 0 };
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, include: { user: true } });
  if (!campaign || campaign.isDemo || !["QUEUED", "SENDING"].includes(campaign.status)) return result;

  const staleBefore = new Date(now.getTime() - CLAIM_TTL_MS);
  await prisma.message.updateMany({
    where: {
      campaignId,
      status: "PENDING",
      personalizationStatus: "PROCESSING",
      personalizationClaimedAt: { lt: staleBefore },
    },
    data: {
      personalizationStatus: "PENDING",
      personalizationClaimedAt: null,
      personalizationNextAttemptAt: now,
    },
  });

  const claimed = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "Message"
    SET "personalizationStatus" = 'PROCESSING',
        "personalizationAttempts" = "personalizationAttempts" + 1,
        "personalizationClaimedAt" = ${now},
        "personalizationNextAttemptAt" = NULL,
        "personalizationError" = NULL
    WHERE id IN (
      SELECT id FROM "Message"
      WHERE "campaignId" = ${campaignId}
        AND status = 'PENDING'
        AND "personalizationStatus" = 'PENDING'
        AND ("personalizationNextAttemptAt" IS NULL OR "personalizationNextAttemptAt" <= ${now})
      ORDER BY "createdAt" ASC
      LIMIT ${Math.max(1, Math.min(limit, 20))}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `;
  result.claimed = claimed.length;
  if (!claimed.length) return result;

  const messages = await prisma.message.findMany({
    where: { id: { in: claimed.map((item) => item.id) } },
    include: { contact: { include: { sourceCompany: { include: { siteIntelligence: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  let business: Awaited<ReturnType<typeof getBusinessContext>> | null = null;

  for (const message of messages) {
    try {
      if (message.step > 0) {
        const previousEmail = await prisma.message.findFirst({
          where: {
            campaignId,
            contactId: message.contactId,
            step: message.step - 1,
            status: { in: ["SENT", "DELIVERED", "OPENED"] },
            personalizationStatus: "READY",
          },
          orderBy: { sentAt: "desc" },
          select: { subject: true, body: true },
        });
        if (!previousEmail) {
          await failGeneration(message.id, "FOLLOWUP_PREVIOUS_MESSAGE_MISSING", true);
          result.failed++;
          continue;
        }

        const generationInput: FollowupEmailGenerationInput = {
          structure: {
            subjectGuide: message.subject.slice(0, 240),
            bodyGuide: message.body.slice(0, 1_000),
          },
          lastEmail: {
            subject: previousEmail.subject.slice(0, 240),
            body: previousEmail.body.slice(0, 6_000),
          },
          followupsSent: Math.max(0, message.step - 1),
        };
        const generated = await generateFollowupEmail(generationInput);
        await markReady(message.id, generated.data, followupEmailContextHash(generationInput), {
          revision: FOLLOWUP_EMAIL_REVISION,
          mode: "minimal_followup",
          usedContextIds: [],
        }, now);
        result.ready++;
        continue;
      }

      const recipient = buildPersonalizedRecipientContext({
        contact: message.contact,
        company: message.contact.sourceCompany,
      });
      if (!hasSubstantivePersonalization(recipient)) {
        await failGeneration(message.id, "PERSONALIZATION_CONTEXT_INSUFFICIENT", true);
        result.failed++;
        continue;
      }

      business ??= await getBusinessContext(campaign.user);
      const generationInput = {
        campaign: {
          name: campaign.name,
          segment: campaign.segment,
          step: message.step,
          subjectGuide: message.subject.slice(0, 1_000),
          bodyGuide: message.body.slice(0, 8_000),
        },
        sender: {
          offer: business.offer,
          targetAudience: business.targetAudience,
          websiteUrl: business.websiteUrl,
          businessContext: business.promptContext,
        },
        recipient,
        previousEmails: [],
      };
      const contextHash = personalizedEmailContextHash(generationInput);
      const generated = await generatePersonalizedEmail(generationInput);

      await markReady(message.id, generated.data, contextHash, {
        revision: PERSONALIZED_EMAIL_REVISION,
        mode: "recipient_first_touch",
        usedContextIds: generated.data.usedContextIds,
      }, now);
      result.ready++;
    } catch (error) {
      console.error("[CMP-2101] recipient email generation", { campaignId, messageId: message.id, error });
      if (error instanceof LlmPersonalizationRejectedError) {
        await failGeneration(message.id, "PERSONALIZATION_QUALITY_REJECTED", true);
        result.failed++;
        continue;
      }
      const terminal = message.personalizationAttempts >= MAX_ATTEMPTS;
      await failGeneration(message.id, "PERSONALIZATION_GENERATION_UNAVAILABLE", terminal, terminal ? null : retryAt(now, message.personalizationAttempts));
      if (terminal) result.failed++;
      else result.retrying++;
    }
  }
  return result;
}

async function markReady(
  messageId: string,
  generated: { subject: string; body: string },
  contextHash: string,
  meta: Prisma.InputJsonObject,
  now: Date,
) {
  await prisma.message.updateMany({
    where: { id: messageId, personalizationStatus: "PROCESSING" },
    data: {
      subject: generated.subject,
      body: generated.body,
      personalizationStatus: "READY",
      personalizationContextHash: contextHash,
      personalizationMeta: meta,
      personalizationError: null,
      personalizationClaimedAt: null,
      personalizationNextAttemptAt: null,
      personalizedAt: now,
    },
  });
}

async function failGeneration(messageId: string, code: string, terminal: boolean, nextAttemptAt: Date | null = null) {
  await prisma.message.updateMany({
    where: { id: messageId, personalizationStatus: "PROCESSING" },
    data: {
      personalizationStatus: terminal ? "FAILED" : "PENDING",
      personalizationError: code,
      personalizationClaimedAt: null,
      personalizationNextAttemptAt: terminal ? null : nextAttemptAt,
    },
  });
}

function retryAt(now: Date, attempts: number) {
  const delayMinutes = [1, 5, 15, 60][Math.max(0, Math.min(attempts - 1, 3))];
  return new Date(now.getTime() + delayMinutes * 60_000);
}
