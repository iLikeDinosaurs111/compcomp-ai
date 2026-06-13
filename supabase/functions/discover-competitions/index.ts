import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  FormInputs,
  MAX_RESULTS,
  TARGET_RESULTS,
  getCompetitionId,
  getUserSearchTopics,
  inferBestTopicForUser,
  inferFormatFromText,
  inferTopicsFromInputs,
  locationMatchesUser,
  rankCompetitions,
  scoreFormat,
  selectTopCompetitions,
  textMatchesKeyword,
} from "../_shared/matching.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SKIP_DOMAINS = [
  "facebook.com", "twitter.com", "x.com", "instagram.com", "youtube.com",
  "linkedin.com", "reddit.com", "pinterest.com", "tiktok.com",
  "wikipedia.org", "amazon.com", "ebay.com",
];

const BLOCKED_PATH_PATTERNS = ["/news/", "/blog/", "/article/", "/jobs/", "/careers/"];

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseInputs(body: Record<string, unknown>): FormInputs | null {
  const selectedTopics = Array.isArray(body.selectedTopics)
    ? body.selectedTopics.map(String)
    : [];

  if (!selectedTopics.length && !String(body.otherText ?? "").trim()) {
    return null;
  }

  return {
    age: String(body.age ?? "").trim(),
    grade: String(body.grade ?? "").trim(),
    location: String(body.location ?? "").trim(),
    format: String(body.format ?? "").trim(),
    selectedTopics,
    otherText: String(body.otherText ?? "").trim(),
  };
}

function buildSearchQuery(inputs: FormInputs, topics: string[]): string {
  const parts = ["student competition", "high school", "youth"];
  const topicLabels = topics.filter((t) => t !== "Other" && t !== "Finance");
  if (topicLabels.length) parts.push(topicLabels.join(" "));
  if (inputs.otherText) parts.push(inputs.otherText);
  if (inputs.grade) parts.push(`grade ${inputs.grade}`);
  if (inputs.location) parts.push(inputs.location);
  if (inputs.format === "online") parts.push("online virtual");
  if (inputs.format === "in-person") parts.push("in-person local");
  return parts.join(" ");
}

function isCandidateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    if (SKIP_DOMAINS.some((d) => host.includes(d))) return false;
    const path = parsed.pathname.toLowerCase();
    if (BLOCKED_PATH_PATTERNS.some((p) => path.includes(p))) return false;
    return true;
  } catch {
    return false;
  }
}

