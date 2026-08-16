import { z } from "zod";
import {
  businessProductSchema,
  type BusinessProfileData,
  type BusinessProfileOverrideKey,
} from "@/lib/businessProfile/types";

const editableList = z.array(z.string().trim().min(1).max(1000)).max(30);

export const editableBusinessProfileSchema = z.object({
  companyName: z.string().trim().max(300).nullable(),
  websiteUrl: z.string().url().nullable(),
  summary: z.string().trim().max(3000),
  offers: editableList,
  products: z.array(businessProductSchema).max(30),
  targetAudiences: editableList,
  painPoints: editableList,
  differentiators: editableList,
  proof: editableList,
  geography: editableList,
  salesProcess: editableList,
  restrictions: editableList,
  tone: z.string().trim().max(1500),
  manualNotes: z.string().trim().max(10_000),
});

export type EditableBusinessProfile = z.infer<typeof editableBusinessProfileSchema>;

export const EDITABLE_PROFILE_KEYS = [
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
] as const satisfies readonly BusinessProfileOverrideKey[];

export function splitProfileEditorLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 30);
}

export function applyEditableBusinessProfile(
  profile: BusinessProfileData,
  edited: EditableBusinessProfile,
): BusinessProfileData {
  return { ...profile, ...edited };
}

export function rememberEditableBusinessProfile(
  manual: BusinessProfileData,
  edited: EditableBusinessProfile,
): BusinessProfileData {
  return {
    ...manual,
    ...edited,
    manualOverrides: [...new Set([...manual.manualOverrides, ...EDITABLE_PROFILE_KEYS])],
  };
}

export function applyManualBusinessProfileOverrides(
  generated: BusinessProfileData,
  manual: BusinessProfileData,
): BusinessProfileData {
  const result: BusinessProfileData = { ...generated };

  // Compatibility for profiles created before explicit override keys existed.
  if (manual.companyName) result.companyName = manual.companyName;
  if (manual.websiteUrl) result.websiteUrl = manual.websiteUrl;
  if (manual.manualNotes) result.manualNotes = manual.manualNotes;
  if (manual.offers.length) result.offers = manual.offers;
  if (manual.targetAudiences.length) result.targetAudiences = manual.targetAudiences;

  for (const key of manual.manualOverrides) {
    switch (key) {
      case "companyName": result.companyName = manual.companyName; break;
      case "websiteUrl": result.websiteUrl = manual.websiteUrl; break;
      case "summary": result.summary = manual.summary; break;
      case "offers": result.offers = [...manual.offers]; break;
      case "products": result.products = manual.products.map((item) => ({ ...item })); break;
      case "targetAudiences": result.targetAudiences = [...manual.targetAudiences]; break;
      case "painPoints": result.painPoints = [...manual.painPoints]; break;
      case "differentiators": result.differentiators = [...manual.differentiators]; break;
      case "proof": result.proof = [...manual.proof]; break;
      case "geography": result.geography = [...manual.geography]; break;
      case "salesProcess": result.salesProcess = [...manual.salesProcess]; break;
      case "restrictions": result.restrictions = [...manual.restrictions]; break;
      case "tone": result.tone = manual.tone; break;
      case "manualNotes": result.manualNotes = manual.manualNotes; break;
    }
  }
  result.manualOverrides = [...manual.manualOverrides];
  return result;
}
