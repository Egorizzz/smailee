import type { CustomerDigestFrequency, LeadQualification } from "@prisma/client";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const MOSCOW_UTC_OFFSET_HOURS = 3;

function nextBoundary(now: Date, intervalMs: number) {
  return new Date((Math.floor(now.getTime() / intervalMs) + 1) * intervalMs);
}

export function nextTelegramGroupAt(now: Date, minutes: number) {
  const safeMinutes = [5, 15, 30].includes(minutes) ? minutes : 15;
  return nextBoundary(now, safeMinutes * MINUTE_MS);
}

export function nextDigestAt(
  now: Date,
  frequency: CustomerDigestFrequency,
  dailyHourMsk: number,
) {
  if (frequency === "EVERY_15_MINUTES") return nextBoundary(now, 15 * MINUTE_MS);
  if (frequency === "HOURLY") return nextBoundary(now, HOUR_MS);

  const safeHour = Number.isInteger(dailyHourMsk) && dailyHourMsk >= 0 && dailyHourMsk <= 23
    ? dailyHourMsk
    : 10;
  const utcHour = (safeHour - MOSCOW_UTC_OFFSET_HOURS + 24) % 24;
  const candidate = new Date(now);
  candidate.setUTCMinutes(0, 0, 0);
  candidate.setUTCHours(utcHour);
  if (candidate <= now) candidate.setUTCDate(candidate.getUTCDate() + 1);
  return candidate;
}

export function notificationCategoryForReply(
  previous: LeadQualification | null,
  current: LeadQualification | null,
) {
  return current === "HOT" && previous !== "HOT" ? "WARM_LEAD" as const : "REPLY" as const;
}
