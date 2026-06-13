import { getCompetitionField } from "./matching.ts";

export interface GeminiFilterResult<T> {
  items: T[];
  applied: boolean;
  note: string;
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
): string {
  const today = formatToday();
  const topicStr = userTopics.filter((t) => t !== "Other").join(", ") || "any STEM topic";
  const numbered = lines
    .map(
      (item) =>
        `${item.index}. TITLE: ${item.title}\n   URL: ${item.url}\n   SCHEDULE: ${item.schedule || "not stated"}\n   TEXT: ${item.snippet.slice(0, 220)}`,
    )
    .join("\n\n");

  return `You are a STRICT filter for a high school competition finder app.
Today's date: ${today}
User selected topics: ${topicStr}

Your job: keep ONLY individual, real student competitions with OPEN or UPCOMING registration.

KEEP (index) ONLY when ALL are true:
- ONE specific named contest (USACO, FIRST Robotics, Science Olympiad, MATHCOUNTS, Technovation, CyberPatriot, etc.)
- Official registration/rules/eligibility page for THAT contest
- Student can still register OR the next cycle after ${today} is clearly upcoming
- NOT a list of many contests

REJECT (index) if ANY apply:
- Listicle, directory, roundup, "26 competitions", "competitions for high school", tables comparing many contests
- Forum, Q&A, thread, advice ("?", Career Village, Reddit, Quora, "how to find", "ways to find")
- News, blog, school announcement, live feed, social post, press release
- Results page, winners announced, past event recap
- Registration closed, deadline passed, season already ended, only past dates (2024/2025 ended) without open registration
- Vague event link with no named contest

When unsure → REJECT.

Items:
${numbered}

Respond with JSON only: {"keep":[0,2]} using the index numbers shown above, or {"keep":[]} if none qualify.`;
}

const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.0-flash-lite";
const MAX_GEMINI_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [0, 1500, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function geminiErrorNote(status: number, errText: string): string {
  if (status === 429) {
    return "Gemini rate limit (429) — wait ~60s and search again, or enable billing in Google AI Studio for higher limits.";
  }
  if (errText.includes("API key")) {
    return `Gemini API error (${status}). Check GEMINI_API_KEY.`;
  }
  return `Gemini API error (${status}).`;
}

async function callGeminiKeepIndices(
  prompt: string,
  apiKey: string,
  batchSize: number,
): Promise<{ keep: Set<number>; applied: boolean; note: string }> {
  let lastNote = "";

  for (let attempt = 0; attempt < MAX_GEMINI_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await sleep(RETRY_DELAYS_MS[attempt] ?? 4000);
    }

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

      if (response.status === 429 && attempt < MAX_GEMINI_ATTEMPTS - 1) {
        lastNote = geminiErrorNote(429, "");
        continue;
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        return {
          keep: new Set<number>(),
          applied: false,
          note: geminiErrorNote(response.status, errText),
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
      return { keep, applied: true, note: "" };
    } catch (error) {
      lastNote = `Gemini failed: ${error instanceof Error ? error.message : "unknown error"}`;
      if (attempt < MAX_GEMINI_ATTEMPTS - 1) continue;
    }
  }

  return {
    keep: new Set<number>(),
    applied: false,
    note: lastNote || geminiErrorNote(429, ""),
  };
}

export async function filterSearchResultsWithGemini(
  results: { title: string; url: string; snippet: string }[],
  apiKey: string,
  userTopics: string[],
): Promise<GeminiFilterResult<{ title: string; url: string; snippet: string }>> {
  if (!results.length || !apiKey) {
    return { items: results, applied: false, note: "" };
  }

  const batch = results.slice(0, 20);
  const lines: GeminiLineItem[] = batch.map((r, index) => ({
    index,
    title: r.title,
    url: r.url,
    schedule: "",
    snippet: r.snippet,
  }));

  const { keep, applied, note } = await callGeminiKeepIndices(
    buildFilterPrompt(lines, userTopics),
    apiKey,
    batch.length,
  );

  if (!applied) {
    return { items: [], applied: false, note };
  }

  return {
    items: batch.filter((_, index) => keep.has(index)),
    applied: true,
    note,
  };
}

export async function filterCompetitionsWithGemini(
  competitions: Record<string, unknown>[],
  apiKey: string,
  userTopics: string[],
): Promise<GeminiFilterResult<Record<string, unknown>>> {
  if (!competitions.length || !apiKey) {
    return { items: competitions, applied: false, note: "" };
  }

  const batch = competitions.slice(0, 15);
  const lines: GeminiLineItem[] = batch.map((comp, index) => ({
    index,
    title: getCompetitionField(comp, ["name", "title"]) || "Untitled",
    url: getCompetitionField(comp, ["link", "url"]),
    schedule: getCompetitionField(comp, ["time", "date", "deadline"]),
    snippet: getCompetitionField(comp, ["details", "description", "summary", "about"]),
  }));

  const { keep, applied, note } = await callGeminiKeepIndices(
    buildFilterPrompt(lines, userTopics),
    apiKey,
    batch.length,
  );

  if (!applied) {
    return { items: competitions, applied: false, note };
  }

  return {
    items: batch.filter((_, index) => keep.has(index)),
    applied: true,
    note,
  };
}
