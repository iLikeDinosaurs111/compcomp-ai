export const TARGET_RESULTS = 10;
export const MAX_RESULTS = 10;
/** @deprecated use TARGET_RESULTS */
export const MIN_RESULTS = TARGET_RESULTS;

export interface FormInputs {
  age: string;
  grade: string;
  location: string;
  format: string;
  selectedTopics: string[];
  otherText: string;
}

export interface ScoredCompetition {
  competition: Record<string, unknown>;
  score: number;
  matchedTopics: string[];
}

export const INTEREST_TOPICS: Record<string, string[]> = {
  Science: [
    "science", "sciences", "biology", "chemistry", "physics",
    "lab", "laboratory", "experiment", "research", "nature", "environment",
    "science fair", "scientist", "medicine", "anatomy", "ecology", "astronomy", "space",
  ],
  Technology: [
    "technology", "tech", "coding", "programming", "computer", "computers",
    "robotics", "robot", "software", "engineering", "engineer",
    "hackathon", "developer", "apps", "artificial intelligence",
    "machine learning", "electronics", "hardware", "esports",
  ],
  Mathematics: [
    "mathematics", "math", "maths", "calculus", "algebra", "geometry", "statistics",
    "quantitative", "actuary", "proofs", "finance", "financial", "investing",
    "stock market", "accounting", "budgeting", "economics", "olympiad",
  ],
  Arts: [
    "arts", "art", "music", "musical", "drawing", "painting", "creative",
    "design", "theater", "theatre", "drama", "writing", "poetry", "poem",
    "recitation", "out loud", "film", "visual", "performing", "photography",
    "dance", "singing", "storytelling", "debate", "public speaking", "speech",
  ],
  Finance: [
    "finance", "financial", "investing", "investment", "stocks", "stock market",
    "accounting", "budgeting", "economics", "trading", "portfolio",
  ],
};

/** When the DB topic column is set, it is the source of truth for categorization. */
const TOPIC_FIELD_ALIASES: Record<string, string> = {
  science: "Science",
  sciences: "Science",
  technology: "Technology",
  tech: "Technology",
  mathematics: "Mathematics",
  math: "Mathematics",
  maths: "Mathematics",
  arts: "Arts",
  art: "Arts",
  music: "Arts",
  poetry: "Arts",
  drama: "Arts",
  finance: "Finance",
  financial: "Finance",
  economics: "Finance",
  stem: "Science",
};

const TOPIC_NEGATIVE_KEYWORDS: Record<string, string[]> = {
  Mathematics: [
    "poetry", "poem", "recitation", "out loud", "spoken word", "music", "drama",
    "theater", "theatre", "dance", "art competition", "writing competition",
    "scholastic art", " art ", "writing awards", "creative writing", "history day",
    "debate", "literature", "humanities", "business", "marketing", "entrepreneurship",
    "deca", "career development", "computing olympiad", "usaco", "programming contest",
    "coding competition", "biology", "chemistry",
  ],
  Science: ["poetry", "poem", "music", "debate", "history day", "art competition"],
  Technology: ["poetry", "poem", "music", "dance", "history day"],
  Arts: ["calculus", "algebra", "geometry", "olympiad", "hackathon", "robotics", "programming"],
  Finance: ["poetry", "poem", "music", "dance", "science fair", "biology"],
};

export function getCanonicalTopicFromField(competition: Record<string, unknown>): string | null {
  const topicField = normalizeInterestText(
    getCompetitionField(competition, ["topic", "topics", "subject", "category"]),
  );
  if (!topicField) return null;

  if (TOPIC_FIELD_ALIASES[topicField]) {
    return TOPIC_FIELD_ALIASES[topicField];
  }

  for (const [alias, canonical] of Object.entries(TOPIC_FIELD_ALIASES)) {
    if (topicField.includes(alias)) return canonical;
  }

  for (const canonical of ["Science", "Technology", "Mathematics", "Arts", "Finance"]) {
    if (textMatchesKeyword(topicField, canonical)) return canonical;
  }

  return null;
}

function topicConflictsWithNegativeSignals(topic: string, searchText: string): boolean {
  const negatives = TOPIC_NEGATIVE_KEYWORDS[topic] ?? [];
  return negatives.some((phrase) => searchText.includes(normalizeInterestText(phrase)));
}

