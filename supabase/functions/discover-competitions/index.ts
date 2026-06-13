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
  normalizeCompetitionLink,
  rankCompetitions,
  textMatchesKeyword,
  dedupeCompetitionRows,
  buildProfileSeed,
  sortScoredWithProfileVariety,
  inferCompetitionLocation,
  refreshWebRowMetadata,
} from "../_shared/matching.ts";
import {
  inferTimeLabel,
  isCompetitionUpcoming,
  toCompetitionDbRow,
} from "../_shared/dates.ts";
import { ImageAllocator } from "../_shared/images.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SKIP_DOMAINS = [
  "facebook.com", "twitter.com", "x.com", "instagram.com", "youtube.com",
  "linkedin.com", "reddit.com", "pinterest.com", "tiktok.com",
  "wikipedia.org", "amazon.com", "ebay.com",
  "quora.com", "medium.com", "prepory.com", "thoughtco.com", "wikihow.com",
  "answers.com", "yahoo.com", "buzzfeed.com", "student-tutor.com",
  "collegexpress.com", "prepscholar.com", "niche.com", "usnews.com",
  "patch.com", "tapinto.net", "nj.com", "courierpostonline.com",
  "northjersey.com", "app.com", "mycentraljersey.com",
];

const BLOCKED_PATH_PATTERNS = [
  "/news/", "/blog/", "/article/", "/jobs/", "/careers/",
  "/posts/", "/stories/", "/guides/", "/list/", "/roundup/",
  "/photos/", "/video/", "/media/", "/press/", "/announcements/",
];

const LISTICLE_TITLE_PATTERNS = [
  /\b(top|best)\s+\d+\b/i,
  /\d+\s+(best|top|great|greatest|must[- ]try|amazing)\b/i,
  /\b(list of|roundup|ranked|ultimate guide|compared)\b/i,
  /\bwhat are (some|the best)\b/i,
  /\b(top|best)\s+\d+\s+\w+\s+compet/i,
  /\bcompetitions for (high school|students)\b/i,
  /\?\s*-\s*quora\b/i,
  /\bsummer programs?\b/i,
  /\bapplying to college\b/i,
];

const NEWS_AND_JUNK_PATTERNS = [
  /\b(photos?,? video|video:?|local news|press release)\b/i,
  /\b(students? (win|won|wins|winning|show off|celebrate))\b/i,
  /\b\[pdf\]\b/i,
  /\.pdf(\?|#|$)/i,
  /\b(school district|board of education)\b/i,
  /\|\s*[^|]+\s+high school\s*$/i,
  /\b(campus news|student news|weekly update)\b/i,
];

const KNOWN_COMPETITION_SIGNALS = [
  /\bscience bowl\b/i,
  /\bmathcounts\b/i,
  /\b(amc|aime|usamo|usajmo)\b/i,
  /\b(isef|regeneron sts|science olympiad|physics olympiad|usaco)\b/i,
  /\b(deca|hosa|fbla|nhd|national history day)\b/i,
  /\b(olympiad|contest information|competition information)\b/i,
  /\b(register|registration|apply|eligibility|rules and guidelines)\b/i,
];

const DB_PREFERRED_COUNT = 5;
const MAX_CURATED_DB_SLOTS = 4;
const MAX_CACHED_WEB_SLOTS = 3;
const MAX_SERPER_QUERIES = 2;
const MAX_WEB_PERSIST = 20;
const SERPER_RESULTS_PER_QUERY = 10;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  image?: string;
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

function buildSearchQuery(inputs: FormInputs, topics: string[], official = false): string {
  const parts = official
    ? ["official", "student competition", "register", "apply", "national"]
    : ["student competition", "high school", "national", "official"];
  const topicLabels = topics.filter((t) => t !== "Other" && t !== "Finance");
  if (topicLabels.length) parts.push(topicLabels.join(" "));
  if (inputs.otherText) parts.push(inputs.otherText);
  if (inputs.grade) parts.push(`grade ${inputs.grade}`);
  if (inputs.location) parts.push(inputs.location);
  if (inputs.format === "online") parts.push("online virtual");
  if (inputs.format === "in-person") parts.push("in-person");
  const negatives = '-news -quora -reddit -"top 10" -"top 9" -"best " -blog -list -medium -photos -video -pdf -"summer program"';
  return `${parts.join(" ")} ${negatives}`.trim();
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

async function searchSerper(query: string, apiKey: string): Promise<SearchResult[]> {
  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({ q: query, num: SERPER_RESULTS_PER_QUERY }),
  });

  if (!response.ok) return [];

  const data = await response.json();
  const results = data?.organic ?? [];
  return results
    .map((r: { title?: string; link?: string; snippet?: string; imageUrl?: string }) => ({
      title: r.title ?? "",
      url: r.link ?? "",
      snippet: r.snippet ?? "",
      image: r.imageUrl ?? "",
    }))
    .filter((r: SearchResult) => r.url && isCandidateUrl(r.url));
}

