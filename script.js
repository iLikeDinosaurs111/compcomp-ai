const { url: SUPABASE_URL, key: SUPABASE_KEY, legacyAnonKey, discoverFunction } =
  window.SUPABASE_CONFIG ?? {};

function validateBrowserKey(apiKey) {
  if (!apiKey || apiKey.includes("PASTE_YOUR")) {
    throw new Error(
      "Add your publishable or anon key to config.js (Supabase → Settings → API Keys)."
    );
  }

  if (apiKey.startsWith("sb_secret_") || apiKey.includes("service_role")) {
    throw new Error(
      "You are using a secret API key in the browser. Replace config.js key with your publishable (sb_publishable_...) or anon (eyJ...) key from Supabase → Settings → API Keys."
    );
  }
}

function normalizeSupabaseUrl(url) {
  return url.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
}

const SUPABASE_PROJECT_URL = normalizeSupabaseUrl(SUPABASE_URL ?? "");
const DISCOVER_FUNCTION_NAME = discoverFunction || "discover-competitions";

function getDiscoverFunctionUrl() {
  return `${SUPABASE_PROJECT_URL}/functions/v1/${DISCOVER_FUNCTION_NAME}`;
}

const form = document.getElementById("starter-form");
const getStartedSection = document.getElementById("get-started");
const getStartedInner = document.querySelector(".get-started__inner");
const getStartedTitle = document.querySelector(".get-started__title");
const resultsSection = document.getElementById("form-results");
const resultsBanner = document.getElementById("results-banner");
const resultsStatus = document.getElementById("results-status");
const resultsError = document.getElementById("results-error");
const competitionsGrid = document.getElementById("competitions-grid");
const suggestedSection = document.getElementById("competitions-suggested");
const suggestedGrid = document.getElementById("competitions-suggested-grid");
const editButton = document.getElementById("edit-form");
const submitButton = form.querySelector(".get-started__submit");
const defaultSubmitSlot = document.getElementById("default-submit-slot");
const otherSubmitSlot = document.getElementById("submit-slot");
const otherTopicCheckbox = document.getElementById("topic-other");
const otherTopicField = document.getElementById("other-topic-field");
const otherTopicInput = document.getElementById("other-topic-input");
const searchQueryInput = document.getElementById("search-query-input");
const resultsDisclaimer = document.getElementById("results-disclaimer");

let supabaseClient = null;
let activeSupabaseKey = SUPABASE_KEY;
let activeSubmitRequestId = 0;

function initSupabase(apiKey = activeSupabaseKey) {
  if (!SUPABASE_PROJECT_URL || !apiKey) {
    throw new Error("Missing Supabase URL or API key in config.js.");
  }

  validateBrowserKey(apiKey);

  if (!window.supabase?.createClient) {
    throw new Error("Supabase library failed to load.");
  }

  return window.supabase.createClient(SUPABASE_PROJECT_URL, apiKey);
}

try {
  supabaseClient = initSupabase();
} catch (error) {
  console.error("Supabase init failed:", error);
}

function syncOtherTopicField() {
  if (!otherTopicCheckbox || !otherTopicField) {
    return;
  }

  const isOtherSelected = otherTopicCheckbox.checked;
  otherTopicField.hidden = !isOtherSelected;
  form.classList.toggle("form--other-active", isOtherSelected);
  getStartedSection.classList.toggle("get-started--form-other", isOtherSelected);

  if (isOtherSelected && otherSubmitSlot && submitButton) {
    otherSubmitSlot.appendChild(submitButton);
  } else if (defaultSubmitSlot && submitButton) {
    defaultSubmitSlot.appendChild(submitButton);
  }

  if (isOtherSelected) {
    otherTopicInput?.focus();
  }
}

otherTopicCheckbox?.addEventListener("change", syncOtherTopicField);
syncOtherTopicField();

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatFetchError(error) {
  const message =
    error?.message ||
    error?.details ||
    error?.hint ||
    error?.code ||
    String(error);

  if (
    message === "Failed to fetch" ||
    error?.name === "TypeError" ||
    message.includes("NetworkError") ||
    message.includes("Load failed")
  ) {
    return `Could not reach Supabase at ${SUPABASE_PROJECT_URL}. Open Supabase → Project Settings → API and confirm your Project URL and publishable/anon key in config.js match exactly.`;
  }

  if (
    message.includes("permission denied") ||
    message.includes("42501") ||
    error?.code === "42501" ||
    error?.code === "PGRST301"
  ) {
    return "Supabase blocked the read. Run supabase-rls.sql in your Supabase SQL Editor to allow public reads on competitions.";
  }

  if (
    message.includes("does not exist") ||
    error?.code === "PGRST205" ||
    message.includes("Could not find the table")
  ) {
    return "The competitions table was not found. Confirm the table name in Supabase is exactly competitions.";
  }

  if (
    message.includes("Invalid API key") ||
    message.includes("JWT") ||
    message.includes("401")
  ) {
    return "Supabase rejected the API key. Copy the publishable or legacy anon key from Supabase → Settings → API Keys into config.js.";
  }

  return `We couldn't load competitions: ${message}`;
}

