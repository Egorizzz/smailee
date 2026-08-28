export type ProspectingScenario = {
  key: "optimistic" | "realistic" | "pessimistic";
  label: string;
  candidateToContactRate: number;
  pagesPerCandidate: number;
  verificationRate: number;
  verificationRetryFactor: number;
  checkoEnrichmentRate: number;
  hunterCreditsPerCoveredCompany: number;
};

export const DEFAULT_PROSPECTING_SCENARIOS: ProspectingScenario[] = [
  { key: "optimistic", label: "Оптимистичный", candidateToContactRate: 0.85, pagesPerCandidate: 1.2, verificationRate: 0.3, verificationRetryFactor: 1, checkoEnrichmentRate: 0.2, hunterCreditsPerCoveredCompany: 0.18 },
  // 45% is the rounded 4/9 share of DataNewton cards whose email did not match
  // the supplied domain in the small provider study. Recalibrate after a paid run.
  { key: "realistic", label: "Реалистичный", candidateToContactRate: 0.65, pagesPerCandidate: 1.6, verificationRate: 0.6, verificationRetryFactor: 1, checkoEnrichmentRate: 0.45, hunterCreditsPerCoveredCompany: 0.4 },
  { key: "pessimistic", label: "Пессимистичный", candidateToContactRate: 0.40, pagesPerCandidate: 2.2, verificationRate: 1, verificationRetryFactor: 1.2, checkoEnrichmentRate: 0.7, hunterCreditsPerCoveredCompany: 0.64 },
];

export function calculateProspectingEconomics(input: {
  /** @deprecated Prefer targetContacts; target means companies that produced contacts. */
  target?: number;
  targetContacts?: number;
  usdRub?: number;
  scenarios?: ProspectingScenario[];
  dataNewtonRubPerRecord?: number;
  checkoRubPerRequest?: number;
  firecrawlUsdPerCredit?: number;
  hunterUsdPerCredit?: number;
  deepseekUsdPerPage?: number;
  contactsPerCoveredCompany?: number;
}) {
  const contactsPerCoveredCompany = input.contactsPerCoveredCompany ?? 2;
  const targetContacts = input.targetContacts ?? (input.target ?? 250) * contactsPerCoveredCompany;
  const target = Math.ceil(targetContacts / contactsPerCoveredCompany);
  const usdRub = input.usdRub ?? 90;
  const dn = input.dataNewtonRubPerRecord ?? 25_000 / 60_000;
  const checko = input.checkoRubPerRequest ?? 0.15;
  const firecrawl = input.firecrawlUsdPerCredit ?? 16 / 5_000;
  const hunter = input.hunterUsdPerCredit ?? 34 / 2_000;
  const deepseek = input.deepseekUsdPerPage ?? 0.0009;
  return (input.scenarios ?? DEFAULT_PROSPECTING_SCENARIOS).map((scenario) => {
    const candidates = Math.ceil(target / scenario.candidateToContactRate);
    const pages = Math.ceil(candidates * scenario.pagesPerCandidate);
    const checkoRequests = Math.ceil(candidates * scenario.checkoEnrichmentRate);
    const verificationChecks = Math.ceil(target * scenario.verificationRate * scenario.verificationRetryFactor);
    const hunterVerificationCredits = verificationChecks * 0.5;
    const hunterSearchCredits = target * scenario.hunterCreditsPerCoveredCompany;
    const hunterSearchRub = hunterSearchCredits * hunter * usdRub;
    const hunterVerificationRub = hunterVerificationCredits * hunter * usdRub;
    const components = {
      dataNewtonRub: candidates * dn,
      checkoRub: checkoRequests * checko,
      firecrawlRub: pages * firecrawl * usdRub,
      hunterRub: hunterSearchRub + hunterVerificationRub,
      deepseekRub: pages * deepseek * usdRub,
    };
    const totalRub = Object.values(components).reduce((sum, value) => sum + value, 0);
    return {
      ...scenario, target, targetContacts, estimatedContacts: target * contactsPerCoveredCompany, contactsPerCoveredCompany,
      candidates, pages, checkoRequests, verificationChecks, hunterSearchCredits, hunterVerificationCredits,
      hunterSearchRub, hunterVerificationRub, ...components, totalRub, rubPerCompany: totalRub / target,
      rubPerContact: totalRub / targetContacts,
    };
  });
}