function isRejectedResult(result: SearchResult): boolean {
  const title = result.title.toLowerCase();
  const combined = `${result.title} ${result.snippet}`.toLowerCase();

  if (LISTICLE_TITLE_PATTERNS.some((pattern) => pattern.test(combined))) {
    return true;
  }

  if (NEWS_AND_JUNK_PATTERNS.some((pattern) => pattern.test(combined))) {
    return true;
  }

  try {
    const parsed = new URL(result.url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    if (SKIP_DOMAINS.some((d) => host.includes(d))) return true;
    if (path.endsWith(".pdf")) return true;

    if (
      (host.includes(".k12.") || host.includes("schools.") || /highschool|high-school|\.k12\./.test(host)) &&
      !path.includes("competition") &&
      !path.includes("contest") &&
      !KNOWN_COMPETITION_SIGNALS.some((s) => s.test(combined))
    ) {
      return true;
    }
  } catch {
    return true;
  }

  if (/\b(top|best)\b/.test(title) && /\d+/.test(title)) return true;

  return false;
}

function isOfficialCompetitionResult(result: SearchResult): boolean {
  if (isRejectedResult(result)) return false;

  const combined = `${result.title} ${result.snippet}`;
  if (!looksLikeCompetition(combined.toLowerCase())) return false;

  if (KNOWN_COMPETITION_SIGNALS.some((pattern) => pattern.test(combined))) {
    return true;
  }

  try {
    const parsed = new URL(result.url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    if (host.endsWith(".gov")) return true;

    if (host.endsWith(".org") || host.endsWith(".edu")) {
      if (
        path.includes("competition") ||
        path.includes("contest") ||
        path.includes("olympiad") ||
        path.includes("register")
      ) {
        return true;
      }
    }

    if (
      host.includes("competition") ||
      host.includes("contest") ||
      host.includes("olympiad") ||
      host.includes("mathcounts") ||
      host.includes("sciencebowl")
    ) {
      return true;
    }
  } catch {
    return false;
  }

  return /\b(official|register|registration|eligibility|annual competition)\b/i.test(combined);
}

async function filterWithGemini(results: SearchResult[], apiKey: string): Promise<SearchResult[]> {
  if (!results.length) return [];

  const batch = results.slice(0, 25);
  const numbered = batch
    .map((r, i) => `${i}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet.slice(0, 140)}`)
    .join("\n\n");

  const prompt = `You filter search results for a high school competition finder app.

KEEP only official competition pages a student can enter (registration, rules, eligibility, official org homepage for a named contest like Science Bowl or MATHCOUNTS).

REJECT: news articles, photos/video stories, school win announcements, listicles ("top 10"), summer program roundups, college admissions blogs, PDFs, Quora, generic school homepages, local news.

Results:
${numbered}

Reply with ONLY JSON like {"keep":[0,2,5]} — indices to keep. If none qualify, {"keep":[]}.`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 256 },
        }),
      },
    );

    if (!response.ok) {
      return batch.filter(isOfficialCompetitionResult);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return batch.filter(isOfficialCompetitionResult);

    const parsed = JSON.parse(jsonMatch[0]) as { keep?: number[] };
    const keep = new Set((parsed.keep ?? []).filter((n) => Number.isInteger(n)));
    if (!keep.size) return [];
    return batch.filter((_, index) => keep.has(index));
  } catch {
    return batch.filter(isOfficialCompetitionResult);
  }
}

function faviconForUrl(pageUrl: string): string {
  try {
    const host = new URL(pageUrl).hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
  } catch {
    return "";
  }
}

