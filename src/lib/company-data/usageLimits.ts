function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function companyDataSafeMode() {
  return process.env.COMPANY_DATA_SAFE_MODE === "true";
}

export function companySearchLimit(requested: number) {
  if (!companyDataSafeMode()) return requested;
  return Math.min(requested, positiveInteger(process.env.COMPANY_DATA_SAFE_SEARCH_LIMIT, 3));
}

export function hunterDomainLimit(requested: number) {
  if (!companyDataSafeMode()) return requested;
  return Math.min(requested, positiveInteger(process.env.COMPANY_DATA_SAFE_HUNTER_LIMIT, 1));
}
