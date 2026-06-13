import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  FormInputs,
  MAX_RESULTS,
  MAX_SUGGESTED_RESULTS,
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
  dedupeCompetitionResults,
  buildProfileSeed,
  sortScoredWithProfileVariety,
  inferCompetitionLocation,
  inferAgeLabel,
  inferGradeLabel,
  refreshWebRowMetadata,
  getMatchedTopicsForCompetition,
  topicExplicitlyConflictsWithSearch,
  competitionMatchesTopic,
  pickSuggestedCompetitions,
  passesSuggestedRelevanceGate,
  competitionMatchesOtherText,
  inferTopicFromText,
} from "../_shared/matching.ts";
import {
  inferTimeLabel,
  hasOnlyPastYears,
  isCompetitionUpcoming,
  isClosedScheduleText,
  isCompetitionResultsPage,
  refreshCompetitionSchedule,
  toCompetitionDbRow,
} from "../_shared/dates.ts";
import { ImageAllocator, resolveCompetitionImage } from "../_shared/images.ts";
import { filterCompetitionsWithGemini } from "../_shared/gemini-filter.ts";
import {
  checkGeminiQuota,
  quotaSkipMessage,
  recordGemini429,
  reserveGeminiSlot,
} from "../_shared/gemini-quota.ts";

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
  "varsitytutors.com", "chegg.com", "coursehero.com", "studystack.com",
  "sparknotes.com", "cliffsnotes.com", "khanacademy.org", "coursera.org",
  "careervillage.org", "careervillage.com",
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
  /\b\d+\s+[\w\s]{2,}\bcompetitions?\b/i,
  /\bcompetitions for\b/i,
  /\b\d+\s+[\w\s]+\bfor\b[^?]*\b(high school|students|schools)\b/i,
];