export const OTHER_INFERENCE_MAP: { phrases: string[]; topics: string[] }[] = [
  { phrases: ["counting", "numbers", "budgeting", "math", "algebra", "calculus"], topics: ["Mathematics"] },
  { phrases: ["investing", "stocks", "finance", "financial", "accounting", "economics", "trading"], topics: ["Mathematics", "Finance"] },
  { phrases: ["debate", "public speaking", "speech", "oratory"], topics: ["Arts"] },
  { phrases: ["chess", "esports", "gaming", "video game"], topics: ["Technology"] },
  { phrases: ["coding", "programming", "robotics", "hackathon", "computer"], topics: ["Technology"] },
  { phrases: ["biology", "chemistry", "physics", "science fair", "research"], topics: ["Science"] },
  { phrases: ["music", "art", "dance", "theater", "writing", "poetry", "film"], topics: ["Arts"] },
];

const US_STATE_ABBREVS: Record<string, string> = {
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca",
  colorado: "co", connecticut: "ct", delaware: "de", florida: "fl", georgia: "ga",
  hawaii: "hi", idaho: "id", illinois: "il", indiana: "in", iowa: "ia", kansas: "ks",
  kentucky: "ky", louisiana: "la", maine: "me", maryland: "md", massachusetts: "ma",
  michigan: "mi", minnesota: "mn", mississippi: "ms", missouri: "mo", montana: "mt",
  nebraska: "ne", nevada: "nv", "new hampshire": "nh", "new jersey": "nj",
  "new mexico": "nm", "new york": "ny", "north carolina": "nc", "north dakota": "nd",
  ohio: "oh", oklahoma: "ok", oregon: "or", pennsylvania: "pa", "rhode island": "ri",
  "south carolina": "sc", "south dakota": "sd", tennessee: "tn", texas: "tx",
  utah: "ut", vermont: "vt", virginia: "va", washington: "wa", "west virginia": "wv",
  wisconsin: "wi", wyoming: "wy",
};

export function levenshtein(a: string, b: string): number {
  const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= a.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i += 1) {
    for (let j = 1; j <= a.length; j += 1) {
      const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[b.length][a.length];
}

export function normalizeInterestText(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function textMatchesKeyword(text: string, keyword: string): boolean {
  const normalizedText = normalizeInterestText(text);
  const normalizedKeyword = normalizeInterestText(keyword);
  if (!normalizedKeyword) return false;
  if (normalizedText.includes(normalizedKeyword)) return true;
  if (normalizedKeyword.includes(" ")) return false;
  const words = normalizedText.split(" ");
  return words.some((word) => {
    if (word.length < 3 || normalizedKeyword.length < 3) return false;
    const maxDistance = normalizedKeyword.length <= 4 ? 1 : normalizedKeyword.length <= 7 ? 2 : 3;
    return levenshtein(word, normalizedKeyword) <= maxDistance;
  });
}

export function getCompetitionField(competition: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = competition[key];
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return String(value);
    }
  }
  return "";
}

export function getCompetitionSearchText(competition: Record<string, unknown>): string {
  const keys = [
    "interest", "interests", "topic", "topics", "subject", "subjects",
    "category", "categories", "tags", "name", "title", "competition_name",
    "description", "details", "summary", "about",
  ];
  const parts = keys
    .map((key) => competition[key])
    .filter((value) => value !== null && value !== undefined && String(value).trim() !== "")
    .map((value) => String(value));
  return normalizeInterestText(parts.join(" "));
}

export function inferTopicsFromOtherText(otherText: string): string[] {
  if (!otherText.trim()) return [];
  const inferred = new Set<string>();
  const normalized = normalizeInterestText(otherText);

  for (const entry of OTHER_INFERENCE_MAP) {
    for (const phrase of entry.phrases) {
      if (textMatchesKeyword(normalized, phrase) || normalized.includes(normalizeInterestText(phrase))) {
        entry.topics.forEach((t) => inferred.add(t));
      }
    }
  }

  for (const [topic, keywords] of Object.entries(INTEREST_TOPICS)) {
    if (topic === "Finance") continue;
    if (textMatchesKeyword(normalized, topic) || keywords.some((kw) => textMatchesKeyword(normalized, kw))) {
      inferred.add(topic);
    }
  }

  return [...inferred];
}

