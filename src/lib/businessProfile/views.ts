import type { BusinessProfileData } from "@/lib/businessProfile/types";
import { parseBusinessProfile } from "@/lib/businessProfile/types";

export function resolveBusinessProfileViews(input: {
  manualData: unknown;
  draftData: unknown;
  publishedData: unknown;
  fallback: BusinessProfileData;
}) {
  return {
    manualProfile: parseBusinessProfile(input.manualData, input.fallback),
    draftProfile: parseBusinessProfile(
      input.draftData ?? input.publishedData ?? input.manualData,
      input.fallback
    ),
    publishedProfile: input.publishedData
      ? parseBusinessProfile(input.publishedData, input.fallback)
      : null,
  };
}
