export const CONTACT_QUOTA_SOURCE = {
  aiSearch: "AI_SEARCH",
  aiSearchBonus: "AI_SEARCH_BONUS",
  userUpload: "USER_UPLOAD",
} as const;

export const NON_UPLOAD_QUOTA_SOURCES = [
  CONTACT_QUOTA_SOURCE.aiSearch,
  CONTACT_QUOTA_SOURCE.aiSearchBonus,
] as const;
