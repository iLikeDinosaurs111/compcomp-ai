import { getCompetitionField } from "./matching.ts";

const MONTH_INDEX: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

const PAST_EVENT_PATTERNS = [
  /\bwas held\b/i,
  /\btook place\b/i,
  /\balready (?:closed|ended|passed)\b/i,
  /\bregistration (?:closed|has closed|ended)\b/i,
  /\bdeadline (?:was|passed|closed)\b/i,
  /\bwinners (?:announced|named)\b/i,
  /\bhappened (?:in|on)\b/i,
  /\bphotos,? video\b/i,
  /\bstudents? (?:won|win|wins|winning)\b/i,
];

const ONGOING_PATTERNS = [
  /\bregister(?:ation)?(?:\s+open|\s+now|\s+is open)?\b/i,
  /\bongoing\b/i,
  /\byear[- ]round\b/i,
  /\bannual\b/i,
  /\bopen to\b/i,
  /\beligibility\b/i,
];

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseMonthName(token: string): number | null {
  return MONTH_INDEX[token.toLowerCase().replace(/\./g, "")] ?? null;
}

function parseExplicitDates(text: string): Date[] {
  const dates: Date[] = [];
  const normalized = text.replace(/\s+/g, " ");

  for (const match of normalized.matchAll(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi,
  )) {
    const month = parseMonthName(match[1]);
    if (month !== null) {
      dates.push(new Date(Number(match[3]), month, Number(match[2])));
    }
  }

  for (const match of normalized.matchAll(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{4})\b/gi,
  )) {
    const month = parseMonthName(match[1]);
    if (month !== null) {
      dates.push(new Date(Number(match[2]), month, 1));
    }
  }

  for (const match of normalized.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    dates.push(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }

  return dates.filter((d) => !Number.isNaN(d.getTime()));
}

function parseMonthOnlyDeadline(text: string, now: Date): Date | null {
  const match = text.trim().match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\b/i,
  );
  if (!match) return null;

  const month = parseMonthName(match[1]);
  if (month === null) return null;

  const year = now.getMonth() > month ? now.getFullYear() + 1 : now.getFullYear();
  return new Date(year, month, 1);
}

export function inferTimeLabel(text: string, now = new Date()): string {
  const explicit = parseExplicitDates(text).filter((d) => d >= startOfDay(now));
  if (explicit.length) {
    explicit.sort((a, b) => a.getTime() - b.getTime());
    return explicit[0].toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }

  const monthOnly = parseMonthOnlyDeadline(text, now);
  if (monthOnly) {
    return monthOnly.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }

  return "";
}

export function getCompetitionScheduleText(comp: Record<string, unknown>): string {
  return [
    getCompetitionField(comp, ["time", "date", "deadline"]),
    getCompetitionField(comp, ["details", "description", "summary", "about"]),
    getCompetitionField(comp, ["name", "title"]),
  ].filter(Boolean).join(" ");
}

export function isCompetitionUpcoming(
  comp: Record<string, unknown>,
  now = new Date(),
): boolean {
  const scheduleText = getCompetitionScheduleText(comp);
  if (!scheduleText.trim()) return true;

  if (PAST_EVENT_PATTERNS.some((pattern) => pattern.test(scheduleText))) {
    return false;
  }

  const today = startOfDay(now);
  const explicitDates = parseExplicitDates(scheduleText);

  if (explicitDates.length) {
    const futureDates = explicitDates.filter((d) => startOfDay(d) >= today);
    const pastDates = explicitDates.filter((d) => startOfDay(d) < today);

    if (futureDates.length) return true;
    if (pastDates.length && !ONGOING_PATTERNS.some((pattern) => pattern.test(scheduleText))) {
      return false;
    }
  }

  const timeField = getCompetitionField(comp, ["time", "date", "deadline"]);
  if (timeField) {
    const monthDeadline = parseMonthOnlyDeadline(timeField, now);
    if (monthDeadline && startOfDay(monthDeadline) >= today) return true;

    const timeExplicit = parseExplicitDates(timeField);
    if (timeExplicit.some((d) => startOfDay(d) >= today)) return true;
    if (timeExplicit.some((d) => startOfDay(d) < today)) {
      return ONGOING_PATTERNS.some((pattern) => pattern.test(scheduleText));
    }
  }

  if (ONGOING_PATTERNS.some((pattern) => pattern.test(scheduleText))) {
    return true;
  }

  return explicitDates.length === 0;
}

export function toCompetitionDbRow(comp: Record<string, unknown>): Record<string, unknown> {
  const allowed = [
    "name", "details", "link", "image", "topic", "format",
    "location", "grade", "age", "source", "time",
  ] as const;

  const row: Record<string, unknown> = {};
  for (const key of allowed) {
    const value = comp[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      row[key] = value;
    }
  }
  return row;
}