async function fetchCompetitionsViaRest(apiKey) {
  const response = await fetch(`${SUPABASE_PROJECT_URL}/rest/v1/competitions?select=*`, {
    method: "GET",
    cache: "no-store",
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Cache-Control": "no-cache",
    },
  });

  const bodyText = await response.text();

  if (!response.ok) {
    let message = bodyText;

    try {
      const parsed = JSON.parse(bodyText);
      message =
        parsed.message ||
        parsed.error_description ||
        parsed.error ||
        parsed.hint ||
        bodyText;
    } catch {
      message = bodyText || `HTTP ${response.status}`;
    }

    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return bodyText ? JSON.parse(bodyText).map((competition) => ({ ...competition })) : [];
}

async function fetchWithKey(apiKey) {
  if (supabaseClient && apiKey === activeSupabaseKey) {
    const { data, error } = await supabaseClient.from("competitions").select("*");

    if (!error) {
      return (data ?? []).map((competition) => ({ ...competition }));
    }

    console.warn("Supabase client fetch failed, retrying via REST:", error);
  }

  return fetchCompetitionsViaRest(apiKey);
}

async function fetchCompetitions() {
  try {
    return await fetchWithKey(activeSupabaseKey);
  } catch (error) {
    if (
      legacyAnonKey &&
      activeSupabaseKey !== legacyAnonKey &&
      (error.status === 401 || String(error.message).includes("JWT"))
    ) {
      activeSupabaseKey = legacyAnonKey;
      supabaseClient = initSupabase(legacyAnonKey);
      return fetchWithKey(legacyAnonKey);
    }

    throw error;
  }
}

async function discoverCompetitions(inputs) {
  const functionUrl = getDiscoverFunctionUrl();

  try {
    const response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: activeSupabaseKey,
        Authorization: `Bearer ${activeSupabaseKey}`,
      },
      body: JSON.stringify(inputs),
    });

    const payload = await response.json();

    if (!response.ok) {
      const message = payload.error || `Discovery failed (${response.status})`;
      if (response.status >= 400 && response.status < 500) {
        const clientError = new Error(message);
        clientError.isClientError = true;
        throw clientError;
      }
      throw new Error(message);
    }

    return payload;
  } catch (error) {
    if (error.isClientError) {
      throw error;
    }
    console.warn("Edge Function unavailable, using local matching fallback.", error);
    const allCompetitions = await fetchCompetitions();
    return DiscoveryMatching.discoverLocally(allCompetitions, inputs);
  }
}

function getFormInputs() {
  const data = new FormData(form);
  const searchQuery = data.get("search-query")?.trim() || "";
  const otherTopic = data.get("other-topic")?.trim() || "";
  const otherText = [searchQuery, otherTopic].filter(Boolean).join(" ").trim();

  return {
    age: data.get("age")?.trim() || "",
    grade: data.get("grade")?.trim() || "",
    location: data.get("location")?.trim() || "",
    format: data.get("format")?.trim() || "",
    selectedTopics: data.getAll("topics"),
    searchQuery,
    otherText,
  };
}

function getCompetitionField(competition, keys) {
  for (const key of keys) {
    const value = competition[key];
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return String(value);
    }
  }
  return "";
}

function fieldMatchesSearch(competition, searchValue, keys) {
  if (!searchValue) {
    return true;
  }

  const search = searchValue.toLowerCase();
  const fieldValue = getCompetitionField(competition, keys).toLowerCase();

  if (!fieldValue) {
    return false;
  }

  return fieldValue.includes(search) || search.includes(fieldValue);
}

