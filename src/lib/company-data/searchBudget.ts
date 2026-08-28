import type { Plan } from "@prisma/client";

export type ProspectingSearchMode = "standard" | "deep";

export const SEARCH_CREDITS_PER_COMPANY: Record<ProspectingSearchMode, number> = {
  standard: 1,
  deep: 4,
};

/** Internal policy values. They must not be rendered as product copy. */
export const SAFE_DEEP_SEARCH_SHARE = 0.1;
export const STANDARD_SEARCH_GRACE_SHARE = 0.02;
export const MIN_CONVERSION_SAMPLE = 30;

export const SEARCH_CREDIT_LIMITS: Record<Plan, number> = {
  TRIAL: 40,
  BASIC: 1_500,
  START: 7_000,
  PRO: 20_000,
};

const BENCHMARK_CONTACT_RATE: Record<ProspectingSearchMode, number> = {
  standard: 0.55,
  deep: 0.18,
};

const STANDARD_RESERVE_RATE = 0.42;
const STANDARD_RESERVE_SAFETY = 1.05;

export type ProspectingConversionHistory = {
  processed: number;
  accepted: number;
};

export type ProspectingBudgetEstimate = {
  mode: ProspectingSearchMode;
  targetContacts: number;
  creditsPerCompany: number;
  availableCredits: number;
  plannedCredits: number;
  maxCompanies: number;
  expectedContacts: number;
  ordinarySearchRemainder: number;
  ordinarySearchCapacity: number;
  conversionRate: number;
  conversionBasis: "benchmark" | "history";
  sampleSize: number;
  smallRequest: boolean;
};

export type DeepSearchRiskAssessment = {
  requiresConsent: boolean;
  forecastReliable: boolean;
  estimatedMaxContacts: number | null;
  projectedUsedPercent: number;
  projectedRemainingPercent: number;
  safeAllowanceExhausted: boolean;
};

export function prospectingSearchMode(query: unknown): ProspectingSearchMode {
  if (!query || typeof query !== "object" || Array.isArray(query)) return "standard";
  return (query as Record<string, unknown>).search_mode === "deep" ? "deep" : "standard";
}

export function prospectingCriteriaFingerprint(query: unknown) {
  const source = query && typeof query === "object" && !Array.isArray(query) ? query as Record<string, unknown> : {};
  const list = (key: string) => Array.isArray(source[key])
    ? (source[key] as unknown[]).filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean).sort()
    : [];
  const text = (key: string) => typeof source[key] === "string" ? source[key].trim() : "";
  return JSON.stringify({
    mode: prospectingSearchMode(source),
    description: text("search_description"),
    segment: text("segment"),
    okveds: list("okveds"),
    regions: list("region_codes"),
    forms: list("opf_codes"),
    roles: list("desired_roles"),
    required: list("keywords"),
    excluded: list("exclude_company_traits"),
    active: source.only_active !== false,
  });
}

export function searchCreditsForCompanies(mode: ProspectingSearchMode, companies: number) {
  return Math.max(0, Math.floor(companies)) * SEARCH_CREDITS_PER_COMPANY[mode];
}

export function estimateProspectingBudget(input: {
  mode: ProspectingSearchMode;
  targetContacts: number;
  availableCredits: number;
  modeCreditCap?: number;
  history?: ProspectingConversionHistory;
  standardHistory?: ProspectingConversionHistory;
}): ProspectingBudgetEstimate {
  const targetContacts = Math.max(1, Math.floor(input.targetContacts));
  const availableCredits = Math.max(0, Math.floor(input.availableCredits));
  const creditsPerCompany = SEARCH_CREDITS_PER_COMPANY[input.mode];
  const spendableCredits = Math.min(availableCredits, Math.max(0, Math.floor(input.modeCreditCap ?? availableCredits)));
  const affordableCompanies = Math.floor(spendableCredits / creditsPerCompany);
  const conversion = conversionForecast(input.mode, input.history);
  const requestedCompanies = Math.ceil(targetContacts / conversion.rate * (input.mode === "deep" ? 1.2 : 1.15));
  const maxCompanies = Math.min(affordableCompanies, Math.max(1, requestedCompanies));
  const expectedContacts = Math.min(targetContacts, Math.max(maxCompanies > 0 ? 1 : 0, Math.floor(maxCompanies * conversion.rate)));
  const ordinarySearchRemainder = input.mode === "deep" ? Math.max(0, targetContacts - expectedContacts) : 0;
  const ordinaryCreditsAfter = Math.max(0, availableCredits - maxCompanies * creditsPerCompany);
  const ordinarySearchCapacity = input.mode === "deep"
    ? estimatedStandardContactCapacity(ordinaryCreditsAfter, input.standardHistory)
    : 0;

  return {
    mode: input.mode,
    targetContacts,
    creditsPerCompany,
    availableCredits,
    plannedCredits: maxCompanies * creditsPerCompany,
    maxCompanies,
    expectedContacts,
    ordinarySearchRemainder,
    ordinarySearchCapacity,
    conversionRate: conversion.rate,
    conversionBasis: conversion.basis,
    sampleSize: conversion.sampleSize,
    smallRequest: targetContacts < MIN_CONVERSION_SAMPLE,
  };
}

