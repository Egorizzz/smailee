const LOCAL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** Formats one stable server snapshot for a datetime-local control. */
export function formatCampaignLocalDateTime(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = String(Number(value("hour")) % 24).padStart(2, "0");
  return `${value("year")}-${value("month")}-${value("day")}T${hour}:${value("minute")}`;
}

export function campaignTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const local = formatCampaignLocalDateTime(date, timeZone);
  const match = LOCAL_DATETIME_RE.exec(local);
  if (!match) return 0;
  const [, year, month, day, hour, minute] = match;
  const zonedAsUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  return Math.round((date.getTime() - zonedAsUtc) / 60_000);
}

/**
 * Converts browser-local datetime-local input to an instant. The browser sends
 * getTimezoneOffset(), so production server TZ cannot silently shift a launch.
 */
export function parseCampaignScheduledAt(raw: string, rawOffsetMinutes: string | number): Date | null {
  const match = LOCAL_DATETIME_RE.exec(raw.trim());
  const offsetMinutes = Number(rawOffsetMinutes);
  if (!match || !Number.isFinite(offsetMinutes) || Math.abs(offsetMinutes) > 14 * 60) return null;
  const [, year, month, day, hour, minute] = match;
  const parts = [year, month, day, hour, minute].map(Number);
  const [yearNumber, monthNumber, dayNumber, hourNumber, minuteNumber] = parts;
  const localTimestamp = Date.UTC(yearNumber, monthNumber - 1, dayNumber, hourNumber, minuteNumber);
  const normalized = new Date(localTimestamp);
  if (
    normalized.getUTCFullYear() !== yearNumber
    || normalized.getUTCMonth() !== monthNumber - 1
    || normalized.getUTCDate() !== dayNumber
    || normalized.getUTCHours() !== hourNumber
    || normalized.getUTCMinutes() !== minuteNumber
  ) return null;
  const timestamp = localTimestamp + offsetMinutes * 60_000;
  const result = new Date(timestamp);
  return Number.isNaN(result.getTime()) ? null : result;
}