export function inferTopicsFromInputs(inputs: FormInputs): {
  topics: string[];
  inferredTopics: string[];
} {
  const selected = inputs.selectedTopics.filter((t) => t !== "Other");
  const inferredFromOther = inputs.selectedTopics.includes("Other")
    ? inferTopicsFromOtherText(inputs.otherText)
    : [];

  const allTopics = [...new Set([...selected, ...inferredFromOther])];
  const inferredTopics = inferredFromOther.filter((t) => !selected.includes(t));

  return { topics: allTopics.length ? allTopics : selected, inferredTopics };
}

export function competitionMatchesOtherText(competition: Record<string, unknown>, otherText: string): boolean {
  if (!otherText) return false;
  const normalizedText = normalizeInterestText(otherText);
  const competitionText = getCompetitionSearchText(competition);
  if (!competitionText || !normalizedText) return false;
  if (competitionText.includes(normalizedText) || normalizedText.includes(competitionText)) return true;
  const searchWords = normalizedText.split(" ").filter((word) => word.length >= 3);
  return searchWords.some((word) => textMatchesKeyword(competitionText, word));
}

export function competitionMatchesTopic(
  competition: Record<string, unknown>,
  topic: string,
  otherText = "",
): boolean {
  if (topic === "Other") return competitionMatchesOtherText(competition, otherText);

  const searchText = getCompetitionSearchText(competition);
  if (topicConflictsWithNegativeSignals(topic, searchText)) return false;

  const canonicalField = getCanonicalTopicFromField(competition);
  if (canonicalField) {
    if (topic === "Finance") {
      return canonicalField === "Finance" || canonicalField === "Mathematics";
    }
    return canonicalField === topic;
  }

  const keywords = INTEREST_TOPICS[topic] ?? [];
  const strongHit = keywords.some((keyword) => {
    if (keyword.length < 4) return false;
    return textMatchesKeyword(searchText, keyword);
  });

  if (strongHit) return true;

  return textMatchesKeyword(searchText, topic);
}

function normalizeLocation(text: string): string {
  let normalized = normalizeInterestText(text);
  for (const [name, abbrev] of Object.entries(US_STATE_ABBREVS)) {
    normalized = normalized.replace(new RegExp(`\\b${name}\\b`, "g"), abbrev);
  }
  return normalized;
}

const NATIONAL_LOCATION_SIGNALS = [
  "national", "nationwide", "international", "global", "virtual", "online", "remote",
  "anywhere", "all states", "multi state", "multistate",
];

function extractStates(text: string): string[] {
  const normalized = normalizeLocation(text);
  const states = new Set<string>();
  for (const [name, abbrev] of Object.entries(US_STATE_ABBREVS)) {
    if (new RegExp(`\\b${name}\\b`).test(normalized) || new RegExp(`\\b${abbrev}\\b`).test(normalized)) {
      states.add(abbrev);
    }
  }
  return [...states];
}

function isOnlineOrNationalCompetition(
  competition: Record<string, unknown>,
  searchText: string,
): boolean {
  const compFormat = getCompetitionField(competition, ["format", "delivery", "mode", "type"]).toLowerCase();
  const compLoc = getCompetitionField(competition, ["location", "city", "region", "state", "address", "town"]).toLowerCase();
  const combined = `${searchText} ${compLoc} ${compFormat}`;

  if (compFormat.includes("online") || compFormat.includes("virtual") || compFormat.includes("remote")) {
    return true;
  }
  return NATIONAL_LOCATION_SIGNALS.some((signal) => combined.includes(signal));
}

