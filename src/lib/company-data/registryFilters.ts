/** Revenue bounds are stored and sent to Filters API in rubles. */
export function revenueRubles(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) return NaN;
  return Math.round(Number(normalized) * 1_000_000);
}

export function registryFilterError(query: Record<string, unknown>): string | null {
  if (query.only_with_websites !== undefined && typeof query.only_with_websites !== "boolean") {
    return "Укажите, нужен ли сайт компании.";
  }
  for (const key of ["income_from", "income_to"]) {
    const value = query[key];
    if (value !== undefined && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) {
      return "Укажите выручку неотрицательным числом в допустимом диапазоне.";
    }
  }
  if (typeof query.income_from === "number" && typeof query.income_to === "number" && query.income_from > query.income_to) {
    return "Выручка «от» не должна превышать выручку «до».";
  }
  return null;
}

export function standardSearchQuery(query: Record<string, unknown>) {
  const safe = { ...query };
  for (const key of ["keywords", "exclude_company_traits", "workers_count_from", "workers_count_to", "registration_date_from"]) delete safe[key];
  return safe;
}

export function savedRegistryFilters(query: Record<string, unknown> | null) {
  return {
    hasWebsite: query?.only_with_websites === true,
    revenueFrom: typeof query?.income_from === "number" ? String(query.income_from / 1_000_000) : "",
    revenueTo: typeof query?.income_to === "number" ? String(query.income_to / 1_000_000) : "",
  };
}
