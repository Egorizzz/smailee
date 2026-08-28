import { COMMUNICATION_NAME_MIN_CONFIDENCE } from "@/lib/company-data/communicationName";

type RecipientPersonalizationInput = {
  name?: string | null;
  email: string;
  communicationNameOverride?: string | null;
  communicationName?: string | null;
  communicationNameConfidence?: number | null;
  domain?: string | null;
  website?: string | null;
  siteConfirmed?: boolean;
  ctaUrl?: string | null;
};

export function effectiveCommunicationName(input: Pick<RecipientPersonalizationInput,
  "communicationNameOverride" | "communicationName" | "communicationNameConfidence"
>) {
  if (input.communicationNameOverride !== null && input.communicationNameOverride !== undefined) {
    return cleanName(input.communicationNameOverride) || null;
  }
  if (!input.communicationName || (input.communicationNameConfidence ?? 0) < COMMUNICATION_NAME_MIN_CONFIDENCE) return null;
  return cleanName(input.communicationName) || null;
}

export function recipientPersonalization(input: RecipientPersonalizationInput) {
  const firstName = usableFirstName(input.name);
  const company = effectiveCommunicationName(input);
  const domain = input.siteConfirmed === false ? "" : normalizeDomain(input.domain || input.website);
  return {
    name: firstName,
    company,
    company_domain: domain,
    greeting: firstName ? `Здравствуйте, ${firstName}!` : "Здравствуйте!",
    company_observation: company && domain
      ? `Изучил сайт «${company}» — ${domain}.`
      : company
        ? `Обращаюсь к команде «${company}».`
        : domain
          ? `Изучил ваш сайт ${domain}.`
          : "",
    email: input.email,
    cta_url: input.ctaUrl ?? "",
  };
}

function usableFirstName(value?: string | null) {
  const cleaned = value?.trim().replace(/\s+/g, " ") ?? "";
  if (!cleaned || cleaned.length > 100 || /@|\d/.test(cleaned)) return "";
  if (/^(?:не найдено|контакт|получатель|директор|руководитель|менеджер|info|sales|support)$/i.test(cleaned)) return "";
  const first = cleaned.split(" ")[0].replace(/^[^\p{L}]+|[^\p{L}-]+$/gu, "");
  if (first.length < 2) return "";
  return first === first.toLocaleUpperCase("ru-RU")
    ? first[0].toLocaleUpperCase("ru-RU") + first.slice(1).toLocaleLowerCase("ru-RU")
    : first;
}

function cleanName(value: string) {
  return value.trim().replace(/^[«“„\"']+|[»”\"']+$/g, "").replace(/\s+/g, " ");
}

function normalizeDomain(value?: string | null) {
  if (!value) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}
