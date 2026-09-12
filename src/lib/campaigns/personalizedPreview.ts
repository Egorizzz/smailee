import { z } from "zod";

export const PERSONALIZED_PREVIEW_INITIAL_MAX = 5;
export const PERSONALIZED_PREVIEW_PERSISTED_MAX = 100;

export const previewRecipientSchema = z.object({
  contactId: z.string().min(1).max(200),
  segment: z.string().max(240).nullable(),
  email: z.string().email().max(320),
  name: z.string().max(240).nullable(),
  company: z.string().max(320).nullable(),
});

export type CampaignPreviewRecipient = z.infer<typeof previewRecipientSchema>;

const previewSchema = previewRecipientSchema.extend({
  subject: z.string().min(1).max(1_000),
  body: z.string().min(1).max(20_000),
  personalizationMode: z.enum(["personalized", "generic"]).optional(),
  usedContextIds: z.array(z.string().min(1).max(200)).max(32).optional(),
  reviewRequired: z.boolean().optional(),
  manuallyApproved: z.boolean().optional(),
});

export type CampaignPersonalizedPreviewItem = z.infer<typeof previewSchema>;

export function parsePersonalizedPreviews(raw: string): CampaignPersonalizedPreviewItem[] {
  if (!raw.trim()) return [];
  try {
    const parsed = z.array(previewSchema).max(PERSONALIZED_PREVIEW_PERSISTED_MAX).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function personalizedPreviewKey(contactId: string, segment: string | null) {
  return `${segment ?? ""}\u0000${contactId}`;
}
