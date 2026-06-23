import { getCompetitionField } from "./matching.ts";

export interface GeminiFilterResult<T> {
  items: T[];
  applied: boolean;
  note: string;
  rateLimited: boolean;
}

interface GeminiLineItem {
  index: number;
  title: string;
  url: string;
  schedule: string;
  snippet: string;
}

function formatToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildFilterPrompt(
  lines: GeminiLineItem[],
  userTopics: string[],
  searchQuery = "",
): string {
  const today = formatToday();
  const topicStr = userTopics.filter((t) => t !== "Other").join(", ") || "any STEM topic";
  const searchLine = searchQuery.trim()
    ? `User searched for: "${searchQuery.trim()}". KEEP official pages that match this name (e.g. program site, registration page, Devpost).`
    : "KEEP up to 10 real student competitions with open or upcoming registration.";
  const numbered = lines
    .map(
      (item) =>
        `${item.index}. ${item.title}\n   ${item.url}\n   ${item.schedule || "no date"} | ${item.snippet.slice(0, 120)}`,
    )
    .join("\n");

  return `Strict filter for high school competitions. Today: ${today}. Topics: ${topicStr}.
${searchLine}

KEEP: official competition/program pages, registration pages, Devpost events, trusted org sites.
REJECT: listicles ("top N", "best competitions"), forums/Q&A, news articles, Spotify/books/media, closed/past events.

${numbered}

JSON only: {"keep":[0,1,2]} — include every index that is a real competition page (up to 10). Use {"keep":[]} only if none qualify.`;
}

const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.0-flash-lite";

async function callGeminiKeepIndices(
  prompt: string,
  apiKey: string,
  batchSize: number,
): Promise<{ keep: Set<number>; applied: boolean; note: string; rateLimited: boolean }> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 256,
            responseMimeType: "application/json",
            responseSchema: {
              type: "object",
              properties: {
                keep: {
                  type: "array",
                  items: { type: "integer" },
                },
              },
              required: ["keep"],
            },
          },
        }),
      },
    );

    if (response.status === 429) {
      return {
        keep: new Set<number>(),
        applied: false,
        note: "",
        rateLimited: true,
      };
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return {
        keep: new Set<number>(),
        applied: false,
        note: errText.includes("API key")
          ? `Gemini API error (${response.status}). Check GEMINI_API_KEY.`
          : `Gemini API error (${response.status}).`,
        rateLimited: false,
      };
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    let parsed: { keep?: number[] } = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    }

    const keep = new Set(
      (parsed.keep ?? []).filter((n) => Number.isInteger(n) && n >= 0 && n < batchSize),
    );
    return { keep, applied: true, note: "", rateLimited: false };
  } catch (error) {
    return {
      keep: new Set<number>(),
      applied: false,
      note: `Gemini failed: ${error instanceof Error ? error.message : "unknown error"}`,
      rateLimited: false,
    };
  }
}

export async function filterCompetitionsWithGemini(
  competitions: Record<string, unknown>[],
  apiKey: string,
  userTopics: string[],
  searchQuery = "",
): Promise<GeminiFilterResult<Record<string, unknown>>> {
  if (!competitions.length || !apiKey) {
    return { items: competitions, applied: false, note: "", rateLimited: false };
  }

  const batch = competitions.slice(0, 10);
  const lines: GeminiLineItem[] = batch.map((comp, index) => ({
    index,
    title: getCompetitionField(comp, ["name", "title"]) || "Untitled",
    url: getCompetitionField(comp, ["link", "url"]),
    schedule: getCompetitionField(comp, ["time", "date", "deadline"]),
    snippet: getCompetitionField(comp, ["details", "description", "summary", "about"]),
  }));

  const { keep, applied, note, rateLimited } = await callGeminiKeepIndices(
    buildFilterPrompt(lines, userTopics, searchQuery),
    apiKey,
    batch.length,
  );

  if (rateLimited) {
    return { items: competitions, applied: false, note: "", rateLimited: true };
  }

  if (!applied) {
    return { items: competitions, applied: false, note, rateLimited: false };
  }

  if (keep.size === 0) {
    return { items: competitions, applied: true, note: "Gemini rejected all — kept rule-filtered results.", rateLimited: false };
  }

  return {
    items: batch.filter((_, index) => keep.has(index)),
    applied: true,
    note,
    rateLimited: false,
  };
}
