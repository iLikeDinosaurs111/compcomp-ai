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

const MONTH_PATTERN =
  "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";

const PAST_EVENT_PATTERNS = [
  /\bwas held\b/i,
  /\btook place\b/i,
  /\balready (?:closed|ended|passed)\b/i,
  /\bregistration (?:closed|has closed|is closed|ended|is over)\b/i,
  /\bclosed registration\b/i,
  /\bno longer accepting\b/i,
  /\bdeadline (?:was|passed|closed|has passed)\b/i,
  /\bwinners (?:announced|named)\b/i,
  /\bhappened (?:in|on)\b/i,
  /\bphotos,? video\b/i,
  /\bstudents? (?:won|win|wins|winning)\b/i,
  /\bregister\s*:\s*closed\b/i,
  /\bregistration\s*:\s*closed\b/i,
];

const OPEN_REGISTRATION_PATTERNS = [
  /\bregistration\s+(?:is\s+)?open\b/i,
  /\bregister\s+now\b/i,
  /\bnow\s+(?:open|accepting)\b/i,
  /\baccepting\s+(?:applications|entries|registrations)\b/i,
  /\bcurrently\s+accepting\b/i,
];

const ROLLING_CYCLE_PATTERNS = [
  /\byear[- ]round\b/i,
  /\bannual\b/i,
  /\bopen to\b/i,
  /\beligibility\b/i,
  /\b20(?:2[6-9]|[3-9]\d)\b/,
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

function inferDeadlineYear(month: number, text: string, now: Date): number {
  const yearMatch = text.match(/\b(20\d{2})\b/);
  if (yearMatch) return Number(yearMatch[1]);

  const currentYear = now.getFullYear();
  if (now.getMonth() > month) return currentYear;
  return currentYear;
}

function parseDeadlineMentions(text: string, now: Date): Date[] {
  const deadlines: Date[] = [];
  const normalized = text.replace(/\s+/g, " ");
  const deadlineLead = new RegExp(
    `\\b(?:deadline|due|register by|registration by|closes|closing|until|by)\\s+(?:on\\s+)?(${MONTH_PATTERN})\\.?(?:\\s+(\\d{1,2}))?(?:,?\\s+(20\\d{2}))?\\b`,
    "gi",
  );
  const deadlineTrail = new RegExp(
    `\\b(${MONTH_PATTERN})\\.?(?:\\s+(\\d{1,2}))?(?:,?\\s+(20\\d{2}))?\\s*(?:deadline|due|registration)\\b`,
    "gi",
  );

  for (const pattern of [deadlineLead, deadlineTrail]) {
    for (const match of normalized.matchAll(pattern)) {
      const month = parseMonthName(match[1]);
      if (month === null) continue;
      const day = match[2] ? Number(match[2]) : 28;
      const year = match[3] ? Number(match[3]) : inferDeadlineYear(month, normalized, now);
      deadlines.push(new Date(year, month, day));
    }
  }

  return deadlines.filter((d) => !Number.isNaN(d.getTime()));
}

function parseMonthOnlyDeadline(text: string, now: Date): Date | null {
  const match = text.trim().match(
    new RegExp(`\\b(${MONTH_PATTERN})\\.?\\b`, "i"),
  );
  if (!match) return null;

  const month = parseMonthName(match[1]);
  if (month === null) return null;

  const year = inferDeadlineYear(month, text, now);
  return new Date(year, month, 28);
}

export function inferTimeLabel(text: string, now = new Date()): string {
  const explicit = parseExplicitDates(text).filter((d) => d >= startOfDay(now));
  if (explicit.length) {
    explicit.sort((a, b) => a.getTime() - b.getTime());
    return explicit[0].toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }

  const monthOnly = parseMonthOnlyDeadline(text, now);
  if (monthOnly && startOfDay(monthOnly) >= startOfDay(now)) {
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

export function isClosedScheduleText(text: string, now = new Date()): boolean {
  const scheduleText = String(text || "").trim();
  if (!scheduleText) return false;

  if (PAST_EVENT_PATTERNS.some((pattern) => pattern.test(scheduleText))) {
    return true;
  }

  const today = startOfDay(now);
  const explicitDates = parseExplicitDates(scheduleText);
  const deadlineDates = parseDeadlineMentions(scheduleText, now);
  const allDates = [...explicitDates, ...deadlineDates];

  if (allDates.length) {
    const futureDates = allDates.filter((d) => startOfDay(d) >= today);
    if (futureDates.length) return false;
    if (!OPEN_REGISTRATION_PATTERNS.some((pattern) => pattern.test(scheduleText))) {
      return true;
    }
  }

  const timeFieldMatch = scheduleText.match(
    new RegExp(`\\b(?:deadline|due|register by|registration by|closes|closing)\\b`, "i"),
  );
  if (timeFieldMatch) {
    const monthOnly = parseMonthOnlyDeadline(scheduleText, now);
    if (monthOnly && startOfDay(monthOnly) < today) {
      return !ROLLING_CYCLE_PATTERNS.some((pattern) => pattern.test(scheduleText));
    }
  }

  return false;
}

export function isCompetitionUpcoming(
  comp: Record<string, unknown>,
  now = new Date(),
): boolean {
  const scheduleText = getCompetitionScheduleText(comp);
  if (!scheduleText.trim()) return true;

  if (isClosedScheduleText(scheduleText, now)) {
    return false;
  }

  const today = startOfDay(now);
  const explicitDates = parseExplicitDates(scheduleText);
  const deadlineDates = parseDeadlineMentions(scheduleText, now);
  const allDates = [...explicitDates, ...deadlineDates];

  if (allDates.length) {
    if (allDates.some((d) => startOfDay(d) >= today)) return true;
    if (
      OPEN_REGISTRATION_PATTERNS.some((pattern) => pattern.test(scheduleText)) ||
      ROLLING_CYCLE_PATTERNS.some((pattern) => pattern.test(scheduleText))
    ) {
      return true;
    }
    return false;
  }

  const timeField = getCompetitionField(comp, ["time", "date", "deadline"]);
  if (timeField) {
    const monthDeadline = parseMonthOnlyDeadline(timeField, now);
    if (monthDeadline && startOfDay(monthDeadline) >= today) return true;

    const timeExplicit = parseExplicitDates(timeField);
    if (timeExplicit.some((d) => startOfDay(d) >= today)) return true;
    if (timeExplicit.some((d) => startOfDay(d) < today)) {
      return OPEN_REGISTRATION_PATTERNS.some((pattern) => pattern.test(scheduleText)) ||
        ROLLING_CYCLE_PATTERNS.some((pattern) => pattern.test(scheduleText));
    }
  }

  if (
    OPEN_REGISTRATION_PATTERNS.some((pattern) => pattern.test(scheduleText)) ||
    ROLLING_CYCLE_PATTERNS.some((pattern) => pattern.test(scheduleText))
  ) {
    return true;
  }

  return true;
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