export function safeDeepSearchCredits(input: {
  limit: number;
  remainingCredits: number;
  deepUsed: number;
  remainingContacts: number;
  standardHistory?: ProspectingConversionHistory;
}) {
  const limit = Math.max(0, Math.floor(input.limit));
  const safeShareRemaining = Math.max(0, Math.floor(limit * SAFE_DEEP_SEARCH_SHARE) - Math.max(0, Math.floor(input.deepUsed)));
  const reservedForStandard = standardCreditsRequired(input.remainingContacts, input.standardHistory);
  const unreservedCredits = Math.max(0, Math.floor(input.remainingCredits) - reservedForStandard);
  return Math.min(safeShareRemaining, unreservedCredits);
}

/** @deprecated Use safeDeepSearchCredits: this legacy ceiling ignores the standard-search reserve. */
export function remainingDeepSearchCredits(limit: number, deepUsed: number) {
  return Math.max(0, Math.floor(Math.max(0, limit) * 0.3) - Math.max(0, Math.floor(deepUsed)));
}

export function availableSearchCredits(input: {
  mode: ProspectingSearchMode;
  limit: number;
  used: number;
  deepUsed: number;
}) {
  const limit = Math.max(0, Math.floor(input.limit));
  const used = Math.max(0, Math.floor(input.used));
  if (input.mode === "deep" || input.deepUsed > 0) return Math.max(0, limit - used);
  const grace = Math.floor(limit * STANDARD_SEARCH_GRACE_SHARE);
  return Math.max(0, limit + grace - used);
}

export function searchLimitPercent(input: { used: number; planned?: number; limit: number }) {
  const limit = Math.max(0, Math.floor(input.limit));
  if (!limit) return { used: 0, planned: 0, remaining: 0 };
  const used = clamp(Math.max(0, input.used) / limit * 100, 0, 100);
  const planned = clamp(Math.max(0, input.planned ?? 0) / limit * 100, 0, 100 - used);
  return { used, planned, remaining: Math.max(0, 100 - used - planned) };
}

export function assessDeepSearchRisk(input: {
  limit: number;
  used: number;
  remainingCredits: number;
  deepUsed: number;
  remainingContacts: number;
  estimate: ProspectingBudgetEstimate;
  deepHistory?: ProspectingConversionHistory;
  standardHistory?: ProspectingConversionHistory;
}): DeepSearchRiskAssessment {
  const safeAllowance = safeDeepSearchCredits({
    limit: input.limit,
    remainingCredits: input.remainingCredits,
    deepUsed: input.deepUsed,
    remainingContacts: input.remainingContacts,
    standardHistory: input.standardHistory,
  });
  const requiresConsent = input.estimate.plannedCredits > safeAllowance;
  const creditsAfter = Math.max(0, input.remainingCredits - input.estimate.plannedCredits);
  const forecastReliable = hasReliableConversion(input.deepHistory)
    && hasReliableConversion(input.standardHistory);
  const estimatedMaxContacts = forecastReliable
    ? Math.min(
        Math.max(0, Math.floor(input.remainingContacts)),
        input.estimate.expectedContacts + standardContactCapacity(creditsAfter, input.standardHistory),
      )
    : null;
  const projected = searchLimitPercent({
    used: input.used,
    planned: input.estimate.plannedCredits,
    limit: input.limit,
  });
  return {
    requiresConsent,
    forecastReliable,
    estimatedMaxContacts,
    projectedUsedPercent: Math.round((projected.used + projected.planned) * 10) / 10,
    projectedRemainingPercent: Math.round(projected.remaining * 10) / 10,
    safeAllowanceExhausted: safeAllowance < SEARCH_CREDITS_PER_COMPANY.deep,
  };
}

export function hasReliableConversion(history?: ProspectingConversionHistory) {
  return Math.max(0, Math.floor(history?.processed ?? 0)) >= MIN_CONVERSION_SAMPLE;
}

function conversionForecast(mode: ProspectingSearchMode, history?: ProspectingConversionHistory) {
  const sampleSize = Math.max(0, Math.floor(history?.processed ?? 0));
  const benchmark = BENCHMARK_CONTACT_RATE[mode];
  const hasUsableHistory = hasReliableConversion(history);
  const rate = hasUsableHistory
    ? clamp((Math.max(0, history?.accepted ?? 0) + benchmark * MIN_CONVERSION_SAMPLE) / (sampleSize + MIN_CONVERSION_SAMPLE), 0.05, mode === "deep" ? 0.5 : 0.9)
    : benchmark;
  return { rate, basis: hasUsableHistory ? "history" as const : "benchmark" as const, sampleSize };
}

function conservativeStandardContactRate(history?: ProspectingConversionHistory) {
  if (!hasReliableConversion(history)) return STANDARD_RESERVE_RATE;
  return Math.max(0.15, conversionForecast("standard", history).rate * 0.8);
}

function standardCreditsRequired(contacts: number, history?: ProspectingConversionHistory) {
  const target = Math.max(0, Math.floor(contacts));
  if (!target) return 0;
  return Math.ceil(target / conservativeStandardContactRate(history) * STANDARD_RESERVE_SAFETY);
}

function standardContactCapacity(credits: number, history?: ProspectingConversionHistory) {
  return Math.max(0, Math.floor(Math.max(0, credits) * conservativeStandardContactRate(history) / STANDARD_RESERVE_SAFETY));
}

function estimatedStandardContactCapacity(credits: number, history?: ProspectingConversionHistory) {
  return Math.max(0, Math.floor(Math.max(0, credits) * conversionForecast("standard", history).rate / 1.15));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
