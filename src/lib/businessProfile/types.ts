import { z } from "zod";

export const businessFactCategorySchema = z.enum([
  "identity",
  "offer",
  "product",
  "pricing",
  "audience",
  "pain",
  "differentiator",
  "proof",
  "geography",
  "sales_process",
  "restriction",
  "tone",
]);

export const pageFactSchema = z.object({
  category: businessFactCategorySchema,
  value: z.string().trim().min(1).max(1000),
  evidence: z.string().trim().max(500).default(""),
  confidence: z.number().min(0).max(1).default(0.5),
  sensitive: z.boolean().default(false),
});

export const pageAnalysisSchema = z.object({
  relevant: z.boolean().default(true),
  summary: z.string().trim().max(1500).default(""),
  facts: z.array(pageFactSchema).max(30).default([]),
  communicationName: z.string().trim().max(300).default(""),
  communicationNameConfidence: z.number().min(0).max(1).default(0),
  communicationNameEvidence: z.string().trim().max(500).default(""),
});

export type PageAnalysis = z.infer<typeof pageAnalysisSchema>;

/// A single invented category must not discard all otherwise valid evidence from a page.
export function parsePageAnalysisPayload(value: unknown): PageAnalysis {
  const envelope = z.object({
    relevant: z.boolean().default(true),
    summary: z.string().trim().max(1500).default(""),
    facts: z.array(z.unknown()).max(30).default([]),
    communicationName: z.string().trim().max(300).default(""),
    communicationNameConfidence: z.number().min(0).max(1).default(0),
    communicationNameEvidence: z.string().trim().max(500).default(""),
  }).parse(value);
  return pageAnalysisSchema.parse({
    ...envelope,
    facts: envelope.facts.flatMap((fact) => {
      const parsed = pageFactSchema.safeParse(fact);
      return parsed.success ? [parsed.data] : [];
    }),
  });
}

export const businessProductSchema = z.object({
  name: z.string().trim().max(200),
  description: z.string().trim().max(1500).default(""),
  pricing: z.string().trim().max(500).default(""),
  pricingConfirmed: z.boolean().default(false),
  sourceUrl: z.string().url().optional().or(z.literal("")),
});

const shortList = z.array(z.string().trim().min(1).max(1000)).max(30).default([]);

export const profileSourceSchema = z.object({
  url: z.string().url(),
  title: z.string().trim().max(300).default(""),
});

export const businessProfileOverrideKeySchema = z.enum([
  "companyName",
  "websiteUrl",
  "summary",
  "offers",
  "products",
  "targetAudiences",
  "painPoints",
  "differentiators",
  "proof",
  "geography",
  "salesProcess",
  "restrictions",
  "tone",
  "manualNotes",
]);

export type BusinessProfileOverrideKey = z.infer<typeof businessProfileOverrideKeySchema>;

export const businessProfileDataSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  companyName: z.string().trim().max(300).nullable().default(null),
  websiteUrl: z.string().url().nullable().default(null),
  summary: z.string().trim().max(3000).default(""),
  offers: shortList,
  products: z.array(businessProductSchema).max(30).default([]),
  targetAudiences: shortList,
  painPoints: shortList,
  differentiators: shortList,
  proof: shortList,
  geography: shortList,
  salesProcess: shortList,
  restrictions: shortList,
  tone: z.string().trim().max(1500).default(""),
  manualNotes: z.string().trim().max(10000).default(""),
  unknowns: shortList,
  sources: z.array(profileSourceSchema).max(100).default([]),
  manualOverrides: z.array(businessProfileOverrideKeySchema).max(20).default([]),
});

export type BusinessProfileData = z.infer<typeof businessProfileDataSchema>;

export const generatedQuestionSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const item = value as Record<string, unknown>;
  const meta = item.meta && typeof item.meta === "object" && !Array.isArray(item.meta)
    ? item.meta as Record<string, unknown>
    : {};
  const category = typeof item.category === "string" && item.category.trim() ? item.category.trim() : "general";
  return {
    ...item,
    category,
    critical: typeof item.critical === "boolean"
      ? item.critical
      : typeof meta.critical === "boolean" ? meta.critical : /offer|audien|оффер|аудитор/i.test(category),
  };
}, z.object({
  category: z.string().trim().max(100),
  question: z.string().trim().min(1).max(1000),
  reason: z.string().trim().max(1000).default(""),
  critical: z.boolean().default(false),
}));

export const profileSynthesisSchema = z.object({
  profile: businessProfileDataSchema,
  questions: z.array(generatedQuestionSchema).max(8).default([]),
});

export type ProfileSynthesis = z.infer<typeof profileSynthesisSchema>;

export function emptyBusinessProfile(input?: {
  companyName?: string | null;
  websiteUrl?: string | null;
  offer?: string | null;
  targetAudience?: string | null;
}): BusinessProfileData {
  return businessProfileDataSchema.parse({
    schemaVersion: 1,
    companyName: input?.companyName ?? null,
    websiteUrl: input?.websiteUrl || null,
    offers: input?.offer ? [input.offer] : [],
    targetAudiences: input?.targetAudience ? [input.targetAudience] : [],
  });
}

export function parseBusinessProfile(value: unknown, fallback?: BusinessProfileData) {
  const parsed = businessProfileDataSchema.safeParse(value);
  return parsed.success ? parsed.data : (fallback ?? emptyBusinessProfile());
}

export function stripJsonFence(value: string) {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}