function isSafeImageUrl(imageUrl: string, pageUrl: string): boolean {
  try {
    const parsed = new URL(imageUrl, pageUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function assignCompetitionImage(
  comp: Record<string, unknown>,
  allocator: ImageAllocator,
): Record<string, unknown> {
  const name = String(comp.name ?? comp.title ?? "Competition");
  const topic = String(comp.topic ?? "Science");
  const link = String(comp.link ?? comp.url ?? "");
  const existing = String(comp.image ?? "").trim();
  const favicon = link ? faviconForUrl(link) : "";
  const image = allocator.assign(existing || favicon, name, topic, link);
  return { ...comp, image };
}

function scoreSearchResult(result: SearchResult): number {
  if (isRejectedResult(result)) return -100;
  if (!isOfficialCompetitionResult(result)) return -50;

  let score = 0;
  const combined = `${result.title} ${result.snippet}`.toLowerCase();

  if (looksLikeCompetition(combined)) score += 5;

  try {
    const parsed = new URL(result.url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    if (host.endsWith(".org") || host.endsWith(".edu")) score += 3;
    if (path === "/" || path.endsWith("/home") || path.includes("competition") || path.includes("contest")) {
      score += 2;
    }
    if (host.includes("competition") || host.includes("contest") || host.includes("olympiad")) {
      score += 2;
    }
  } catch {
    score -= 5;
  }

  if (/\b(register|registration|apply|deadline|eligibility)\b/i.test(combined)) {
    score += 2;
  }

  return score;
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
  const serperKey = Deno.env.get("SERPER_API_KEY") ?? "";
  if (serperKey) {
    const serperResults = await searchSerper(query, serperKey);
    if (serperResults.length) return serperResults;
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
  imageUrl: string,
  strictTopic = true,
): Record<string, unknown> | null {
  const combinedText = `${result.title} ${result.snippet}`;
  let topic = inferBestTopicForUser(combinedText, userTopics);

  if (!topic && strictTopic && userTopics.length > 0 && !userTopics.includes("Other")) {
    return null;
  }

  topic = topic ?? userTopics[0] ?? "Science";
  const format = inputs.format || inferFormatFromText(combinedText) || "online";
  const time = inferTimeLabel(combinedText);

  const competition = {
    name: result.title || "Competition",
    details: result.snippet || "Student competition found online.",
    link: result.url,
    image: imageUrl,
    topic,
    format,
    location: inferCompetitionLocation(result.title, result.snippet, result.url, inputs.location),
    grade: inputs.grade ? `Grades ${inputs.grade}` : "",
    age: inputs.age || "",
    source: "web",
    ...(time ? { time } : {}),
    _matchedTopics: [topic],
  };

  if (!isCompetitionUpcoming(competition)) return null;

  return competition;
}

function isUsableSearchResult(result: SearchResult): boolean {
  if (!result.url || !result.title || result.title.length < 4) return false;
  if (!isCandidateUrl(result.url)) return false;
  return isOfficialCompetitionResult(result);
}

function competitionRecordToSearchResult(comp: Record<string, unknown>): SearchResult {
  return {
    title: String(comp.name ?? comp.title ?? ""),
    url: String(comp.link ?? comp.url ?? ""),
    snippet: String(comp.details ?? comp.snippet ?? ""),
    image: String(comp.image ?? comp.image_url ?? ""),
  };
}

function isRejectedCompetitionRecord(comp: Record<string, unknown>): boolean {
  if (isRejectedResult(competitionRecordToSearchResult(comp))) return true;
  return !isCompetitionUpcoming(comp);
}

async function discoverFromWeb(
  supabase: ReturnType<typeof createClient>,
  inputs: FormInputs,
  userTopics: string[],
  existingLinks: Set<string>,
  maxDisplay: number,
  imageAllocator: ImageAllocator,
): Promise<{
  imported: Record<string, unknown>[];
  newWebCount: number;
  searchHits: number;
  serperQueries: number;
  errors: string[];
}> {
  if (maxDisplay <= 0) {
    return { imported: [], newWebCount: 0, searchHits: 0, serperQueries: 0, errors: [] };
  }

  const existingAtStart = new Set(existingLinks);

  const topicLabel = userTopics.filter((t) => t !== "Other" && t !== "Finance").join(" ");
  const queries = [
    buildSearchQuery(inputs, userTopics, true),
    `${topicLabel} olympiad registration site:.org ${inputs.location}`.trim(),
    `${inputs.grade} ${topicLabel} contest registration high school official`.trim(),
  ].slice(0, MAX_SERPER_QUERIES);
  const uniqueQueries = [...new Set(queries.filter(Boolean))];
  const errors: string[] = [];

  const allSearchResults: SearchResult[] = [];
  const seenUrls = new Set<string>();
  let serperQueries = 0;

  for (const query of uniqueQueries) {
    try {
      const serperKey = Deno.env.get("SERPER_API_KEY") ?? "";
      if (serperKey) serperQueries += 1;

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

    const goodCount = allSearchResults.filter(isOfficialCompetitionResult).length;
    const newUrlCount = allSearchResults.filter(
      (result) => !existingAtStart.has(normalizeCompetitionLink(result.url)),
    ).length;

    if (goodCount >= MAX_WEB_PERSIST || newUrlCount >= maxDisplay) break;
    if (serperQueries >= 1 && newUrlCount === 0 && allSearchResults.length > 0) break;
  }

  let rankedResults = [...allSearchResults]
    .filter(isOfficialCompetitionResult)
    .sort((a, b) => scoreSearchResult(b) - scoreSearchResult(a));

  const geminiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
  if (geminiKey && rankedResults.length) {
    rankedResults = await filterWithGemini(rankedResults, geminiKey);
  }

  const displayResults: Record<string, unknown>[] = [];
  const importedLinks = new Set<string>();
  let persisted = 0;
  let newWebCount = 0;

  for (const result of rankedResults) {
    if (displayResults.length >= maxDisplay && persisted >= MAX_WEB_PERSIST) break;

    const normalizedUrl = normalizeCompetitionLink(result.url);
    if (importedLinks.has(normalizedUrl)) continue;
    if (!isUsableSearchResult(result)) continue;

    const imageUrl = result.image && isSafeImageUrl(result.image, result.url)
      ? result.image
      : faviconForUrl(result.url);
    const competition = buildCompetitionFromSearchResult(
      result,
      inputs,
      userTopics,
      imageUrl,
      true,
    );
    if (!competition) continue;

    const withUniqueImage = assignCompetitionImage(competition, imageAllocator);

    const isNewLink = !existingAtStart.has(normalizedUrl);
    importedLinks.add(normalizedUrl);
    persisted += 1;

    const dbRow = toCompetitionDbRow(withUniqueImage);

    if (isNewLink) {
      const { error } = await supabase.from("competitions").insert(dbRow);
      if (error && !String(error.message).toLowerCase().includes("duplicate")) {
        errors.push(error.message);
      } else {
        existingLinks.add(normalizedUrl);
      }
    } else {
      const { error } = await supabase
        .from("competitions")
        .update({
          image: dbRow.image,
          details: dbRow.details,
          name: dbRow.name,
          time: dbRow.time,
          topic: dbRow.topic,
          format: dbRow.format,
        })
        .eq("link", result.url);
      if (error) errors.push(error.message);
    }

    if (displayResults.length < maxDisplay) {
      displayResults.push({
        ...withUniqueImage,
        _fromDatabase: false,
        _isNewWeb: isNewLink,
      });
      if (isNewLink) newWebCount += 1;
    }
  }

  return {
    imported: displayResults,
    newWebCount,
    searchHits: allSearchResults.length,
    serperQueries,
    errors,
  };
}

function pickWithProfileVariety(
  pool: Record<string, unknown>[],
  inputs: FormInputs,
  mode: "strict" | "relaxed" | "fallback",
  limit: number,
  seen: Set<string>,
  profileSeed: string,
  flags: { isAlternative: boolean },
): Record<string, unknown>[] {
  if (limit <= 0 || !pool.length) return [];

  const scored = sortScoredWithProfileVariety(rankCompetitions(pool, inputs, mode), profileSeed);
  const picked: Record<string, unknown>[] = [];

  for (const { competition: comp } of scored) {
    if (picked.length >= limit) break;
    const id = getCompetitionId(comp);
    if (seen.has(id)) continue;
    seen.add(id);
    picked.push({
      ...comp,
      _fromDatabase: true,
      _isNewWeb: false,
      _isAlternative: flags.isAlternative,
    });
  }

  return picked;
}

function fillFromCuratedDatabase(
  manualEligible: Record<string, unknown>[],
  inputs: FormInputs,
): Record<string, unknown>[] {
  const profileSeed = buildProfileSeed(inputs);
  const seen = new Set<string>();
  const combined: Record<string, unknown>[] = [];

  combined.push(
    ...pickWithProfileVariety(
      manualEligible,
      inputs,
      "strict",
      MAX_CURATED_DB_SLOTS,
      seen,
      profileSeed,
      { isAlternative: false },
    ),
  );

  if (combined.length < MAX_CURATED_DB_SLOTS) {
    combined.push(
      ...pickWithProfileVariety(
        manualEligible,
        inputs,
        "relaxed",
        MAX_CURATED_DB_SLOTS - combined.length,
        seen,
        profileSeed,
        { isAlternative: true },
      ),
    );
  }

  return combined;
}

function fillFromCachedWeb(
  cachedWeb: Record<string, unknown>[],
  inputs: FormInputs,
  seen: Set<string>,
  limit: number,
): Record<string, unknown>[] {
  if (limit <= 0 || !cachedWeb.length) return [];

  const profileSeed = buildProfileSeed(inputs);
  return pickWithProfileVariety(
    cachedWeb,
    inputs,
    "relaxed",
    Math.min(limit, MAX_CACHED_WEB_SLOTS),
    seen,
    profileSeed,
    { isAlternative: true },
  );
}

function fillRemainingFromDatabase(
  eligibleDb: Record<string, unknown>[],
  inputs: FormInputs,
  seen: Set<string>,
  limit: number,
): Record<string, unknown>[] {
  if (limit <= 0) return [];

  const profileSeed = buildProfileSeed(inputs);
  return pickWithProfileVariety(
    eligibleDb,
    inputs,
    "fallback",
    limit,
    seen,
    profileSeed,
    { isAlternative: true },
  );
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

    const { data: rawCompetitions, error: fetchError } = await supabase
      .from("competitions")
      .select("*");

    if (fetchError) {
      return jsonResponse({ error: fetchError.message }, 500);
    }

    const allCompetitions = dedupeCompetitionRows(rawCompetitions ?? []);

    const existingLinks = new Set(
      allCompetitions
        .map((c) => normalizeCompetitionLink(String(c.link ?? "").trim()))
        .filter(Boolean),
    );

    // STEP 1: Curated manual rows first (profile-shuffled), cached web held back for variety
    const eligibleDb = allCompetitions
      .filter((c) => !isRejectedResult(competitionRecordToSearchResult(c)) && isCompetitionUpcoming(c))
      .map((c) => (String(c.source ?? "manual") === "web" ? refreshWebRowMetadata(c) : c));

    const manualEligible = eligibleDb.filter((c) => String(c.source ?? "manual") !== "web");
    const cachedWebEligible = eligibleDb.filter((c) => String(c.source) === "web");

    const imageAllocator = new ImageAllocator();
    let combinedDb = fillFromCuratedDatabase(manualEligible, inputs);
    const seenIds = new Set(combinedDb.map((comp) => getCompetitionId(comp)));

    const serperKey = Deno.env.get("SERPER_API_KEY") ?? "";
    const targetWebSlots = serperKey
      ? Math.max(1, Math.ceil(TARGET_RESULTS / 2))
      : Math.max(0, TARGET_RESULTS - combinedDb.length);

    // STEP 2: Refresh from web search for profile-specific variety when Serper is available
    let webResults: Record<string, unknown>[] = [];
    let searchHits = 0;
    let serperQueries = 0;
    let newWebCount = 0;
    let webErrors: string[] = [];
    let webSearchUsed = false;

    if (serperKey && targetWebSlots > 0) {
      webSearchUsed = true;
      const webDiscovery = await discoverFromWeb(
        supabase,
        inputs,
        userTopics,
        existingLinks,
        targetWebSlots,
        imageAllocator,
      );
      webResults = webDiscovery.imported
        .filter((comp) => !isRejectedCompetitionRecord(comp))
        .filter((comp) => {
          const id = getCompetitionId(comp);
          if (seenIds.has(id)) return false;
          seenIds.add(id);
          return true;
        });
      searchHits = webDiscovery.searchHits;
      serperQueries = webDiscovery.serperQueries;
      newWebCount = webDiscovery.newWebCount;
      webErrors = webDiscovery.errors;
      combinedDb = [...combinedDb, ...webResults];
    }

    // STEP 3: Fill gaps from cached web imports (profile-shuffled, not the same set every time)
    const cachedFill = fillFromCachedWeb(
      cachedWebEligible,
      inputs,
      seenIds,
      TARGET_RESULTS - combinedDb.length,
    );
    combinedDb = [...combinedDb, ...cachedFill];

    // STEP 4: Last resort fallback from anything eligible
    if (combinedDb.length < TARGET_RESULTS) {
      const fallbackFill = fillRemainingFromDatabase(
        eligibleDb,
        inputs,
        seenIds,
        TARGET_RESULTS - combinedDb.length,
      );
      combinedDb = [...combinedDb, ...fallbackFill];
    }

    const strictCount = combinedDb.filter((c) => !c._isAlternative).length;
    const alternativeCount = combinedDb.filter((c) => c._isAlternative).length;

    const competitions = combinedDb
      .slice(0, MAX_RESULTS)
      .map((comp) => assignCompetitionImage(comp, imageAllocator))
      .filter((comp) => !isRejectedCompetitionRecord(comp));

    const dbCount = competitions.filter((c) => c._fromDatabase === true).length;
    const webCount = competitions.filter((c) => c._isNewWeb === true).length;
    const isAlternativeResults = alternativeCount > 0 && strictCount === 0
      ? true
      : competitions.some((c) => c._isAlternative === true);
    const displayTopics = inputs.selectedTopics.filter((t) => t !== "Other").length
      ? inputs.selectedTopics.filter((t) => t !== "Other")
      : topics;

    const bannerParts: string[] = [];

    if (competitions.length) {
      bannerParts.push(`Showing ${competitions.length} competition${competitions.length === 1 ? "" : "s"}.`);
    }

    if (isAlternativeResults && strictCount === 0) {
      bannerParts.push("No exact profile match — showing similar upcoming alternatives from our database.");
    } else if (isAlternativeResults) {
      bannerParts.push(`${alternativeCount} similar alternative${alternativeCount === 1 ? "" : "s"} included.`);
    }

    if (!webSearchUsed && dbCount >= DB_PREFERRED_COUNT) {
      bannerParts.push(`All from our database — no web search (add SERPER_API_KEY for fresher results).`);
    } else if (webSearchUsed && newWebCount > 0) {
      bannerParts.push(
        `${dbCount} from database, ${newWebCount} newly saved online (${serperQueries} Serper ${serperQueries === 1 ? "query" : "queries"}). Results vary by profile.`,
      );
    } else if (webSearchUsed && webResults.length > 0) {
      bannerParts.push(
        `${webResults.length} refreshed from web search (${serperQueries} Serper ${serperQueries === 1 ? "query" : "queries"}) — profile-specific picks.`,
      );
    } else if (webSearchUsed && searchHits === 0) {
      bannerParts.push(`All ${dbCount} from database. Web search returned no results.`);
    } else if (webSearchUsed) {
      bannerParts.push(`All ${dbCount} from database — skipped extra web search (already saved).`);
    }

    if (inferredTopics.length) {
      bannerParts.push(`Inferred from your interests: ${inferredTopics.join(", ")}.`);
    }

    if (competitions.length < TARGET_RESULTS) {
      bannerParts.push(`Only ${competitions.length} upcoming matches — try broadening location or topics.`);
    }

    if (webErrors.length) {
      bannerParts.push(`${webErrors.length} save warning${webErrors.length === 1 ? "" : "s"} — check Edge Function logs.`);
    }

    return jsonResponse({
      competitions,
      topics: displayTopics,
      inferredTopics,
      hasExactMatches: competitions.length > 0,
      isAlternativeResults,
      webSearchUsed,
      webImportCount: newWebCount,
      newWebCount,
      webSearchHits: searchHits,
      serperQueries,
      webErrors,
      banner: bannerParts.join(" "),
      sourceCounts: {
        database: dbCount,
        web: webCount,
        newWeb: newWebCount,
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