async function searchBing(query: string): Promise<SearchResult[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=20`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!response.ok) return [];

  const html = await response.text();
  const results: SearchResult[] = [];

  const patterns = [
    /<li class="b_algo"[\s\S]*?<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/gi,
    /<a href="(https?:\/\/[^"]+)"[^>]*><h2[^>]*>([\s\S]*?)<\/h2><\/a>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null && results.length < 25) {
      const rawUrl = match[1];
      const title = match[2].replace(/<[^>]+>/g, "").trim();
      const snippet = (match[3] ?? "").replace(/<[^>]+>/g, "").trim();
      if (rawUrl.startsWith("http") && isCandidateUrl(rawUrl) && title.length > 3) {
        results.push({ title, url: rawUrl, snippet });
      }
    }
    if (results.length) break;
  }

  return results;
}

async function searchBrave(query: string, apiKey: string): Promise<SearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "20");

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
  });

  if (!response.ok) return [];

  const data = await response.json();
  const results = data?.web?.results ?? [];
  return results.map((r: { title?: string; url?: string; description?: string }) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.description ?? "",
  })).filter((r: SearchResult) => r.url && isCandidateUrl(r.url));
}

async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; CompCompAI/1.0)" },
  });

  if (!response.ok) return [];

  const html = await response.text();
  const results: SearchResult[] = [];
  const linkPattern = /<a rel="nofollow" class="result-link" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetPattern = /<td class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

  const links: { url: string; title: string }[] = [];
  let match;
  while ((match = linkPattern.exec(html)) !== null) {
    links.push({ url: match[1], title: match[2].replace(/<[^>]+>/g, "").trim() });
  }

  const snippets: string[] = [];
  while ((match = snippetPattern.exec(html)) !== null) {
    snippets.push(match[1].replace(/<[^>]+>/g, "").trim());
  }

  for (let i = 0; i < links.length && i < 25; i += 1) {
    if (isCandidateUrl(links[i].url)) {
      results.push({ title: links[i].title, url: links[i].url, snippet: snippets[i] ?? "" });
    }
  }

  return results;
}

async function runWebSearch(query: string): Promise<SearchResult[]> {
  const braveKey = Deno.env.get("BRAVE_SEARCH_API_KEY") ?? "";
  if (braveKey) {
    const braveResults = await searchBrave(query, braveKey);
    if (braveResults.length) return braveResults;
  }

  const bingResults = await searchBing(query);
  if (bingResults.length) return bingResults;

  return searchDuckDuckGo(query);
}

function looksLikeCompetition(text: string): boolean {
  const normalized = text.toLowerCase();
  const signals = [
    "competition", "contest", "olympiad", "challenge", "tournament", "fair",
    "award", "prize", "scholarship", "talent search", "championship",
  ];
  return signals.some((s) => normalized.includes(s) || textMatchesKeyword(normalized, s));
}

function buildCompetitionFromSearchResult(
  result: SearchResult,
  inputs: FormInputs,
  userTopics: string[],
): Record<string, unknown> | null {
  const combinedText = `${result.title} ${result.snippet}`;
  const matchedTopic = inferBestTopicForUser(combinedText, userTopics);

  if (!matchedTopic && userTopics.length > 0 && !userTopics.includes("Other")) {
    return null;
  }

  const topic = matchedTopic ?? userTopics[0] ?? "Science";
  const format = inputs.format || inferFormatFromText(combinedText);

  return {
    name: result.title || "Competition",
    details: result.snippet || "Student competition found online.",
    link: result.url,
    image: "",
    topic,
    format,
    location: inputs.location || "",
    grade: inputs.grade ? `Grades ${inputs.grade}` : "",
    age: inputs.age || "",
    source: "web",
    _matchedTopics: [topic],
  };
}

async function discoverFromWeb(
  supabase: ReturnType<typeof createClient>,
  inputs: FormInputs,
  userTopics: string[],
  existingLinks: Set<string>,
  maxCount: number,
): Promise<{ imported: Record<string, unknown>[]; searchHits: number; errors: string[] }> {
  const queries = [
    buildSearchQuery(inputs, userTopics),
    `${userTopics.join(" ")} student competition ${inputs.location}`.trim(),
    `${userTopics.join(" ")} high school contest ${inputs.grade ? `grade ${inputs.grade}` : ""}`.trim(),
    `youth ${userTopics[0] ?? "STEM"} olympiad competition`,
  ];
  const uniqueQueries = [...new Set(queries.filter(Boolean))];
  const errors: string[] = [];

  const allSearchResults: SearchResult[] = [];
  const seenUrls = new Set<string>();

  for (const query of uniqueQueries) {
    try {
      const batch = await runWebSearch(query);
      for (const result of batch) {
        if (!seenUrls.has(result.url)) {
          seenUrls.add(result.url);
          allSearchResults.push(result);
        }
      }
    } catch (error) {
      errors.push(String(error));
    }
    if (allSearchResults.length >= 50) break;
  }

  const imported: Record<string, unknown>[] = [];

  for (const result of allSearchResults) {
    if (imported.length >= maxCount) break;
    if (existingLinks.has(result.url)) continue;

    const combined = `${result.title} ${result.snippet}`;
    if (!looksLikeCompetition(combined)) continue;

    const competition = buildCompetitionFromSearchResult(result, inputs, userTopics);
    if (!competition) continue;

    if (inputs.format && scoreFormat(competition, inputs.format) === 0) continue;
    if (inputs.location && !locationMatchesUser(competition, inputs.location, inputs.format)) continue;

    const { error } = await supabase.from("competitions").insert(competition);
    if (error && !String(error.message).toLowerCase().includes("duplicate")) {
      errors.push(error.message);
    }

    imported.push(competition);
    existingLinks.add(result.url);
  }

  return { imported, searchHits: allSearchResults.length, errors };
}

function mergeWebFirstThenDb(
  webResults: Record<string, unknown>[],
  dbResults: Record<string, unknown>[],
): Record<string, unknown>[] {
  const merged: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const comp of webResults) {
    const id = getCompetitionId(comp);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(comp);
  }

  for (const comp of dbResults) {
    if (merged.length >= TARGET_RESULTS) break;
    const id = getCompetitionId(comp);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(comp);
  }

  return merged.slice(0, MAX_RESULTS);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json();
    const inputs = parseInputs(body);

    if (!inputs) {
      return jsonResponse({ error: "Select at least one topic or describe your interests." }, 400);
    }

    if (inputs.selectedTopics.includes("Other") && !inputs.otherText) {
      return jsonResponse({ error: "You selected Other — describe what you're looking for." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({ error: "Server configuration error." }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { topics, inferredTopics } = inferTopicsFromInputs(inputs);
    const userTopics = getUserSearchTopics(inputs);

    const { data: allCompetitions, error: fetchError } = await supabase
      .from("competitions")
      .select("*");

    if (fetchError) {
      return jsonResponse({ error: fetchError.message }, 500);
    }

    const existingLinks = new Set(
      (allCompetitions ?? []).map((c) => String(c.link ?? "").trim()).filter(Boolean),
    );

    // STEP 1: Web search FIRST (always)
    const { imported: webResults, searchHits, errors: webErrors } = await discoverFromWeb(
      supabase,
      inputs,
      userTopics,
      existingLinks,
      TARGET_RESULTS,
    );

    // STEP 2: Database matches (strict topic filter)
    const dbResults = selectTopCompetitions(rankCompetitions(allCompetitions ?? [], inputs));

    // STEP 3: Merge — web results appear first, DB fills the rest
    const competitions = mergeWebFirstThenDb(webResults, dbResults);

    const webCount = competitions.filter((c) => c.source === "web").length;
    const displayTopics = inputs.selectedTopics.filter((t) => t !== "Other").length
      ? inputs.selectedTopics.filter((t) => t !== "Other")
      : topics;

    const bannerParts: string[] = [];

    if (competitions.length) {
      bannerParts.push(`Showing ${competitions.length} competition${competitions.length === 1 ? "" : "s"}.`);
    }

    if (webCount > 0) {
      bannerParts.push(`${webCount} found online (shown first).`);
    } else if (searchHits === 0) {
      bannerParts.push("Web search returned no results — add BRAVE_SEARCH_API_KEY in Supabase for better search.");
    } else {
      bannerParts.push("Web search ran but no new online matches passed filters.");
    }

    if (inferredTopics.length) {
      bannerParts.push(`Inferred from your interests: ${inferredTopics.join(", ")}.`);
    }

    if (competitions.length < TARGET_RESULTS) {
      bannerParts.push(`Only ${competitions.length} total matches — try broadening location or topics.`);
    }

    return jsonResponse({
      competitions,
      topics: displayTopics,
      inferredTopics,
      hasExactMatches: competitions.length > 0,
      webSearchUsed: true,
      webImportCount: webCount,
      webSearchHits: searchHits,
      webErrors,
      banner: bannerParts.join(" "),
      sourceCounts: {
        database: competitions.filter((c) => (c.source ?? "manual") !== "web").length,
        web: webCount,
      },
    });
  } catch (error) {
    console.error("discover-competitions error:", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unexpected server error." },
      500,
    );
  }
});
