const TIMING = {
  standard: { contactsPerCandidate: 0.55, fastSeconds: 5, slowSeconds: 10, startupSeconds: 30 },
  deep: { contactsPerCandidate: 0.18, fastSeconds: 18, slowSeconds: 32, startupSeconds: 40 },
} as const;

export type ProspectingTimeEstimate = {
  expectedCandidates: number;
  minSeconds: number;
  maxSeconds: number;
};

export function estimateProspectingTime(input: { targetContacts: number; maxCandidates: number; searchMode?: "standard" | "deep" }): ProspectingTimeEstimate {
  const targetContacts = Math.max(1, Math.floor(input.targetContacts));
  const maxCandidates = Math.max(1, Math.floor(input.maxCandidates));
  const timing = TIMING[input.searchMode === "deep" ? "deep" : "standard"];
  const expectedCandidates = Math.min(
    maxCandidates,
    Math.max(1, Math.ceil(targetContacts / timing.contactsPerCandidate)),
  );

  return {
    expectedCandidates,
    minSeconds: Math.max(120, timing.startupSeconds + expectedCandidates * timing.fastSeconds),
    maxSeconds: Math.max(240, timing.startupSeconds + expectedCandidates * timing.slowSeconds),
  };
}

export function formatProspectingEstimate(estimate: ProspectingTimeEstimate) {
  const minMinutes = Math.max(1, Math.ceil(estimate.minSeconds / 60));
  const maxMinutes = Math.max(minMinutes, Math.ceil(estimate.maxSeconds / 60));
  if (maxMinutes < 60) return minMinutes === maxMinutes ? `около ${maxMinutes} мин` : `${minMinutes}–${maxMinutes} мин`;

  const minHours = Math.max(1, Math.round(minMinutes / 30) / 2);
  const maxHours = Math.max(minHours, Math.round(maxMinutes / 30) / 2);
  return minHours === maxHours ? `около ${formatHours(maxHours)} ч` : `${formatHours(minHours)}–${formatHours(maxHours)} ч`;
}

export function formatElapsedTime(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

function formatHours(value: number) {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1).replace(".", ",");
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