const INTEREST_TOPICS = {
  Science: [
    "science",
    "sciences",
    "sciene",
    "scince",
    "biology",
    "chemistry",
    "physics",
    "lab",
    "laboratory",
    "experiment",
    "research",
    "nature",
    "environment",
    "science fair",
    "scientist",
    "medicine",
    "anatomy",
    "ecology",
    "astronomy",
    "space",
  ],
  Technology: [
    "technology",
    "technolgy",
    "tech",
    "coding",
    "code",
    "programming",
    "programing",
    "computer",
    "computers",
    "robotics",
    "robot",
    "software",
    "engineering",
    "engineer",
    "hackathon",
    "developer",
    "apps",
    "ai",
    "artificial intelligence",
    "building apps",
    "machine learning",
    "electronics",
    "hardware",
  ],
  Mathematics: [
    "mathematics",
    "mathematic",
    "math",
    "maths",
    "number",
    "numbers",
    "numerical",
    "calculus",
    "algebra",
    "geometry",
    "statistics",
    "working with numbers",
    "problem solving",
    "logic",
    "data",
    "equations",
    "counting",
    "quantitative",
    "actuary",
    "proofs",
  ],
  Arts: [
    "arts",
    "art",
    "music",
    "musical",
    "drawing",
    "paint",
    "painting",
    "creative",
    "creativity",
    "design",
    "theater",
    "theatre",
    "drama",
    "writing",
    "poetry",
    "film",
    "visual",
    "performing",
    "photography",
    "dance",
    "singing",
    "storytelling",
  ],
};

