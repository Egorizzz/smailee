import assert from "node:assert/strict";
import {
  assessDeepSearchRisk,
  availableSearchCredits,
  estimateProspectingBudget,
  safeDeepSearchCredits,
  searchLimitPercent,
} from "../src/lib/company-data/searchBudget";

const basicLimit = 1_500;

assert.equal(safeDeepSearchCredits({
  limit: basicLimit,
  remainingCredits: basicLimit,
  deepUsed: 0,
  remainingContacts: 500,
}), 150, "first safe deep-search allowance is capped at 10% while preserving the standard reserve");

const firstDeepSearch = estimateProspectingBudget({
  mode: "deep",
  targetContacts: 5,
  availableCredits: basicLimit,
});
assert.equal(firstDeepSearch.plannedCredits, 136);
assert.equal(assessDeepSearchRisk({
  limit: basicLimit,
  used: 0,
  remainingCredits: basicLimit,
  deepUsed: 0,
  remainingContacts: 500,
  estimate: firstDeepSearch,
}).requiresConsent, false, "a small first deep search stays frictionless");

assert.equal(safeDeepSearchCredits({
  limit: basicLimit,
  remainingCredits: basicLimit - firstDeepSearch.plannedCredits,
  deepUsed: firstDeepSearch.plannedCredits,
  remainingContacts: 495,
}), 14, "the safe allowance shrinks after deep-search usage");
assert.equal(assessDeepSearchRisk({
  limit: basicLimit,
  used: firstDeepSearch.plannedCredits,
  remainingCredits: basicLimit - firstDeepSearch.plannedCredits,
  deepUsed: firstDeepSearch.plannedCredits,
  remainingContacts: 495,
  estimate: firstDeepSearch,
}).requiresConsent, true, "the next deep search requires explicit consent when the safe allowance is crossed");

const largeDeepSearch = estimateProspectingBudget({
  mode: "deep",
  targetContacts: 500,
  availableCredits: basicLimit,
});
const uncertainRisk = assessDeepSearchRisk({
  limit: basicLimit,
  used: 0,
  remainingCredits: basicLimit,
  deepUsed: 0,
  remainingContacts: 500,
  estimate: largeDeepSearch,
});
assert.equal(uncertainRisk.requiresConsent, true);
assert.equal(uncertainRisk.forecastReliable, false);
assert.equal(uncertainRisk.estimatedMaxContacts, null, "a numeric maximum is hidden before both modes have enough history");

const reliableRisk = assessDeepSearchRisk({
  limit: basicLimit,
  used: 200,
  remainingCredits: 1_300,
  deepUsed: 200,
  remainingContacts: 450,
  estimate: estimateProspectingBudget({
    mode: "deep",
    targetContacts: 50,
    availableCredits: 1_300,
    history: { processed: 100, accepted: 20 },
    standardHistory: { processed: 100, accepted: 55 },
  }),
  deepHistory: { processed: 100, accepted: 20 },
  standardHistory: { processed: 100, accepted: 55 },
});
assert.equal(reliableRisk.forecastReliable, true);
assert.ok((reliableRisk.estimatedMaxContacts ?? 0) > 0);

assert.equal(availableSearchCredits({ mode: "standard", limit: basicLimit, used: 0, deepUsed: 0 }), 1_530, "ordinary-only search receives a 2% grace");
assert.equal(availableSearchCredits({ mode: "standard", limit: basicLimit, used: 0, deepUsed: 4 }), 1_500, "the grace is disabled after any deep-search usage");
assert.deepEqual(searchLimitPercent({ used: 1_490, planned: 100, limit: basicLimit }), {
  used: 99.33333333333333,
  planned: 0.6666666666666714,
  remaining: 0,
}, "customer-facing progress never exceeds 100%");

console.log("search-limit-policy: ok");
