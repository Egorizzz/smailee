export const USER_AGREEMENT_VERSION = "2026-08-17";
export const PUBLIC_OFFER_VERSION = "2026-08-17";
export const PRIVACY_POLICY_VERSION = "2026-08-17";
export const COOKIE_POLICY_VERSION = "2026-08-17";
export const PERSONAL_DATA_CONSENT_VERSION = "2026-08-17";
export const LEGAL_EFFECTIVE_DATE = "17 августа 2026 года";

export const LEGAL_CONTACT_EMAIL = "info@smailee.ru";

export const LEGAL_PROVIDER = {
  name: "Индивидуальный предприниматель Зайцев Егор Сергеевич",
  shortName: "ИП Зайцев Егор Сергеевич",
  inn: "623013074396",
  ogrnip: "325620000048493",
  bankName: 'ООО "Банк Точка"',
  bankAccount: "40802810920000791602",
  correspondentAccount: "30101810745374525104",
  bik: "044525104",
} as const;

export function hasAcceptedCurrentUserAgreement(input: {
  acceptedTermsAt: Date | null;
  acceptedTermsVersion: string | null;
}) {
  return Boolean(
    input.acceptedTermsAt && input.acceptedTermsVersion === USER_AGREEMENT_VERSION,
  );
}