export function locationMatchesUser(
  competition: Record<string, unknown>,
  userLocation: string,
  userFormat = "",
): boolean {
  if (!userLocation.trim()) return true;

  const compLoc = getCompetitionField(competition, ["location", "city", "region", "state", "address", "town"]);
  const searchText = getCompetitionSearchText(competition);
  const onlineNational = isOnlineOrNationalCompetition(competition, searchText);
  const userWantsOnline = userFormat === "online";
  const userWantsInPerson = userFormat === "in-person";

  if (onlineNational && userWantsOnline) return true;
  if (onlineNational && !userWantsInPerson && !compLoc) return true;

  if (!compLoc) {
    return false;
  }

  const userStates = extractStates(userLocation);
  const compStates = extractStates(compLoc);

  if (userStates.length && compStates.length && !userStates.some((s) => compStates.includes(s))) {
    return false;
  }

  const userNorm = normalizeLocation(userLocation);
  const locNorm = normalizeLocation(compLoc);

  if (locNorm.includes(userNorm) || userNorm.includes(locNorm)) return true;

  const userTokens = userNorm.split(" ").filter((t) => t.length >= 2 && !Object.values(US_STATE_ABBREVS).includes(t));
  const locTokens = locNorm.split(" ").filter((t) => t.length >= 2 && !Object.values(US_STATE_ABBREVS).includes(t));

  for (const ut of userTokens) {
    if (ut.length < 3) continue;
    for (const lt of locTokens) {
      if (lt.length < 3) continue;
      if (ut === lt || levenshtein(ut, lt) <= 1) return true;
    }
  }

  if (userStates.length && compStates.length && userStates.some((s) => compStates.includes(s))) {
    return userTokens.length === 0;
  }

  return false;
}

