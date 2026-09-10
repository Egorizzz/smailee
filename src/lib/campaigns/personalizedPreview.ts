import { z } from "zod";

export const PERSONALIZED_PREVIEW_MAX = 5;

const previewSchema = z.object({
  contactId: z.string().min(1).max(200),
  segment: z.string().max(240).nullable(),
  email: z.string().email().max(320),
  name: z.string().max(240).nullable(),
  company: z.string().max(320).nullable(),
  subject: z.string().min(1).max(1_000),
  body: z.string().min(1).max(20_000),
});

export type CampaignPersonalizedPreviewItem = z.infer<typeof previewSchema>;

export function parsePersonalizedPreviews(raw: string): CampaignPersonalizedPreviewItem[] {
  if (!raw.trim()) return [];
  try {
    const parsed = z.array(previewSchema).max(PERSONALIZED_PREVIEW_MAX).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function personalizedPreviewKey(contactId: string, segment: string | null) {
  return `${segment ?? ""}\u0000${contactId}`;
}
