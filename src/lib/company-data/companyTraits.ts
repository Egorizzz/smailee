import type { CompanySiteIntelligenceData } from "./siteIntelligence";

export type CompanyTraitEvaluation = {
  matchedRequired: string[];
  missingRequired: string[];
  matchedExcluded: string[];
  passes: boolean;
};

export function evaluateCompanyTraits(
  intelligence: CompanySiteIntelligenceData,
  requiredTraits: string[],
  excludedTraits: string[],
): CompanyTraitEvaluation {
  const corpusSegments = [
    ...intelligence.summary.split(/[.!?;\n]+/),
    ...intelligence.facts.flatMap((fact) => [fact.value, fact.evidence]),
    ...intelligence.personalizationHooks.flatMap((fact) => [fact.value, fact.evidence]),
  ].filter(Boolean);
  const matches = (trait: string) => {
    const required = semanticTokens(trait);
    const negative = hasNegation(trait);
    return required.length > 0 && corpusSegments.some((segment) => {
      if (hasNegation(segment) !== negative) return false;
      const candidates = semanticTokens(segment);
      return required.every((token) => candidates.some((candidate) => tokensEquivalent(candidate, token)));
    });
  };
  const matchedRequired = requiredTraits.filter(matches);
  const missingRequired = requiredTraits.filter((trait) => !matchedRequired.includes(trait));
  const matchedExcluded = excludedTraits.filter(matches);
  return { matchedRequired, missingRequired, matchedExcluded, passes: missingRequired.length === 0 && matchedExcluded.length === 0 };
}

function semanticTokens(value: string) {
  return normalize(value).split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 3 && !STOP_WORDS.has(stem(token)));
}

function tokensEquivalent(left: string, right: string) {
  const leftStem = stem(left);
  const rightStem = stem(right);
  if (leftStem === rightStem) return true;
  return SEMANTIC_GROUPS.some((group) => group.some((item) => leftStem.startsWith(item)) && group.some((item) => rightStem.startsWith(item)));
}

function normalize(value: string) {
  return value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
}

function hasNegation(value: string) {
  return /(?:^|[^\p{L}])(не|без|нет|отсутств\p{L}*)(?:[^\p{L}]|$)/iu.test(value);
}

function stem(token: string) {
  return token.length > 5 ? token.slice(0, 5) : token;
}

const STOP_WORDS = new Set(["есть", "имеет", "компа", "работ", "деяте", "котор", "среди", "свой"]);
const SEMANTIC_GROUPS = [
  ["b2b", "б2б", "бизне", "корпо"],
  ["b2c", "б2с", "физич", "физли", "розни"],
  ["тенде", "закуп", "госза"],
  ["филиа", "отдел"],
  ["произ", "завод", "фабри"],
];