const NEWS_AND_JUNK_PATTERNS = [
  /\b(photos?,? video|video:?|local news|press release)\b/i,
  /\b(students? (win|won|wins|winning|show off|celebrate))\b/i,
  /\b\[pdf\]\b/i,
  /\.pdf(\?|#|$)/i,
  /\b(school district|board of education)\b/i,
  /\|\s*[^|]+\s+high school\s*$/i,
  /\b(campus news|student news|weekly update)\b/i,
  /\blive feed\b/i,
  /\b\d+\s+months?\s+ago\b/i,
  /\b\d+\s+days?\s+ago\b/i,
  /\b\d+\s+weeks?\s+ago\b/i,
  /\bplease see the event link\b/i,
  /\belementary school\b/i,
  /\bmiddle school\b/i,
  /\bkindergarten\b/i,
  /#\w{3,}/i,
  /\btypical dates\b/i,
  /\bwhat it'?s for\b/i,
];

const RESULTS_PAGE_PATTERNS = [
  /\bcompetition results\b/i,
  /\b(?:exam|contest|tournament|competition)\s+results\b/i,
  /\bresults\s[-–—]/i,
  /\bpast winners\b/i,
  /\bleaderboard\b/i,
  /exam\?cmd=/i,
];

const KNOWN_COMPETITION_SIGNALS = [
  /\bscience bowl\b/i,
  /\bmathcounts\b/i,
  /\b(amc|aime|usamo|usajmo)\b/i,
  /\b(isef|regeneron sts|science olympiad|physics olympiad|usaco)\b/i,
  /\b(deca|hosa|fbla|nhd|national history day)\b/i,
  /\b(olympiad|contest information|competition information)\b/i,
  /\b(register|registration|apply|eligibility|rules and guidelines)\b/i,
  /\b(usaco|hackathon|robotics|technovation|cyberpatriot|first robotics|programming contest|coding competition)\b/i,
];

const DB_PREFERRED_COUNT = 7;
const TARGET_DB_SLOTS = 7;
const TARGET_WEB_SLOTS = 3;
const MAX_SERPER_QUERIES = 1;
const MAX_SERPER_QUERIES_WHEN_EMPTY = 2;
const MAX_WEB_PERSIST = 12;
const MAX_SUGGESTED_WEB = 25;
const SERPER_RESULTS_PER_QUERY = 8;

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

  const searchQuery = String(body.searchQuery ?? "").trim();
  const otherTopic = String(body.otherText ?? "").trim();
  const otherText = [searchQuery, otherTopic].filter(Boolean).join(" ").trim();

  if (!selectedTopics.length && !otherText) {
    return null;
  }

  return {
    age: String(body.age ?? "").trim(),
    grade: String(body.grade ?? "").trim(),
    location: String(body.location ?? "").trim(),
    format: String(body.format ?? "").trim(),
    selectedTopics,
    searchQuery,
    otherText,
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
  const negatives = '-news -quora -reddit -careervillage -"competitions for" -"top 10" -"top 9" -"best " -blog -list -medium -photos -video -pdf -"summer program"';
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

function isResultsPageResult(result: SearchResult): boolean {
  const combined = `${result.title} ${result.snippet} ${result.url}`;
  if (RESULTS_PAGE_PATTERNS.some((pattern) => pattern.test(combined))) return true;
  if (/\bresults\b/i.test(result.title) && !/\bregister(?:ation)?\s+(?:is\s+)?open\b/i.test(combined)) {
    return true;
  }
  return false;
}

function isQuestionOrForumPage(result: SearchResult): boolean {
  const title = result.title.trim();
  const combined = `${result.title} ${result.snippet}`;

  if (/\?\s*[-–—]/.test(title)) return true;
  if (/\?$/.test(title) && !KNOWN_COMPETITION_SIGNALS.some((p) => p.test(combined))) return true;
  if (/\bis there (a|any)\b/i.test(title)) return true;
  if (/\bhow (do|can|to)\b/i.test(title) && /\?/.test(title)) return true;
  if (/\bfind more competitions\b/i.test(combined)) return true;
  if (/\bways to find\b/i.test(combined)) return true;
  if (/\b(thread|discussion forum|asked on)\b/i.test(combined)) return true;

  try {
    const host = new URL(result.url).hostname.toLowerCase();
    if (host.includes("careervillage") || host.includes("quora") || host.includes("reddit")) {
      return true;
    }
    if (host.includes("stackexchange") || host.includes("stackoverflow")) {
      return true;
    }
  } catch {
    return true;
  }

  return false;
}

function isListOrDirectoryPage(result: SearchResult): boolean {
  const title = result.title.trim();
  const combined = `${result.title} ${result.snippet}`;

  if (/^\d+\s+[\w\s]{2,}\bcompetitions?\b/i.test(title)) return true;
  if (/\b\d+\s+[\w\s]+\bcompetitions?\b/i.test(title) && !KNOWN_COMPETITION_SIGNALS.some((p) => p.test(combined))) {
    return true;
  }
  if (/\bcompetitions for\b/i.test(title)) return true;
  if (/\blist of\b/i.test(combined) && /\bcompetitions?\b/i.test(combined)) return true;
  if (/\btypical dates\b/i.test(combined) && /\bwhat it'?s for\b/i.test(combined)) return true;
  if (/\bcompetition\b.*\btypical dates\b/i.test(combined)) return true;

  return false;
}

function isHardRejectedResult(result: SearchResult): boolean {
  if (isQuestionOrForumPage(result)) return true;
  if (isListOrDirectoryPage(result)) return true;
  if (isResultsPageResult(result)) return true;

  const combined = `${result.title} ${result.snippet}`.toLowerCase();
  if (LISTICLE_TITLE_PATTERNS.some((pattern) => pattern.test(combined))) {
    return true;
  }

  try {
    const parsed = new URL(result.url);
    const host = parsed.hostname.toLowerCase();
    if (SKIP_DOMAINS.some((d) => host.includes(d))) return true;
    if (parsed.pathname.toLowerCase().endsWith(".pdf")) return true;
  } catch {
    return true;
  }

  return false;
}

function isRejectedResult(result: SearchResult): boolean {
  const title = result.title.toLowerCase();
  const combined = `${result.title} ${result.snippet}`.toLowerCase();

  if (isQuestionOrForumPage(result)) return true;
  if (isListOrDirectoryPage(result)) return true;

  if (isResultsPageResult(result)) return true;
  if (hasOnlyPastYears(combined)) return true;
  if (isClosedScheduleText(combined)) return true;

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

  if (isSchoolOrSocialFeed(result)) return true;

  return false;
}

function isSchoolOrSocialFeed(result: SearchResult): boolean {
  const combined = `${result.title} ${result.snippet}`.toLowerCase();

  const feedSignals =
    /\blive feed\b/.test(combined) ||
    /\b\d+\s+(months?|days?|weeks?)\s+ago\b/.test(combined) ||
    /\|\s*[^|]*\b(elementary|middle|high)\s+school\b/i.test(result.title) ||
    (/\belementary school\b/.test(combined) && !looksLikeCompetition(combined));

  if (!feedSignals) return false;

  return !KNOWN_COMPETITION_SIGNALS.some((pattern) => pattern.test(combined)) &&
    !looksLikeCompetition(combined);
}

function passesStrictCompetitionGate(result: SearchResult): boolean {
  if (isRejectedResult(result)) return false;

  const combined = `${result.title} ${result.snippet}`;
  const hasKnownName = KNOWN_COMPETITION_SIGNALS.some((pattern) => pattern.test(combined));

  try {
    const parsed = new URL(result.url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    if (
      host.includes("usaco") ||
      host.includes("firstinspires") ||
      host.includes("technovation") ||
      host.includes("cyberpatriot") ||
      host.includes("mathcounts") ||
      host.includes("sciencebowl") ||
      host.includes("devpost")
    ) {
      return true;
    }

    if (hasKnownName && (path.includes("register") || path.includes("registration") || path === "/" || path.includes("contest"))) {
      return true;
    }

    if (hasKnownName && host.endsWith(".org") && !/\bcompetitions\b/i.test(result.title)) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

function passesRelaxedCompetitionGate(result: SearchResult): boolean {
  if (isRejectedResult(result)) return false;

  const combined = `${result.title} ${result.snippet}`;
  const combinedLower = combined.toLowerCase();
  if (!looksLikeCompetition(combinedLower)) return false;
  if (/\bcompetitions\b/i.test(result.title) && !KNOWN_COMPETITION_SIGNALS.some((p) => p.test(combined))) {
    return false;
  }

  const hasKnownName = KNOWN_COMPETITION_SIGNALS.some((pattern) => pattern.test(combined));

  try {
    const parsed = new URL(result.url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const genericHome = ["/", "/home", "/index.html", "/about", "/contact"].includes(path);

    if (genericHome && !hasKnownName) return false;

    if (host.endsWith(".gov") && (hasKnownName || path.includes("competition") || path.includes("contest"))) {
      return true;
    }

    if (host.endsWith(".org") || host.endsWith(".edu")) {
      const competitionPath =
        path.includes("competition") ||
        path.includes("contest") ||
        path.includes("olympiad") ||
        path.includes("register") ||
        path.includes("rules");
      if (competitionPath || hasKnownName) return true;
      return false;
    }

    if (
      host.includes("competition") ||
      host.includes("contest") ||
      host.includes("olympiad") ||
      host.includes("mathcounts") ||
      host.includes("sciencebowl") ||
      host.includes("usaco") ||
      host.includes("firstinspires") ||
      host.includes("technovation") ||
      host.includes("cyberpatriot")
    ) {
      return true;
    }
  } catch {
    return false;
  }

  if (hasKnownName) return true;

  return /\b(official|eligibility|rules and guidelines|annual competition)\b/i.test(combined) &&
    /\b(register|registration)\b/i.test(combined);
}

function isOfficialCompetitionResult(result: SearchResult): boolean {
  return passesStrictCompetitionGate(result) || passesRelaxedCompetitionGate(result);
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
  _allocator: ImageAllocator,
): Record<string, unknown> {
  const link = String(comp.link ?? comp.url ?? "");
  const existing = String(comp.image ?? comp.image_url ?? "").trim();
  const image = resolveCompetitionImage(existing, link);
  return { ...comp, image };
}

function scoreSearchResult(result: SearchResult, otherText = ""): number {
  const searchMatch = Boolean(otherText) && searchResultMatchesQuery(result, otherText);

  if (searchMatch) {
    if (isHardRejectedResult(result)) return -100;
  } else if (isRejectedResult(result)) {
    return -100;
  }

  let score = 0;
  if (searchMatch) score += 50;

  if (!isOfficialCompetitionResult(result)) {
    if (score < 40) return -50;
  } else {
    score += 5;
  }
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
    "hackathon", "hack", "nonprofit", "non profit", "program", "science fair",
  ];
  return signals.some((s) => normalized.includes(s) || textMatchesKeyword(normalized, s));
}

function searchResultMatchesQuery(result: SearchResult, query: string): boolean {
  if (!query.trim()) return false;
  return competitionMatchesOtherText(
    { name: result.title, details: result.snippet, link: result.url, topic: "" },
    query,
  );
}

function buildNamedSearchFallbackResult(
  result: SearchResult,
  inputs: FormInputs,
  imageUrl: string,
): Record<string, unknown> {
  const combinedText = `${result.title} ${result.snippet}`;
  const topic = inferTopicFromText(combinedText) ??
    inferBestTopicForUser(combinedText, getUserSearchTopics(inputs)) ??
    getUserSearchTopics(inputs).find((t) => t !== "Other") ??
    "Technology";

  return {
    name: result.title || "Program",
    details: result.snippet || "Found online for your search.",
    link: result.url,
    image: imageUrl,
    topic,
    format: inputs.format || inferFormatFromText(combinedText) || "online",
    location: inferCompetitionLocation(result.title, result.snippet, result.url, inputs.location),
    grade: inferGradeLabel(combinedText, result.title) || "",
    age: inferAgeLabel(combinedText, result.title, result.snippet),
    source: "web",
    _matchedTopics: [topic],
    _searchMatch: true,
  };
}

function buildCompetitionFromSearchResult(
  result: SearchResult,
  inputs: FormInputs,
  userTopics: string[],
  imageUrl: string,
  strictTopic = true,
): Record<string, unknown> | null {
  const combinedText = `${result.title} ${result.snippet}`;
  const matchPhrase = getMatchPhrase(inputs);
  const matchesSearch = Boolean(matchPhrase) &&
    searchResultMatchesQuery(result, matchPhrase);

  let topic = inferBestTopicForUser(combinedText, userTopics);

  if (!topic && userTopics.length > 0) {
    const matched = getMatchedTopicsForCompetition(
      { name: result.title, details: result.snippet, topic: "" },
      userTopics,
      inputs.otherText,
    );
    topic = matched.find((t) => t !== "Other") ?? null;
  }

  if (matchesSearch) {
    topic = topic ?? inferTopicFromText(combinedText) ??
      userTopics.find((t) => t !== "Other") ?? "Technology";
  } else if (!topic && strictTopic && userTopics.length > 0 && !userTopics.includes("Other")) {
    return null;
  }

  topic = topic ?? userTopics.find((t) => t !== "Other") ?? inferTopicFromText(combinedText) ?? null;
  if (!topic) return null;

  if (!matchesSearch) {
    const matchedTopics = getMatchedTopicsForCompetition(
      { name: result.title, details: result.snippet, topic: String(topic) },
      userTopics,
      inputs.otherText,
    ).filter((t) => t !== "Other");
    if (userTopics.length > 0 && !userTopics.includes("Other") && matchedTopics.length === 0) {
      return null;
    }
    if (matchedTopics.length) topic = matchedTopics[0];
  }

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
    grade: inferGradeLabel(combinedText, result.title) || "",
    age: inferAgeLabel(combinedText, result.title, result.snippet),
    source: "web",
    ...(time ? { time } : {}),
    _matchedTopics: [topic],
    ...(matchesSearch ? { _searchMatch: true } : {}),
  };

  if (!matchesSearch && !isCompetitionUpcoming(competition)) return null;

  return competition;
}

function isUsableSearchResult(result: SearchResult, otherText = ""): boolean {
  if (!result.url || !result.title || result.title.length < 4) return false;
  if (!isCandidateUrl(result.url)) return false;
  if (otherText && searchResultMatchesQuery(result, otherText)) return true;
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

function competitionMatchesUserTopics(
  comp: Record<string, unknown>,
  userTopics: string[],
  otherText: string,
): boolean {
  if (otherText && competitionMatchesOtherText(comp, otherText)) return true;
  if (userTopics.includes("Other")) return true;
  if (!userTopics.length) return true;
  return getMatchedTopicsForCompetition(comp, userTopics, otherText).some((t) => t !== "Other");
}

function isRejectedCompetitionRecord(
  comp: Record<string, unknown>,
  userTopics: string[] = [],
  otherText = "",
): boolean {
  const matchesSearch = Boolean(otherText) && competitionMatchesOtherText(comp, otherText);

  if (matchesSearch) {
    if (isCompetitionResultsPage(comp)) return true;
    if (isRejectedResult(competitionRecordToSearchResult(comp))) return true;
    const scheduleText = `${comp.name ?? ""} ${comp.details ?? ""} ${comp.time ?? ""}`;
    if (isClosedScheduleText(scheduleText)) return true;
    return false;
  }

  if (isCompetitionResultsPage(comp)) return true;
  if (topicExplicitlyConflictsWithSearch(comp, userTopics)) return true;
  if (isRejectedResult(competitionRecordToSearchResult(comp))) return true;
  if (!isCompetitionUpcoming(comp)) return true;
  if (userTopics.length && !competitionMatchesUserTopics(comp, userTopics, otherText)) return true;
  return false;
}

async function discoverFromWeb(
  supabase: ReturnType<typeof createClient>,
  inputs: FormInputs,
  userTopics: string[],
  existingLinks: Set<string>,
  maxDisplay: number,
): Promise<{
  imported: Record<string, unknown>[];
  suggestedWeb: Record<string, unknown>[];
  newWebCount: number;
  searchHits: number;
  serperQueries: number;
  geminiFilterUsed: boolean;
  geminiNote: string;
  errors: string[];
}> {
  if (maxDisplay <= 0) {
    return {
      imported: [], suggestedWeb: [], newWebCount: 0, searchHits: 0, serperQueries: 0,
      geminiFilterUsed: false, geminiNote: "", errors: [],
    };
  }

  const existingAtStart = new Set(existingLinks);
  const matchPhrase = getMatchPhrase(inputs);

  const topicLabel = userTopics.filter((t) => t !== "Other" && t !== "Finance").join(" ");
  const searchPhrase = String(inputs.searchQuery ?? "").trim() || inputs.otherText.trim();
  const primaryQuery = searchPhrase || (userTopics.includes("Technology")
    ? "USACO hackathon FIRST robotics programming contest registration high school official site:.org"
    : userTopics.includes("Mathematics")
    ? "AMC AIME MATHCOUNTS USAMO math competition registration high school official site:.org"
    : userTopics.includes("Science")
    ? "Science Olympiad ISEF science fair registration high school official site:.org"
    : buildSearchQuery(inputs, userTopics, true));
  const fallbackQuery = searchPhrase
    ? `${searchPhrase} registration official site`
    : `${topicLabel} student competition registration official site:.org`.trim();
  const queryPlan = [primaryQuery, fallbackQuery].filter(Boolean);
  const errors: string[] = [];

  const allSearchResults: SearchResult[] = [];
  const seenUrls = new Set<string>();
  let serperQueries = 0;
  let geminiFilterUsed = false;
  let geminiNote = "";

  for (let i = 0; i < queryPlan.length; i += 1) {
    const query = queryPlan[i];
    if (i > 0 && allSearchResults.filter((r) => passesWebCandidateGate(r, userTopics, matchPhrase)).length >= maxDisplay) break;
    if (serperQueries >= MAX_SERPER_QUERIES_WHEN_EMPTY) break;
    if (i > 0 && serperQueries >= MAX_SERPER_QUERIES) break;

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

    const goodCount = allSearchResults.filter((r) => passesWebCandidateGate(r, userTopics, matchPhrase)).length;
    if (goodCount >= maxDisplay) break;
  }

  // Rule filters only for web — one Gemini call runs on the final merged list (avoids 429 rate limits).
  const rankedResults = [...allSearchResults]
    .filter((r) => passesWebCandidateGate(r, userTopics, matchPhrase))
    .sort((a, b) => scoreSearchResult(b, matchPhrase) - scoreSearchResult(a, matchPhrase));

  const displayResults: Record<string, unknown>[] = [];
  const suggestedWeb: Record<string, unknown>[] = [];
  const importedLinks = new Set<string>();
  let persisted = 0;
  let newWebCount = 0;

  for (const result of rankedResults) {
    if (displayResults.length >= maxDisplay && persisted >= MAX_WEB_PERSIST) break;

    const normalizedUrl = normalizeCompetitionLink(result.url);
    if (importedLinks.has(normalizedUrl)) continue;
    const matchesSearch = searchResultMatchesQuery(result, matchPhrase);
    if (!isUsableSearchResult(result, matchPhrase)) continue;
    if (matchesSearch && isHardRejectedResult(result)) continue;

    const imageUrl = result.image && isSafeImageUrl(result.image, result.url)
      ? result.image
      : faviconForUrl(result.url);
    let competition = buildCompetitionFromSearchResult(
      result,
      inputs,
      userTopics,
      imageUrl,
      !matchesSearch,
    );
    if (!competition && matchesSearch) {
      competition = buildNamedSearchFallbackResult(result, inputs, imageUrl);
    }
    if (!competition) continue;

    const isNewLink = !existingAtStart.has(normalizedUrl);
    importedLinks.add(normalizedUrl);
    persisted += 1;

    const dbRow = toCompetitionDbRow({
      ...competition,
      image: imageUrl || faviconForUrl(result.url),
    });

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
        ...competition,
        image: imageUrl || faviconForUrl(result.url),
        _fromDatabase: false,
        _isNewWeb: isNewLink,
      });
      if (isNewLink) newWebCount += 1;
    }
  }

  const primaryUrls = new Set(
    displayResults.map((c) => normalizeCompetitionLink(String(c.link ?? ""))).filter(Boolean),
  );

  for (const result of rankedResults) {
    if (suggestedWeb.length >= MAX_SUGGESTED_WEB) break;

    const normalizedUrl = normalizeCompetitionLink(result.url);
    if (!normalizedUrl || primaryUrls.has(normalizedUrl) || importedLinks.has(normalizedUrl)) {
      continue;
    }
    const matchesSuggestedSearch = matchPhrase && searchResultMatchesQuery(result, matchPhrase);
    if (matchesSuggestedSearch) {
      if (isHardRejectedResult(result)) continue;
    } else if (!isUsableSearchResult(result) || isRejectedResult(result)) {
      continue;
    }

    const imageUrl = result.image && isSafeImageUrl(result.image, result.url)
      ? result.image
      : faviconForUrl(result.url);
    let competition = buildCompetitionFromSearchResult(
      result,
      inputs,
      userTopics,
      imageUrl,
      false,
    );
    if (!competition && matchesSuggestedSearch) {
      competition = buildNamedSearchFallbackResult(result, inputs, imageUrl);
    }
    if (!competition) continue;
    if (!passesSuggestedRelevanceGate(competition, inputs, userTopics)) continue;

    suggestedWeb.push({
      ...competition,
      image: imageUrl || faviconForUrl(result.url),
      _fromDatabase: false,
      _isSuggested: true,
      _isNewWeb: false,
    });
  }

  if (displayResults.length === 0 && searchPhrase) {
    for (const result of allSearchResults) {
      if (displayResults.length >= maxDisplay) break;
      if (!searchResultMatchesQuery(result, searchPhrase) || isHardRejectedResult(result)) continue;

      const normalizedUrl = normalizeCompetitionLink(result.url);
      if (!normalizedUrl || importedLinks.has(normalizedUrl)) continue;

      const imageUrl = result.image && isSafeImageUrl(result.image, result.url)
        ? result.image
        : faviconForUrl(result.url);
      const competition = buildNamedSearchFallbackResult(result, inputs, imageUrl);
      importedLinks.add(normalizedUrl);

      const dbRow = toCompetitionDbRow({
        ...competition,
        image: imageUrl || faviconForUrl(result.url),
      });
      const isNewLink = !existingAtStart.has(normalizedUrl);
      if (isNewLink) {
        const { error } = await supabase.from("competitions").insert(dbRow);
        if (error && !String(error.message).toLowerCase().includes("duplicate")) {
          errors.push(error.message);
        } else {
          existingLinks.add(normalizedUrl);
          newWebCount += 1;
        }
      }

      displayResults.push({
        ...competition,
        image: imageUrl || faviconForUrl(result.url),
        _fromDatabase: false,
        _isNewWeb: isNewLink,
      });
    }
  }

  return {
    imported: displayResults,
    suggestedWeb,
    newWebCount,
    searchHits: allSearchResults.length,
    serperQueries,
    geminiFilterUsed,
    geminiNote,
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

function passesWebCandidateGate(result: SearchResult, userTopics: string[], otherText = ""): boolean {
  if (otherText) {
    const stub = { name: result.title, details: result.snippet, link: result.url, topic: "" };
    if (competitionMatchesOtherText(stub, otherText)) {
      return !isHardRejectedResult(result);
    }
  }
  if (isRejectedResult(result)) return false;
  if (passesStrictCompetitionGate(result) || passesRelaxedCompetitionGate(result)) return true;
  if (!userTopics.length || userTopics.includes("Other")) return false;
  const stub = { name: result.title, details: result.snippet, topic: "" };
  return userTopics.some(
    (topic) => topic !== "Other" && topic !== "Finance" && competitionMatchesTopic(stub, topic, ""),
  );
}

function pickTopicMatchedFill(
  pool: Record<string, unknown>[],
  inputs: FormInputs,
  userTopics: string[],
  limit: number,
  seen: Set<string>,
): Record<string, unknown>[] {
  if (limit <= 0 || !pool.length) return [];

  const candidates = pool.filter((comp) => {
    const id = getCompetitionId(comp);
    if (seen.has(id)) return false;
    if (isCompetitionResultsPage(comp)) return false;
    if (isRejectedResult(competitionRecordToSearchResult(comp))) return false;
    if (!isCompetitionUpcoming(comp)) return false;
    if (userTopics.length && !competitionMatchesUserTopics(comp, userTopics, inputs.otherText)) {
      return false;
    }
    return true;
  });

  const profileSeed = buildProfileSeed(inputs);
  const ranked = sortScoredWithProfileVariety(
    rankCompetitions(candidates, inputs, "fallback"),
    profileSeed,
  );

  const picked: Record<string, unknown>[] = [];
  for (const { competition: comp } of ranked) {
    if (picked.length >= limit) break;
    const id = getCompetitionId(comp);
    if (seen.has(id)) continue;
    seen.add(id);
    picked.push({ ...comp, _fromDatabase: true, _isNewWeb: false });
  }

  if (picked.length < limit) {
    for (const comp of candidates) {
      if (picked.length >= limit) break;
      const id = getCompetitionId(comp);
      if (seen.has(id)) continue;
      seen.add(id);
      picked.push({ ...comp, _fromDatabase: true, _isNewWeb: false });
    }
  }

  return picked;
}

function getMatchPhrase(inputs: FormInputs): string {
  return String(inputs.searchQuery ?? "").trim() || String(inputs.otherText ?? "").trim();
}

function prioritizeSearchMatches(
  competitions: Record<string, unknown>[],
  searchQuery: string,
  imageAllocator: ImageAllocator,
): Record<string, unknown>[] {
  if (!searchQuery.trim()) return competitions;

  const matches = competitions.filter((comp) => competitionMatchesOtherText(comp, searchQuery));
  const rest = competitions.filter((comp) => !competitionMatchesOtherText(comp, searchQuery));
  return dedupeCompetitionResults([
    ...matches.map((comp) => assignCompetitionImage(comp, imageAllocator)),
    ...rest.map((comp) => assignCompetitionImage(comp, imageAllocator)),
  ]).slice(0, TARGET_RESULTS);
}

function buildNamedSearchPrimary(
  webResults: Record<string, unknown>[],
  eligibleDb: Record<string, unknown>[],
  inputs: FormInputs,
  userTopics: string[],
  imageAllocator: ImageAllocator,
): Record<string, unknown>[] {
  const searchQuery = String(inputs.searchQuery ?? "").trim();
  const matchPhrase = getMatchPhrase(inputs);

  let competitions = dedupeCompetitionResults(
    webResults
      .map((comp) => assignCompetitionImage(comp, imageAllocator))
      .filter((comp) => !isRejectedCompetitionRecord(comp, userTopics, matchPhrase)),
  );

  competitions = prioritizeSearchMatches(competitions, searchQuery, imageAllocator);

  if (competitions.length < TARGET_RESULTS) {
    const dbMatches = eligibleDb.filter(
      (comp) =>
        competitionMatchesOtherText(comp, searchQuery) &&
        !isRejectedCompetitionRecord(comp, userTopics, matchPhrase),
    );
    competitions = ensurePrimaryCompetitions(
      competitions,
      dbMatches,
      inputs,
      userTopics,
      imageAllocator,
    ).filter((comp) => !isRejectedCompetitionRecord(comp, userTopics, matchPhrase));
    competitions = prioritizeSearchMatches(competitions, searchQuery, imageAllocator);
  }

  if (competitions.length < TARGET_RESULTS) {
    const seen = new Set(competitions.map((comp) => getCompetitionId(comp)));
    for (const comp of webResults) {
      if (competitions.length >= TARGET_RESULTS) break;
      const id = getCompetitionId(comp);
      if (seen.has(id)) continue;
      if (isRejectedCompetitionRecord(comp, userTopics, matchPhrase)) continue;
      seen.add(id);
      competitions.push(assignCompetitionImage(comp, imageAllocator));
    }
  }

  return prioritizeSearchMatches(competitions, searchQuery, imageAllocator);
}

function ensurePrimaryCompetitions(
  current: Record<string, unknown>[],
  pool: Record<string, unknown>[],
  inputs: FormInputs,
  userTopics: string[],
  imageAllocator: ImageAllocator,
): Record<string, unknown>[] {
  const seen = new Set(current.map((comp) => getCompetitionId(comp)));
  let result = dedupeCompetitionResults(current).map((comp) =>
    assignCompetitionImage(comp, imageAllocator)
  );

  for (const mode of ["strict", "relaxed", "fallback"] as const) {
    if (result.length >= TARGET_RESULTS) break;
    const batch = pickWithProfileVariety(
      pool.filter((c) => !seen.has(getCompetitionId(c))),
      inputs,
      mode,
      TARGET_RESULTS - result.length,
      seen,
      buildProfileSeed(inputs),
      { isAlternative: false },
    );
    result = dedupeCompetitionResults([
      ...result,
      ...batch.map((comp) => assignCompetitionImage(comp, imageAllocator)),
    ]);
    for (const comp of result) seen.add(getCompetitionId(comp));
  }

  if (result.length < TARGET_RESULTS) {
    const fill = pickTopicMatchedFill(
      pool,
      inputs,
      userTopics,
      TARGET_RESULTS - result.length,
      seen,
    );
    result = dedupeCompetitionResults([
      ...result,
      ...fill.map((comp) => assignCompetitionImage(comp, imageAllocator)),
    ]).slice(0, TARGET_RESULTS);
  }

  return result.slice(0, TARGET_RESULTS);
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
      return jsonResponse({ error: "You selected Other — add details in the search box or Other field." }, 400);
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

    // Build eligible pool: upcoming, on-topic, not junk
    const eligibleDb = allCompetitions
      .filter((c) => !isRejectedResult(competitionRecordToSearchResult(c)))
      .map((c) => {
        const refreshed = String(c.source ?? "manual") === "web"
          ? refreshWebRowMetadata(c)
          : c;
        return refreshCompetitionSchedule(refreshed);
      })
      .filter((c) => !isCompetitionResultsPage(c) && isCompetitionUpcoming(c));

    const serperKey = Deno.env.get("SERPER_API_KEY") ?? "";
    const geminiKey = Deno.env.get("GEMINI_API_KEY") ?? "";

    const imageAllocator = new ImageAllocator();
    let webResults: Record<string, unknown>[] = [];
    let webSuggested: Record<string, unknown>[] = [];
    let searchHits = 0;
    let serperQueries = 0;
    let newWebCount = 0;
    let webErrors: string[] = [];
    let webSearchUsed = false;
    let geminiFilterUsed = false;
    let geminiNote = "";

    const searchQuery = String(inputs.searchQuery ?? "").trim();
    const isNamedSearch = Boolean(searchQuery);
    const matchPhrase = getMatchPhrase(inputs);
    const webImportTarget = isNamedSearch ? TARGET_RESULTS : TARGET_WEB_SLOTS;

    if (serperKey || isNamedSearch) {
      webSearchUsed = true;
      const webDiscovery = await discoverFromWeb(
        supabase,
        inputs,
        userTopics,
        existingLinks,
        webImportTarget,
      );
      webResults = webDiscovery.imported.filter(
        (comp) => !isRejectedCompetitionRecord(comp, userTopics, matchPhrase),
      );
      webSuggested = webDiscovery.suggestedWeb;
      searchHits = webDiscovery.searchHits;
      serperQueries = webDiscovery.serperQueries;
      newWebCount = webDiscovery.newWebCount;
      webErrors = webDiscovery.errors;
      geminiFilterUsed = webDiscovery.geminiFilterUsed;
      geminiNote = webDiscovery.geminiNote;
    }

    let competitions = isNamedSearch
      ? buildNamedSearchPrimary(webResults, eligibleDb, inputs, userTopics, imageAllocator)
      : ensurePrimaryCompetitions(
        webResults.map((comp) => assignCompetitionImage(comp, imageAllocator)),
        eligibleDb,
        inputs,
        userTopics,
        imageAllocator,
      ).filter((comp) => !isRejectedCompetitionRecord(comp, userTopics, matchPhrase));

    let geminiSkippedReason = "";

    if (geminiKey && competitions.length && !isNamedSearch) {
      const quota = await checkGeminiQuota(supabase);

      if (quota.allowed && await reserveGeminiSlot(supabase)) {
        const finalGemini = await filterCompetitionsWithGemini(competitions, geminiKey, userTopics);

        if (finalGemini.rateLimited) {
          await recordGemini429(supabase);
          geminiSkippedReason = "cooldown";
        } else if (finalGemini.applied) {
          competitions = finalGemini.items.filter(
            (comp) => !isRejectedCompetitionRecord(comp, userTopics, matchPhrase),
          );
          geminiFilterUsed = true;
        } else if (finalGemini.note) {
          geminiNote = finalGemini.note;
        }
      } else {
        geminiSkippedReason = quota.reason;
      }
    }

    if (isNamedSearch) {
      competitions = buildNamedSearchPrimary(webResults, eligibleDb, inputs, userTopics, imageAllocator);
    } else {
      competitions = ensurePrimaryCompetitions(
        competitions,
        eligibleDb,
        inputs,
        userTopics,
        imageAllocator,
      ).filter((comp) => !isRejectedCompetitionRecord(comp, userTopics, matchPhrase));
    }

    const primaryIds = new Set(competitions.map((comp) => getCompetitionId(comp)));
    const leftoverWeb = dedupeCompetitionResults([
      ...webResults.filter((comp) => !primaryIds.has(getCompetitionId(comp))),
      ...webSuggested.filter((comp) => !primaryIds.has(getCompetitionId(comp))),
    ]);

    const suggestedPool = dedupeCompetitionResults([
      ...leftoverWeb,
      ...allCompetitions
        .map((c) => String(c.source ?? "manual") === "web" ? refreshWebRowMetadata(c) : c)
        .map((c) => refreshCompetitionSchedule(c))
        .filter((c) => !primaryIds.has(getCompetitionId(c)))
        .filter((c) => !isCompetitionResultsPage(c) && isCompetitionUpcoming(c))
        .filter((c) => !isRejectedResult(competitionRecordToSearchResult(c))),
    ]);

    let suggestedCompetitions = pickSuggestedCompetitions(
      suggestedPool,
      inputs,
      primaryIds,
      MAX_SUGGESTED_RESULTS,
    );

    suggestedCompetitions = suggestedCompetitions
      .filter((comp) => !primaryIds.has(getCompetitionId(comp)))
      .map((comp) => assignCompetitionImage(comp, imageAllocator));

    const dbCount = competitions.filter((c) => c._fromDatabase === true).length;
    const webCount = competitions.filter((c) => c._isNewWeb === true).length;
    const suggestedCount = suggestedCompetitions.length;
    const displayTopics = inputs.selectedTopics.filter((t) => t !== "Other").length
      ? inputs.selectedTopics.filter((t) => t !== "Other")
      : topics;

    const bannerParts: string[] = [];

    if (competitions.length) {
      bannerParts.push(
        `${competitions.length} recommended match${competitions.length === 1 ? "" : "es"} for your search.`,
      );
    }

    if (suggestedCount) {
      bannerParts.push(
        `${suggestedCount} related option${suggestedCount === 1 ? "" : "s"} below — close to your search but not top picks.`,
      );
    }

    if (!webSearchUsed) {
      bannerParts.push(`${dbCount} from database${eligibleDb.length > dbCount ? ` (picked ${dbCount} of ${eligibleDb.length} matches)` : ""}.`);
      if (!serperKey) {
        bannerParts.push("Add SERPER_API_KEY for 3 fresh web results on top.");
      }
    } else if (isNamedSearch) {
      bannerParts.push(`Web search for “${searchQuery}” (${serperQueries} search credit${serperQueries === 1 ? "" : "s"}).`);
      if (newWebCount > 0) {
        bannerParts.push(`${newWebCount} new result${newWebCount === 1 ? "" : "s"} saved.`);
      }
    } else {
      bannerParts.push(`${Math.min(webResults.length, TARGET_WEB_SLOTS)} web + ${dbCount} database (7+3 mix, ${serperQueries} Serper credit${serperQueries === 1 ? "" : "s"}).`);
      if (newWebCount > 0) {
        bannerParts.push(`${newWebCount} newly saved for next time.`);
      }
    }

    if (geminiFilterUsed) {
      bannerParts.push("Gemini AI verified results — listicles, threads, and outdated events removed.");
    } else if (geminiSkippedReason) {
      const skipMsg = quotaSkipMessage(geminiSkippedReason as "cooldown" | "spacing" | "daily_limit" | "no_table" | "ok");
      if (skipMsg) bannerParts.push(skipMsg);
    } else if (geminiKey && geminiNote) {
      bannerParts.push("Strict rule filters applied.");
      bannerParts.push(geminiNote);
    } else if (geminiKey) {
      bannerParts.push("Strict rule filters applied — no AI call needed.");
    }

    if (inferredTopics.length) {
      bannerParts.push(`Inferred from your interests: ${inferredTopics.join(", ")}.`);
    }

    if (competitions.length < TARGET_RESULTS) {
      bannerParts.push(
        `Only ${competitions.length} upcoming ${displayTopics.join(", ") || "topic"} matches in our database right now — see suggestions below.`,
      );
    }

    if (webErrors.length) {
      bannerParts.push(`${webErrors.length} save warning${webErrors.length === 1 ? "" : "s"} — check Edge Function logs.`);
    }

    return jsonResponse({
      competitions,
      suggestedCompetitions,
      topics: displayTopics,
      inferredTopics,
      hasExactMatches: competitions.length > 0,
      suggestedCount,
      webSearchUsed,
      webImportCount: newWebCount,
      newWebCount,
      webSearchHits: searchHits,
      serperQueries,
      geminiFilterUsed,
      geminiNote,
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