function parseAgeNumber(value: string): number | null {
  const match = String(value).match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

function parseAgeRange(text: string): { min: number; max: number } | null {
  const normalized = normalizeInterestText(text);
  const rangeMatch = normalized.match(/(\d+)\s*(?:to|-)\s*(\d+)/);
  if (rangeMatch) return { min: parseInt(rangeMatch[1], 10), max: parseInt(rangeMatch[2], 10) };
  const plusMatch = normalized.match(/(?:ages?\s*)?(\d+)\s*\+/);
  if (plusMatch) return { min: parseInt(plusMatch[1], 10), max: 99 };
  const single = normalized.match(/\b(\d{1,2})\b/);
  if (single) {
    const n = parseInt(single[1], 10);
    return { min: n, max: n };
  }
  return null;
}

function scoreAge(competition: Record<string, unknown>, userAge: string): number {
  if (!userAge) return 1;
  const ageNum = parseAgeNumber(userAge);
  if (ageNum === null) {
    return fieldMatchesSearch(competition, userAge, ["age", "ages", "age_range", "min_age", "max_age", "eligible_ages"]) ? 1 : 0.3;
  }
  const ageText = getCompetitionField(competition, ["age", "ages", "age_range", "min_age", "max_age", "eligible_ages", "details", "description"]);
  if (!ageText) return 0.7;
  const range = parseAgeRange(ageText);
  if (!range) return fieldMatchesSearch(competition, userAge, ["age", "ages", "age_range", "min_age", "max_age", "eligible_ages"]) ? 1 : 0.3;
  if (ageNum >= range.min && ageNum <= range.max) return 1;
  if (ageNum >= range.min - 2 && ageNum <= range.max + 2) return 0.5;
  return 0;
}

function parseGradeNumber(text: string): number | null {
  const match = String(text).match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

function parseGradeRange(text: string): { min: number; max: number } | null {
  const normalized = normalizeInterestText(text);
  const rangeMatch = normalized.match(/(?:grades?\s*)?(\d+)\s*(?:to|-)\s*(\d+)/);
  if (rangeMatch) return { min: parseInt(rangeMatch[1], 10), max: parseInt(rangeMatch[2], 10) };
  const single = normalized.match(/(?:grade\s*)?(\d{1,2})(?:th|rd|nd|st)?/);
  if (single) {
    const n = parseInt(single[1], 10);
    return { min: n, max: n };
  }
  return null;
}

function scoreGrade(competition: Record<string, unknown>, userGrade: string): number {
  if (!userGrade) return 1;
  const gradeNum = parseGradeNumber(userGrade);
  const gradeText = getCompetitionField(competition, ["grade", "grades", "grade_level", "grade_range", "eligible_grades", "details"]);
  if (!gradeText) return 0.7;
  if (gradeNum === null) {
    return fieldMatchesSearch(competition, userGrade, ["grade", "grades", "grade_level", "grade_range", "eligible_grades"]) ? 1 : 0.3;
  }
  const range = parseGradeRange(gradeText);
  if (!range) return fieldMatchesSearch(competition, userGrade, ["grade", "grades", "grade_level", "grade_range", "eligible_grades"]) ? 1 : 0.3;
  if (gradeNum >= range.min && gradeNum <= range.max) return 1;
  if (gradeNum >= range.min - 1 && gradeNum <= range.max + 1) return 0.5;
  return 0;
}

function fieldMatchesSearch(competition: Record<string, unknown>, searchValue: string, keys: string[]): boolean {
  if (!searchValue) return true;
  const search = searchValue.toLowerCase();
  const fieldValue = getCompetitionField(competition, keys).toLowerCase();
  if (!fieldValue) return false;
  return fieldValue.includes(search) || search.includes(fieldValue);
}

function scoreLocation(competition: Record<string, unknown>, userLocation: string, userFormat = ""): number {
  if (!userLocation) return 1;
  if (!locationMatchesUser(competition, userLocation, userFormat)) return 0;
  const userNorm = normalizeLocation(userLocation);
  const locText = normalizeLocation(
    getCompetitionField(competition, ["location", "city", "region", "state", "address", "town"]),
  );
  if (!locText) return 0.6;
  if (locText.includes(userNorm) || userNorm.includes(locText)) return 1;
  const userTokens = userNorm.split(" ").filter((t) => t.length >= 3);
  const locTokens = locText.split(" ").filter((t) => t.length >= 3);
  for (const ut of userTokens) {
    for (const lt of locTokens) {
      if (ut === lt) return 1;
      if (ut.length >= 3 && lt.length >= 3 && levenshtein(ut, lt) <= 1) return 0.9;
    }
  }
  const userStates = extractStates(userLocation);
  const compStates = extractStates(locText);
  if (userStates.length && compStates.some((s) => userStates.includes(s))) return 0.75;
  return 0;
}

export function scoreFormat(competition: Record<string, unknown>, format: string): number {
  if (!format) return 1;
  const competitionFormat = getCompetitionField(competition, ["format", "delivery", "mode", "type"]).toLowerCase();
  if (!competitionFormat) return 0.7;
  if (competitionFormat.includes("both") || competitionFormat.includes("hybrid")) return 1;
  const normalizedFormat = format.toLowerCase();
  if (normalizedFormat === "online") {
    return competitionFormat.includes("online") || competitionFormat.includes("virtual") || competitionFormat.includes("remote") ? 1 : 0;
  }
  if (normalizedFormat === "in-person") {
    return competitionFormat.includes("in-person") || competitionFormat.includes("in person") || competitionFormat.includes("person") ? 1 : 0;
  }
  return competitionFormat.includes(normalizedFormat) ? 1 : 0;
}

export function getMatchedTopicsForCompetition(
  competition: Record<string, unknown>,
  topics: string[],
  otherText: string,
): string[] {
  const matched: string[] = [];
  for (const topic of topics) {
    if (topic === "Other") {
      if (competitionMatchesOtherText(competition, otherText)) matched.push("Other");
    } else if (competitionMatchesTopic(competition, topic, otherText)) {
      matched.push(topic);
    }
  }
  if (inputsHasOtherWithInference(topics, otherText) && matched.length === 0) {
    if (competitionMatchesOtherText(competition, otherText)) matched.push("Other");
  }
  return matched;
}

function inputsHasOtherWithInference(topics: string[], otherText: string): boolean {
  return topics.includes("Other") && Boolean(otherText);
}

export function scoreCompetition(
  competition: Record<string, unknown>,
  inputs: FormInputs,
  topics: string[],
): ScoredCompetition | null {
  const matchedTopics = getMatchedTopicsForCompetition(competition, topics, inputs.otherText);
  const effectiveTopics = topics.filter((t) => t !== "Other");
  const topicDenominator = Math.max(effectiveTopics.length, 1);

  const hasOtherOnly = topics.includes("Other") && effectiveTopics.length === 0;
  const topicScore = hasOtherOnly
    ? (matchedTopics.length > 0 ? 1 : 0)
    : matchedTopics.filter((t) => t !== "Other").length / topicDenominator;

  if (topicScore === 0 && !hasOtherOnly) return null;

  const formatScore = scoreFormat(competition, inputs.format);
  if (inputs.format && formatScore === 0) return null;

  if (inputs.location && !locationMatchesUser(competition, inputs.location, inputs.format)) {
    return null;
  }

  const ageScore = scoreAge(competition, inputs.age);
  const gradeScore = scoreGrade(competition, inputs.grade);
  const locationScore = scoreLocation(competition, inputs.location, inputs.format);

  let profileWeight = 0;
  let profileSum = 0;
  if (inputs.age) { profileWeight += 1; profileSum += ageScore; }
  if (inputs.grade) { profileWeight += 1; profileSum += gradeScore; }
  if (inputs.location) { profileWeight += 1; profileSum += locationScore; }
  const profileScore = profileWeight ? profileSum / profileWeight : 0.5;

  const source = getCompetitionField(competition, ["source"]) || "manual";
  const supabaseBonus = source !== "web" ? 0.15 : 0;

  const score =
    topicScore * 0.45 +
    profileScore * 0.3 +
    formatScore * 0.15 +
    supabaseBonus +
    (topicScore > 0 ? 0.1 : 0);

  if (score <= 0) return null;

  if (!matchedTopics.length) return null;

  return {
    competition: { ...competition, _matchedTopics: matchedTopics },
    score,
    matchedTopics,
  };
}

export function getUserSearchTopics(inputs: FormInputs): string[] {
  const selected = inputs.selectedTopics.filter((t) => t !== "Other");
  if (selected.length) return selected;
  const { topics } = inferTopicsFromInputs(inputs);
  return topics;
}

export function rankCompetitions(
  competitions: Record<string, unknown>[],
  inputs: FormInputs,
): ScoredCompetition[] {
  const userTopics = getUserSearchTopics(inputs);
  const searchTopics = inputs.selectedTopics.includes("Other")
    ? [...userTopics, "Other"]
    : userTopics;
  const uniqueTopics = [...new Set(searchTopics)];

  const scored: ScoredCompetition[] = [];
  const seen = new Set<string>();

  for (const competition of competitions) {
    const id = getCompetitionId(competition);
    if (seen.has(id)) continue;
    const result = scoreCompetition(competition, inputs, uniqueTopics);
    if (result) {
      seen.add(id);
      scored.push(result);
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

export function getCompetitionId(competition: Record<string, unknown>): string {
  return String(
    competition.id ??
      competition.uuid ??
      getCompetitionField(competition, ["name", "title", "competition_name", "link"]),
  );
}

export function selectTopCompetitions(scored: ScoredCompetition[]): Record<string, unknown>[] {
  const top = scored.slice(0, MAX_RESULTS).map((s) => s.competition);
  return top;
}

export function inferTopicFromText(text: string): string {
  const normalized = normalizeInterestText(text);
  for (const [topic, keywords] of Object.entries(INTEREST_TOPICS)) {
    if (topic === "Finance") continue;
    if (topicConflictsWithNegativeSignals(topic, normalized)) continue;
    if (textMatchesKeyword(normalized, topic)) return topic;
    if (keywords.some((kw) => kw.length >= 4 && textMatchesKeyword(normalized, kw))) return topic;
  }
  return "Science";
}

export function inferBestTopicForUser(text: string, userTopics: string[]): string | null {
  const stub = { name: text, details: text, topic: "", description: text };
  for (const topic of userTopics) {
    if (topic === "Other") continue;
    if (competitionMatchesTopic(stub, topic, "")) return topic;
  }
  const inferred = inferTopicFromText(text);
  if (userTopics.includes(inferred)) return inferred;
  if (userTopics.includes("Finance") && inferred === "Mathematics") return "Finance";
  return null;
}

export function inferFormatFromText(text: string): string {
  const normalized = normalizeInterestText(text);
  if (normalized.includes("online") || normalized.includes("virtual") || normalized.includes("remote")) return "online";
  if (normalized.includes("in person") || normalized.includes("in-person")) return "in-person";
  return "both";
}