function levenshtein(a, b) {
  const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);

  for (let j = 0; j <= a.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i += 1) {
    for (let j = 1; j <= a.length; j += 1) {
      const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[b.length][a.length];
}

function normalizeInterestText(text) {
  return text.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

function textMatchesKeyword(text, keyword) {
  const normalizedText = normalizeInterestText(text);
  const normalizedKeyword = normalizeInterestText(keyword);

  if (!normalizedKeyword) {
    return false;
  }

  if (normalizedText.includes(normalizedKeyword)) {
    return true;
  }

  if (normalizedKeyword.includes(" ")) {
    return false;
  }

  const words = normalizedText.split(" ");

  return words.some((word) => {
    if (word.length < 3 || normalizedKeyword.length < 3) {
      return false;
    }

    const maxDistance =
      normalizedKeyword.length <= 4 ? 1 : normalizedKeyword.length <= 7 ? 2 : 3;

    return levenshtein(word, normalizedKeyword) <= maxDistance;
  });
}

function getActiveTopics(inputs) {
  return inputs.selectedTopics;
}

function getCompetitionSearchText(competition) {
  const keys = [
    "interest",
    "interests",
    "topic",
    "topics",
    "subject",
    "subjects",
    "category",
    "categories",
    "tags",
    "name",
    "title",
    "competition_name",
    "description",
    "details",
    "summary",
    "about",
  ];

  const parts = keys
    .map((key) => competition[key])
    .filter((value) => value !== null && value !== undefined && String(value).trim() !== "")
    .map((value) => String(value));

  return normalizeInterestText(parts.join(" "));
}

function competitionMatchesTopic(competition, topic, otherText = "") {
  if (topic === "Other") {
    return competitionMatchesOtherText(competition, otherText);
  }

  const searchText = getCompetitionSearchText(competition);
  const keywords = INTEREST_TOPICS[topic] ?? [];

  return (
    textMatchesKeyword(searchText, topic) ||
    keywords.some((keyword) => textMatchesKeyword(searchText, keyword))
  );
}

function competitionMatchesOtherText(competition, otherText) {
  if (!otherText) {
    return false;
  }

  const normalizedText = normalizeInterestText(otherText);
  const competitionText = getCompetitionSearchText(competition);
  const name = normalizeInterestText(
    getCompetitionField(competition, ["name", "title", "competition_name"]),
  );
  const link = normalizeInterestText(getCompetitionField(competition, ["link", "url"]));

  if (!competitionText || !normalizedText) {
    return false;
  }

  if (competitionText.includes(normalizedText) || link.includes(normalizedText.replace(/\s+/g, ""))) {
    return true;
  }

  const queryTokens = normalizedText.split(" ").filter((word) => word.length >= 2);
  const nameTokens = name.split(" ").filter((word) => word.length >= 2);
  const significant = queryTokens.filter((word) => word.length >= 3);

  if (significant.length) {
    const allSignificantMatch = significant.every(
      (token) =>
        textMatchesKeyword(competitionText, token) ||
        nameTokens.some((nameToken) => {
          if (token === nameToken || token.includes(nameToken) || nameToken.includes(token)) {
            return true;
          }
          const longer = Math.max(token.length, nameToken.length);
          const maxDistance = longer <= 5 ? 1 : longer <= 9 ? 2 : 3;
          return levenshtein(token, nameToken) <= maxDistance;
        }),
    );
    if (allSignificantMatch) return true;
  }

  if (normalizedText.length >= 5) {
    if (nameTokens.some((nameToken) => textMatchesKeyword(nameToken, normalizedText) || textMatchesKeyword(normalizedText, nameToken))) {
      return true;
    }
    if (textMatchesKeyword(name, normalizedText)) return true;
  }

  return queryTokens
    .filter((word) => word.length >= 3)
    .some((word) => textMatchesKeyword(competitionText, word));
}

function resolveCompetitionFormat(competition) {
  const name = getCompetitionField(competition, ["name", "title", "competition_name"]);
  const details = getCompetitionField(competition, ["description", "details", "summary", "about"]);
  const location = getCompetitionField(competition, ["location", "city", "region", "state"]);
  const link = getCompetitionField(competition, ["link", "url"]);
  const stored = getCompetitionField(competition, ["format", "delivery", "mode", "type"]).toLowerCase();
  const titleLower = name.toLowerCase();

  if (/devpost\.com/i.test(link)) {
    return "online";
  }
  if (/\bonline\b/.test(titleLower)) {
    return "online";
  }

  const inferred = inferFormatFromText(`${name} ${details} ${location}`);
  if (inferred === "online" || inferred === "in-person") {
    return inferred;
  }

  if (stored.includes("online") || stored.includes("virtual") || stored.includes("remote")) {
    return "online";
  }
  if (stored.includes("in-person") || stored.includes("in person")) {
    return "in-person";
  }
  if (stored.includes("both") || stored.includes("hybrid")) {
    return "both";
  }

  return stored || "both";
}

function competitionMatchesFormat(competition, format) {
  if (!format) {
    return true;
  }

  const competitionFormat = resolveCompetitionFormat(competition).toLowerCase();
  const text = `${getCompetitionField(competition, ["name", "title", "competition_name"])} ${getCompetitionField(competition, ["description", "details", "summary", "about"])}`.toLowerCase();
  const normalizedFormat = format.toLowerCase();

  if (normalizedFormat === "online") {
    if (competitionFormat.includes("online") || competitionFormat.includes("virtual") || competitionFormat.includes("remote")) {
      return true;
    }
    if (competitionFormat === "both" || competitionFormat.includes("hybrid")) {
      return /\bonline\b|\bvirtual\b|\bremote\b/.test(text);
    }
    return false;
  }

  if (normalizedFormat === "in-person") {
    if (competitionFormat.includes("in-person") || competitionFormat.includes("in person")) {
      return true;
    }
    if (competitionFormat === "both" || competitionFormat.includes("hybrid")) {
      if (/\bonline\b|\bvirtual\b|\bremote\b/.test(text) && !/\blocal (school|schools|chapter)\b/.test(text)) {
        return false;
      }
      return /\blocal (school|schools|chapter|test center)\b|\bin person\b|\bin-person\b/.test(text);
    }
    return false;
  }

  if (competitionFormat === "both" || competitionFormat.includes("hybrid")) {
    return true;
  }

  return competitionFormat.includes(normalizedFormat);
}

function filterByFormat(competitions, format) {
  if (!format) {
    return competitions;
  }

  return competitions.filter((competition) =>
    competitionMatchesFormat(competition, format)
  );
}

function normalizeCompetitionLink(url) {
  try {
    const parsed = new URL(String(url).trim());
    parsed.hash = "";
    parsed.search = "";
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${path}`;
  } catch {
    return String(url).trim().toLowerCase();
  }
}

function normalizeCompetitionName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(
      /\b(the|official|home|page|website|competition|contest|register|registration|national|student|students|high school|annual)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function getCompetitionId(competition) {
  const link = getCompetitionLink(competition);
  if (link) return normalizeCompetitionLink(link);

  const name = normalizeCompetitionName(
    getCompetitionField(competition, ["name", "title", "competition_name"]),
  );
  if (name.length >= 4) return `name:${name}`;

  return String(
    competition.id ??
      competition.uuid ??
      getCompetitionField(competition, ["name", "title", "competition_name"]),
  );
}

function dedupeCompetitionResults(competitions) {
  const seenIds = new Set();
  const seenNames = new Set();
  const deduped = [];

  for (const comp of competitions) {
    const id = getCompetitionId(comp);
    const nameKey = normalizeCompetitionName(
      getCompetitionField(comp, ["name", "title", "competition_name"]),
    );

    if (seenIds.has(id)) continue;
    if (nameKey.length >= 8 && seenNames.has(nameKey)) continue;

    seenIds.add(id);
    if (nameKey.length >= 8) seenNames.add(nameKey);
    deduped.push(comp);
  }

  return deduped;
}

function filterByProfile(competitions, inputs) {
  const { age, grade, location } = inputs;

  if (!age && !grade && !location) {
    return competitions;
  }

  return competitions.filter((competition) => {
    const ageMatch = fieldMatchesSearch(competition, age, [
      "age",
      "ages",
      "age_range",
      "min_age",
      "max_age",
      "eligible_ages",
    ]);

    const gradeMatch = fieldMatchesSearch(competition, grade, [
      "grade",
      "grades",
      "grade_level",
      "grade_range",
      "eligible_grades",
    ]);

    const locationMatch = fieldMatchesSearch(competition, location, [
      "location",
      "city",
      "region",
      "state",
      "address",
      "town",
    ]);

    return ageMatch && gradeMatch && locationMatch;
  });
}

function cloneCompetition(competition) {
  return { ...competition };
}

function matchCompetitionsForTopics(competitions, topics, otherText = "") {
  const results = [];
  const seen = new Set();
  const coverage = Object.fromEntries(topics.map((topic) => [topic, []]));

  for (const topic of topics) {
    for (const competition of competitions) {
      if (!competitionMatchesTopic(competition, topic, otherText)) {
        continue;
      }

      const competitionId = getCompetitionId(competition);
      coverage[topic].push(competition);

      if (!seen.has(competitionId)) {
        seen.add(competitionId);
        results.push({
          ...cloneCompetition(competition),
          _matchedTopics: [topic],
        });
        continue;
      }

      const existing = results.find(
        (item) => getCompetitionId(item) === competitionId
      );

      if (existing && !existing._matchedTopics.includes(topic)) {
        existing._matchedTopics.push(topic);
      }
    }
  }

  return { results, coverage };
}

function filterCompetitions(competitions, inputs) {
  const topics = getActiveTopics(inputs);
  const profilePool = filterByProfile(competitions, inputs);
  const exactPool = filterByFormat(profilePool, inputs.format);

  if (!topics.length) {
    return {
      competitions: [],
      topics: [],
      hasExactMatches: false,
      missingTopics: [],
    };
  }

  const { results, coverage } = matchCompetitionsForTopics(
    exactPool,
    topics,
    inputs.otherText
  );
  const missingTopics = topics.filter((topic) => coverage[topic].length === 0);

  return {
    competitions: results,
    topics,
    hasExactMatches: results.length > 0,
    missingTopics,
  };
}

function renderMapEmbed(competition) {
  const mapEmbed = getCompetitionField(competition, [
    "map_embed",
    "embed",
    "map_html",
  ]);
  const mapUrl = getCompetitionField(competition, [
    "map_url",
    "maps_url",
    "location_url",
  ]);

  if (mapEmbed) {
    return `<div class="comp-card__map">${mapEmbed}</div>`;
  }

  if (mapUrl) {
    return `<div class="comp-card__map">
      <iframe
        src="${escapeHtml(mapUrl)}"
        loading="lazy"
        referrerpolicy="no-referrer-when-downgrade"
        title="${escapeHtml(getCompetitionField(competition, ["name", "title"]) || "Map")}"
      ></iframe>
    </div>`;
  }

  return "";
}

function isSafeHttpUrl(value) {
  try {
    const parsed = new URL(String(value).trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isSafeImageUrl(value) {
  const text = String(value ?? "").trim();
  if (text.startsWith("data:image/")) return true;
  return isSafeHttpUrl(text);
}

function getCompetitionImage(competition) {
  const fromField = getCompetitionField(competition, [
    "image_url",
    "image",
    "img_url",
    "photo_url",
    "thumbnail",
    "thumbnail_url",
  ]);

  if (isSafeImageUrl(fromField) && !String(fromField).trim().startsWith("data:image/svg")) {
    return fromField;
  }

  const linkUrl = getCompetitionLink(competition);
  if (isSafeHttpUrl(linkUrl)) {
    try {
      const host = new URL(linkUrl).hostname;
      return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
    } catch {
      // ignore
    }
  }

  return "";
}

function getCompetitionLink(competition) {
  return getCompetitionField(competition, [
    "link",
    "info_link",
    "details_link",
    "competition_link",
    "website",
    "url",
  ]);
}

function renderCompetitionImage(competition, name) {
  const imageUrl = getCompetitionImage(competition);

  if (!isSafeImageUrl(imageUrl)) {
    return "";
  }

  return `
    <div class="comp-card__media">
      <img
        class="comp-card__image"
        src="${escapeHtml(imageUrl)}"
        alt="${escapeHtml(name || "Competition")}"
        loading="lazy"
        referrerpolicy="no-referrer"
      />
    </div>
  `;
}

function renderCompetitionLink(competition) {
  const linkUrl = getCompetitionLink(competition);

  if (!isSafeHttpUrl(linkUrl)) {
    return "";
  }

  return `
    <a
      class="comp-card__link"
      href="${escapeHtml(linkUrl)}"
      target="_blank"
      rel="noopener noreferrer"
    >
      View competition details
    </a>
  `;
}

function formatAgeLabel(age) {
  const value = String(age).trim();
  if (!value) {
    return "High school";
  }

  if (/^ages?\s/i.test(value)) {
    return value;
  }

  if (/high school|middle school|elementary|students?/i.test(value)) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  const rangeMatch = value.match(/(\d{1,2})\s*(?:to|-)\s*(\d{1,2})/);
  if (rangeMatch) {
    return `Ages ${rangeMatch[1]}-${rangeMatch[2]}`;
  }

  if (/^\d{1,2}\+$/.test(value)) {
    return `Ages ${value}`;
  }

  if (/^\d{1,2}$/.test(value)) {
    return `Ages ${value}`;
  }

  return value;
}

function inferAgeFromText(text) {
  const normalized = String(text).toLowerCase();
  const rangeMatch = normalized.match(/ages?\s*(\d{1,2})\s*(?:to|through|-)\s*(\d{1,2})/);
  if (rangeMatch) {
    return `Ages ${rangeMatch[1]}-${rangeMatch[2]}`;
  }

  const plusMatch = normalized.match(/ages?\s*(\d{1,2})\s*\+/);
  if (plusMatch) {
    return `Ages ${plusMatch[1]}+`;
  }

  if (/\bhigh school\b/.test(normalized)) {
    return "High school";
  }

  if (/\bmiddle school\b/.test(normalized)) {
    return "Middle school";
  }

  if (/\bstudents?\ only\b/.test(normalized)) {
    return "Students";
  }

  return "";
}

function inferLocationFromText(text, format = "") {
  const normalized = String(text).toLowerCase();
  if (/online|virtual|remote|devpost|nationwide|national|international|global/.test(normalized)) {
    if (/online|virtual|remote|devpost/.test(normalized) || /online/i.test(format)) {
      return "Online";
    }
    return "National";
  }
  return "";
}

function resolveCardAge(competition) {
  const fromField = getCompetitionField(competition, [
    "age",
    "ages",
    "age_range",
    "min_age",
    "max_age",
    "eligible_ages",
  ]);
  if (fromField) {
    return formatAgeLabel(fromField);
  }

  const text = [
    getCompetitionField(competition, ["name", "title", "competition_name"]),
    getCompetitionField(competition, ["description", "details", "summary", "about"]),
  ].join(" ");
  const inferred = inferAgeFromText(text);
  if (inferred) {
    return inferred;
  }

  const grade = getCompetitionField(competition, ["grade", "grades", "grade_level", "grade_range"]);
  if (grade) {
    return formatGradeLabel(grade);
  }

  return "High school";
}

function resolveCardLocation(competition) {
  const fromField = getCompetitionField(competition, [
    "location",
    "city",
    "region",
    "state",
    "address",
    "town",
  ]);
  if (fromField) {
    return fromField;
  }

  const format = getCompetitionField(competition, ["format", "delivery", "mode"]);
  const text = [
    getCompetitionField(competition, ["name", "title", "competition_name"]),
    getCompetitionField(competition, ["description", "details", "summary", "about"]),
    getCompetitionField(competition, ["link", "url"]),
  ].join(" ");
  const inferred = inferLocationFromText(text, format);
  if (inferred) {
    return inferred;
  }

  if (/online/i.test(format)) {
    return "Online";
  }

  return "National";
}

function formatGradeLabel(grade) {
  const value = String(grade).trim();
  if (!value) {
    return "";
  }

  if (/^grades?\s/i.test(value)) {
    return value;
  }

  return `Grades ${value}`;
}

function inferFormatFromText(text) {
  const normalized = String(text).toLowerCase();
  if (/\bonline\b|\bvirtual\b|\bremote\b|\bwebinar\b|\bzoom\b/.test(normalized)) {
    return "online";
  }
  if (/\bin person\b|\bin-person\b|\blocal (school|schools|chapter|test center|testing center)\b|\bonsite\b/.test(normalized)) {
    return "in-person";
  }
  return "both";
}

function resolveCardFormat(competition) {
  return formatFormatLabel(resolveCompetitionFormat(competition));
}

function formatFormatLabel(format) {
  const value = String(format).trim();
  if (!value) {
    return "";
  }

  if (/in[-\s]?person/i.test(value)) {
    return "In-person";
  }

  if (/online/i.test(value)) {
    return "Online";
  }

  if (/both|hybrid/i.test(value)) {
    return "Both";
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getDisplayTopic(competition) {
  const topicField = getCompetitionField(competition, [
    "topic",
    "topics",
    "subject",
    "category",
  ]);
  if (topicField) return topicField;
  const matched = competition._matchedTopics ?? [];
  return matched[0] ?? "";
}

function renderCompetitionCard(competition) {
  const name = getCompetitionField(competition, [
    "name",
    "title",
    "competition_name",
  ]);
  const description = getCompetitionField(competition, [
    "description",
    "details",
    "summary",
    "about",
  ]);
  const location = resolveCardLocation(competition);
  const age = resolveCardAge(competition);
  const grade = getCompetitionField(competition, [
    "grade",
    "grades",
    "grade_level",
    "grade_range",
  ]);
  const format = resolveCardFormat(competition);
  const schedule = getCompetitionField(competition, ["time", "date", "deadline"]);
  const displayTopic = getDisplayTopic(competition);
  const source = getCompetitionField(competition, ["source"]);
  const isNewWebResult = competition._isNewWeb === true;
  const isAlternative = competition._isAlternative === true;
  const isSuggested = competition._isSuggested === true;

  return `
    <article class="comp-card${isNewWebResult ? " comp-card--web" : ""}">
      ${renderCompetitionImage(competition, name)}
      <header class="comp-card__header">${escapeHtml(name || "Competition")}</header>
      <div class="comp-card__meta">
        ${isNewWebResult ? `<span class="comp-card__tag comp-card__tag--source">Found online</span>` : ""}
        ${isSuggested ? `<span class="comp-card__tag comp-card__tag--suggested">May not match</span>` : ""}
        ${isAlternative ? `<span class="comp-card__tag comp-card__tag--alt">Similar match</span>` : ""}
        ${displayTopic ? `<span class="comp-card__tag comp-card__tag--topic">${escapeHtml(displayTopic)}</span>` : ""}
        <span class="comp-card__tag comp-card__tag--age">${escapeHtml(age)}</span>
        ${grade ? `<span class="comp-card__tag comp-card__tag--grade">${escapeHtml(formatGradeLabel(grade))}</span>` : ""}
        ${format ? `<span class="comp-card__tag comp-card__tag--format">${escapeHtml(formatFormatLabel(format))}</span>` : ""}
        ${schedule ? `<span class="comp-card__tag comp-card__tag--time">${escapeHtml(schedule)}</span>` : ""}
        <span class="comp-card__tag comp-card__tag--location">${escapeHtml(location)}</span>
      </div>
      <p class="comp-card__body">${escapeHtml(description || "Details coming soon.")}</p>
      ${renderCompetitionLink(competition)}
      ${renderMapEmbed(competition)}
    </article>
  `;
}

function renderCompetitions(competitions, topics = [], options = {}) {
  competitionsGrid.replaceChildren();
  if (suggestedGrid) suggestedGrid.replaceChildren();
  if (suggestedSection) suggestedSection.hidden = true;

  const uniqueCompetitions = dedupeCompetitionResults(competitions);
  const capped = uniqueCompetitions.slice(0, DiscoveryMatching.MAX_RESULTS);
  const suggestedCompetitions = dedupeCompetitionResults(options.suggestedCompetitions ?? []);

  if (!options.hasExactMatches) {
    competitionsGrid.innerHTML = `
      <p class="competitions-empty">No exact matches found. Try adjusting your grade, location, format, or topics.</p>
    `;
    if (suggestedCompetitions.length && suggestedGrid && suggestedSection) {
      suggestedSection.hidden = false;
      suggestedGrid.innerHTML = suggestedCompetitions
        .map((competition) => renderCompetitionCard(competition))
        .join("");
    }
    return;
  }

  if (!capped.length) {
    competitionsGrid.innerHTML = `
      <p class="competitions-empty">No exact matches found. Try adjusting your grade, location, format, or topics.</p>
    `;
  } else if (topics.length > 1) {
    competitionsGrid.innerHTML = topics
      .map((topic) => {
        const topicCompetitions = capped.filter((competition) =>
          competition._matchedTopics?.includes(topic)
        );

        if (!topicCompetitions.length) {
          return `
            <section class="comp-topic-section">
              <h4 class="comp-topic-section__title">${escapeHtml(topic)}</h4>
              <p class="competitions-empty">No competitions found for this topic yet.</p>
            </section>
          `;
        }

        return `
          <section class="comp-topic-section">
            <h4 class="comp-topic-section__title">${escapeHtml(topic)}</h4>
            <div class="competitions-grid competitions-grid--nested">
              ${topicCompetitions.map((competition) => renderCompetitionCard(competition)).join("")}
            </div>
          </section>
        `;
      })
      .join("");
  } else {
    competitionsGrid.innerHTML = capped
      .map((competition) => renderCompetitionCard(competition))
      .join("");
  }

  if (suggestedCompetitions.length && suggestedGrid && suggestedSection) {
    suggestedSection.hidden = false;
    suggestedGrid.innerHTML = suggestedCompetitions
      .map((competition) => renderCompetitionCard(competition))
      .join("");
  }
}

function setResultsLoading(isLoading, message = "Finding competitions…") {
  resultsStatus.hidden = !isLoading;
  resultsStatus.textContent = message;
  submitButton.disabled = isLoading;
}

function resetResultsView() {
  resultsBanner.hidden = true;
  resultsBanner.textContent = "";
  resultsStatus.hidden = true;
  resultsError.hidden = true;
  resultsError.textContent = "";
  if (resultsDisclaimer) resultsDisclaimer.hidden = true;
  competitionsGrid.innerHTML = "";
  if (suggestedGrid) suggestedGrid.innerHTML = "";
  if (suggestedSection) suggestedSection.hidden = true;
}

function showResultsView() {
  getStartedSection.classList.add("get-started--results");
  getStartedInner.classList.add("get-started__inner--wide");
  getStartedTitle.hidden = true;
  form.hidden = true;
  resultsSection.hidden = false;
}

function hideResultsView() {
  getStartedSection.classList.remove("get-started--results");
  getStartedInner.classList.remove("get-started__inner--wide");
  getStartedTitle.hidden = false;
  resultsSection.hidden = true;
  form.hidden = false;
  resetResultsView();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const submitRequestId = ++activeSubmitRequestId;
  const inputs = getFormInputs();

  if (!inputs.selectedTopics.length && !inputs.otherText) {
    showResultsView();
    resetResultsView();
    resultsBanner.hidden = false;
    resultsBanner.textContent =
      "Select at least one topic or type a search (e.g. Steminate hackathon).";
    renderCompetitions([], [], { hasExactMatches: false });
    return;
  }

  if (inputs.selectedTopics.includes("Other") && !inputs.otherText) {
    showResultsView();
    resetResultsView();
    syncOtherTopicField();
    resultsBanner.hidden = false;
    resultsBanner.textContent =
      "You selected Other — add details in the search box or Other field.";
    renderCompetitions([], [], { hasExactMatches: false });
    return;
  }

  if (!supabaseClient) {
    try {
      supabaseClient = initSupabase();
    } catch (error) {
      console.warn("Supabase client unavailable, using REST fallback.", error);
    }
  }

  showResultsView();
  resetResultsView();
  setResultsLoading(true, "Searching database and web…");

  try {
    const discovery = await discoverCompetitions(inputs);

    if (submitRequestId !== activeSubmitRequestId) {
      return;
    }

    const {
      competitions: matchedCompetitions,
      suggestedCompetitions = [],
      topics = inputs.selectedTopics.filter((t) => t !== "Other"),
      hasExactMatches = matchedCompetitions.length > 0,
      banner = "",
      inferredTopics = [],
    } = discovery;

    const bannerMessages = [];

    if (banner) {
      bannerMessages.push(banner);
    } else {
      if (hasExactMatches && topics.length) {
        bannerMessages.push(`Showing competitions for: ${topics.join(", ")}.`);
      }
      if (inferredTopics.length) {
        bannerMessages.push(`Inferred from your interests: ${inferredTopics.join(", ")}.`);
      }
      if (!hasExactMatches) {
        bannerMessages.push(
          "No exact matches found. Try adjusting your grade, location, format, or topics.",
        );
      }
    }

    if (bannerMessages.length) {
      resultsBanner.hidden = false;
      resultsBanner.textContent = bannerMessages.join(" ");
    }

    if (resultsDisclaimer) {
      resultsDisclaimer.hidden = false;
    }

    renderCompetitions(matchedCompetitions, topics, {
      hasExactMatches: matchedCompetitions.length > 0,
      suggestedCompetitions,
    });
  } catch (error) {
    if (submitRequestId !== activeSubmitRequestId) {
      return;
    }

    console.error("Supabase fetch failed:", error);
    resultsError.hidden = false;
    resultsError.textContent = formatFetchError(error);
  } finally {
    if (submitRequestId === activeSubmitRequestId) {
      setResultsLoading(false);
    }
  }
});

editButton.addEventListener("click", () => {
  activeSubmitRequestId += 1;
  hideResultsView();
  syncOtherTopicField();
});
