import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  FormInputs,
  MAX_RESULTS,
  MIN_RESULTS,
  inferFormatFromText,
  inferTopicFromText,
  inferTopicsFromInputs,
  rankCompetitions,
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

async function searchBrave(query: string, apiKey: string): Promise<SearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "15");

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
  });

  if (!response.ok) {
    console.warn("Brave search failed:", response.status);
    return [];
  }

  const data = await response.json();
  const results = data?.web?.results ?? [];
  return results.map((r: { title?: string; url?: string; description?: string }) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.description ?? "",
  })).filter((r: SearchResult) => r.url && isCandidateUrl(r.url));
}

async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "CompCompAI/1.0 (competition discovery)" },
  });

  if (!response.ok) return [];

  const html = await response.text();
  const results: SearchResult[] = [];
  const resultPattern = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetPattern = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  let match;
  const links: { url: string; title: string }[] = [];
  while ((match = resultPattern.exec(html)) !== null) {
    const rawUrl = match[1];
    const title = match[2].replace(/<[^>]+>/g, "").trim();
    let finalUrl = rawUrl;
    if (rawUrl.includes("uddg=")) {
      try {
        const uddg = new URL(rawUrl, "https://duckduckgo.com").searchParams.get("uddg");
        if (uddg) finalUrl = decodeURIComponent(uddg);
      } catch { /* keep raw */ }
    }
    if (isCandidateUrl(finalUrl)) links.push({ url: finalUrl, title });
  }

  const snippets: string[] = [];
  while ((match = snippetPattern.exec(html)) !== null) {
    snippets.push(match[1].replace(/<[^>]+>/g, "").trim());
  }

  for (let i = 0; i < links.length && i < 15; i += 1) {
    results.push({
      title: links[i].title,
      url: links[i].url,
      snippet: snippets[i] ?? "",
    });
  }

  return results;
}

function extractMetaContent(html: string, property: string): string {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

async function fetchPageMeta(url: string): Promise<{ title: string; description: string; image: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "CompCompAI/1.0 (competition discovery)" },
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!response.ok) return { title: "", description: "", image: "" };

    const html = await response.text();
    const slice = html.slice(0, 50000);

    const title =
      extractMetaContent(slice, "og:title") ||
      extractMetaContent(slice, "twitter:title") ||
      (slice.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "");

    const description =
      extractMetaContent(slice, "og:description") ||
      extractMetaContent(slice, "twitter:description") ||
      extractMetaContent(slice, "description");

    let image =
      extractMetaContent(slice, "og:image") ||
      extractMetaContent(slice, "twitter:image");

    if (image && image.startsWith("/")) {
      try {
        image = new URL(image, url).href;
      } catch { /* ignore */ }
    }

    return { title, description, image };
  } catch {
    return { title: "", description: "", image: "" };
  }
}

function buildCompetitionFromSearchResult(
  result: SearchResult,
  meta: { title: string; description: string; image: string },
  inputs: FormInputs,
): Record<string, unknown> {
  const combinedText = `${result.title} ${result.snippet} ${meta.title} ${meta.description}`;
  const topic = inferTopicFromText(combinedText);
  const format = inputs.format || inferFormatFromText(combinedText);

  return {
    name: meta.title || result.title || "Competition",
    details: meta.description || result.snippet || "Student competition found online.",
    link: result.url,
    image: meta.image || "",
    topic,
    format,
    location: inputs.location || "",
    grade: inputs.grade ? `Grades ${inputs.grade}` : "",
    age: inputs.age || "",
    source: "web",
  };
}

function looksLikeCompetition(text: string): boolean {
  const normalized = text.toLowerCase();
  const signals = ["competition", "contest", "olympiad", "challenge", "tournament", "fair", "award", "prize"];
  return signals.some((s) => normalized.includes(s) || textMatchesKeyword(normalized, s));
}

async function discoverFromWeb(
  supabase: ReturnType<typeof createClient>,
  inputs: FormInputs,
  topics: string[],
  existingLinks: Set<string>,
  needed: number,
): Promise<Record<string, unknown>[]> {
  const query = buildSearchQuery(inputs, topics);
  const braveKey = Deno.env.get("BRAVE_SEARCH_API_KEY") ?? "";
  const searchResults = braveKey
    ? await searchBrave(query, braveKey)
    : await searchDuckDuckGo(query);

  const imported: Record<string, unknown>[] = [];

  for (const result of searchResults) {
    if (imported.length >= needed) break;
    if (existingLinks.has(result.url)) continue;

    const combined = `${result.title} ${result.snippet}`;
    if (!looksLikeCompetition(combined)) continue;

    const meta = await fetchPageMeta(result.url);
    const competition = buildCompetitionFromSearchResult(result, meta, inputs);

    const { error } = await supabase
      .from("competitions")
      .upsert(competition, { onConflict: "link", ignoreDuplicates: true });

    if (error) {
      const { error: insertError } = await supabase.from("competitions").insert(competition);
      if (insertError) {
        console.warn("Insert failed:", insertError.message);
        imported.push(competition);
        existingLinks.add(result.url);
        continue;
      }
    }

    imported.push(competition);
    existingLinks.add(result.url);
  }

  return imported;
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

    const { data: allCompetitions, error: fetchError } = await supabase
      .from("competitions")
      .select("*");

    if (fetchError) {
      return jsonResponse({ error: fetchError.message }, 500);
    }

    let scored = rankCompetitions(allCompetitions ?? [], inputs);
    let competitions = selectTopCompetitions(scored);
    let webSearchUsed = false;

    if (competitions.length < MIN_RESULTS) {
      webSearchUsed = true;
      const existingLinks = new Set(
        (allCompetitions ?? [])
          .map((c) => String(c.link ?? "").trim())
          .filter(Boolean),
      );

      const needed = MIN_RESULTS - competitions.length;
      const imported = await discoverFromWeb(
        supabase,
        inputs,
        topics,
        existingLinks,
        Math.max(needed, MIN_RESULTS),
      );

      if (imported.length) {
        const merged = [...(allCompetitions ?? []), ...imported];
        scored = rankCompetitions(merged, inputs);
        competitions = selectTopCompetitions(scored);
      }
    }

    competitions = competitions.slice(0, MAX_RESULTS);

    const displayTopics = inputs.selectedTopics.filter((t) => t !== "Other").length
      ? inputs.selectedTopics.filter((t) => t !== "Other")
      : topics;

    const bannerParts: string[] = [];

    if (competitions.length) {
      bannerParts.push(`Showing ${competitions.length} competition${competitions.length === 1 ? "" : "s"} for: ${displayTopics.join(", ") || "your interests"}.`);
    }

    if (inferredTopics.length) {
      bannerParts.push(`Inferred from your interests: ${inferredTopics.join(", ")}.`);
    }

    if (webSearchUsed && competitions.length >= MIN_RESULTS) {
      bannerParts.push("Some results were found online and added to our database.");
    }

    if (competitions.length < MIN_RESULTS) {
      bannerParts.push(
        `Only ${competitions.length} matching competition${competitions.length === 1 ? "" : "s"} found. Try broadening your topics or location.`,
      );
    }

    return jsonResponse({
      competitions,
      topics: displayTopics,
      inferredTopics,
      hasExactMatches: competitions.length > 0,
      webSearchUsed,
      banner: bannerParts.join(" "),
      sourceCounts: {
        database: competitions.filter((c) => (c.source ?? "manual") !== "web").length,
        web: competitions.filter((c) => c.source === "web").length,
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
