/* Shared competition matching logic (browser fallback when Edge Function unavailable). */
const DiscoveryMatching = (() => {
  const MIN_RESULTS = 3;
  const MAX_RESULTS = 10;

  const INTEREST_TOPICS = {
    Science: [
      "science", "sciences", "sciene", "scince", "biology", "chemistry", "physics",
      "lab", "laboratory", "experiment", "research", "nature", "environment",
      "science fair", "scientist", "medicine", "anatomy", "ecology", "astronomy", "space",
    ],
    Technology: [
      "technology", "technolgy", "tech", "coding", "code", "programming", "programing",
      "computer", "computers", "robotics", "robot", "software", "engineering", "engineer",
      "hackathon", "developer", "apps", "ai", "artificial intelligence", "building apps",
      "machine learning", "electronics", "hardware", "esports", "chess",
    ],
    Mathematics: [
      "mathematics", "mathematic", "math", "maths", "number", "numbers", "numerical",
      "calculus", "algebra", "geometry", "statistics", "working with numbers",
      "problem solving", "logic", "data", "equations", "counting", "quantitative",
      "actuary", "proofs", "finance", "financial", "investing", "investment", "stocks",
      "stock market", "accounting", "budgeting", "economics", "economy",
    ],
    Arts: [
      "arts", "art", "music", "musical", "drawing", "paint", "painting", "creative",
      "creativity", "design", "theater", "theatre", "drama", "writing", "poetry", "film",
      "visual", "performing", "photography", "dance", "singing", "storytelling",
      "debate", "public speaking", "speech",
    ],
    Finance: [
      "finance", "financial", "investing", "investment", "stocks", "stock market",
      "accounting", "budgeting", "economics", "economy", "trading", "portfolio",
    ],
  };

  const OTHER_INFERENCE_MAP = [
    { phrases: ["counting", "numbers", "budgeting", "math", "algebra", "calculus"], topics: ["Mathematics"] },
    { phrases: ["investing", "stocks", "finance", "financial", "accounting", "economics", "trading"], topics: ["Mathematics", "Finance"] },
    { phrases: ["debate", "public speaking", "speech", "oratory"], topics: ["Arts"] },
    { phrases: ["chess", "esports", "gaming", "video game"], topics: ["Technology"] },
    { phrases: ["coding", "programming", "robotics", "hackathon", "computer"], topics: ["Technology"] },
    { phrases: ["biology", "chemistry", "physics", "science fair", "research"], topics: ["Science"] },
    { phrases: ["music", "art", "dance", "theater", "writing", "poetry", "film"], topics: ["Arts"] },
  ];

  const US_STATE_ABBREVS = {
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

  function levenshtein(a, b) {
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

  function normalizeInterestText(text) {
    return text.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  }

  function textMatchesKeyword(text, keyword) {
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

  function getCompetitionField(competition, keys) {
    for (const key of keys) {
      const value = competition[key];
      if (value !== null && value !== undefined && String(value).trim() !== "") {
        return String(value);
      }
    }
    return "";
  }

  function getCompetitionSearchText(competition) {
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

  function inferTopicsFromOtherText(otherText) {
    if (!otherText.trim()) return [];
    const inferred = new Set();
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

  function inferTopicsFromInputs(inputs) {
    const selected = inputs.selectedTopics.filter((t) => t !== "Other");
    const inferredFromOther = inputs.selectedTopics.includes("Other")
      ? inferTopicsFromOtherText(inputs.otherText)
      : [];
    const allTopics = [...new Set([...selected, ...inferredFromOther])];
    const inferredTopics = inferredFromOther.filter((t) => !selected.includes(t));
    return { topics: allTopics.length ? allTopics : selected, inferredTopics };
  }

  function competitionMatchesOtherText(competition, otherText) {
    if (!otherText) return false;
    const normalizedText = normalizeInterestText(otherText);
    const competitionText = getCompetitionSearchText(competition);
    if (!competitionText || !normalizedText) return false;
    if (competitionText.includes(normalizedText) || normalizedText.includes(competitionText)) return true;
    const searchWords = normalizedText.split(" ").filter((word) => word.length >= 3);
    return searchWords.some((word) => textMatchesKeyword(competitionText, word));
  }

  function competitionMatchesTopic(competition, topic, otherText = "") {
    if (topic === "Other") return competitionMatchesOtherText(competition, otherText);
    const searchText = getCompetitionSearchText(competition);
    const keywords = INTEREST_TOPICS[topic] ?? [];
    const topicField = getCompetitionField(competition, ["topic", "topics", "subject", "category"]);
    if (topicField && textMatchesKeyword(topicField, topic)) return true;
    return (
      textMatchesKeyword(searchText, topic) ||
      keywords.some((keyword) => textMatchesKeyword(searchText, keyword))
    );
  }

  function normalizeLocation(text) {
    let normalized = normalizeInterestText(text);
    for (const [name, abbrev] of Object.entries(US_STATE_ABBREVS)) {
      normalized = normalized.replace(new RegExp(`\\b${name}\\b`, "g"), abbrev);
    }
    return normalized;
  }

  function parseAgeNumber(value) {
    const match = String(value).match(/\d+/);
    return match ? parseInt(match[0], 10) : null;
  }

  function parseAgeRange(text) {
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

  function fieldMatchesSearch(competition, searchValue, keys) {
    if (!searchValue) return true;
    const search = searchValue.toLowerCase();
    const fieldValue = getCompetitionField(competition, keys).toLowerCase();
    if (!fieldValue) return false;
    return fieldValue.includes(search) || search.includes(fieldValue);
  }

  function scoreAge(competition, userAge) {
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

  function parseGradeNumber(text) {
    const match = String(text).match(/\d+/);
    return match ? parseInt(match[0], 10) : null;
  }

  function parseGradeRange(text) {
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

  function scoreGrade(competition, userGrade) {
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

  function scoreLocation(competition, userLocation) {
    if (!userLocation) return 1;
    const userNorm = normalizeLocation(userLocation);
    const locText = normalizeLocation(getCompetitionField(competition, ["location", "city", "region", "state", "address", "town"]));
    if (!locText) return 0.7;
    if (locText.includes(userNorm) || userNorm.includes(locText)) return 1;
    const userTokens = userNorm.split(" ").filter((t) => t.length >= 3);
    const locTokens = locText.split(" ").filter((t) => t.length >= 3);
    for (const ut of userTokens) {
      for (const lt of locTokens) {
        if (ut === lt) return 1;
        if (ut.length >= 3 && lt.length >= 3 && levenshtein(ut, lt) <= 2) return 0.8;
      }
    }
    return 0.2;
  }

  function scoreFormat(competition, format) {
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

  function getMatchedTopicsForCompetition(competition, topics, otherText) {
    const matched = [];
    for (const topic of topics) {
      if (topic === "Other") {
        if (competitionMatchesOtherText(competition, otherText)) matched.push("Other");
      } else if (competitionMatchesTopic(competition, topic, otherText)) {
        matched.push(topic);
      }
    }
    return matched;
  }

  function getCompetitionId(competition) {
    return String(
      competition.id ??
        competition.uuid ??
        getCompetitionField(competition, ["name", "title", "competition_name", "link"]),
    );
  }

  function scoreCompetition(competition, inputs, topics) {
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

    const ageScore = scoreAge(competition, inputs.age);
    const gradeScore = scoreGrade(competition, inputs.grade);
    const locationScore = scoreLocation(competition, inputs.location);

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

    return {
      competition: {
        ...competition,
        _matchedTopics: matchedTopics.length ? matchedTopics : effectiveTopics.slice(0, 1),
      },
      score,
    };
  }

  function rankCompetitions(competitions, inputs) {
    const { topics } = inferTopicsFromInputs(inputs);
    const searchTopics = inputs.selectedTopics.includes("Other") && topics.length === 0
      ? ["Other"]
      : [...topics, ...(inputs.selectedTopics.includes("Other") ? ["Other"] : [])];
    const uniqueTopics = [...new Set(searchTopics)];
    const scored = [];
    const seen = new Set();

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

  function discoverLocally(competitions, inputs) {
    const { topics, inferredTopics } = inferTopicsFromInputs(inputs);
    const scored = rankCompetitions(competitions, inputs);
    const matched = scored.slice(0, MAX_RESULTS).map((s) => s.competition);

    const displayTopics = inputs.selectedTopics.filter((t) => t !== "Other").length
      ? inputs.selectedTopics.filter((t) => t !== "Other")
      : topics;

    const bannerParts = [];
    if (matched.length) {
      bannerParts.push(`Showing ${matched.length} competition${matched.length === 1 ? "" : "s"} for: ${displayTopics.join(", ") || "your interests"}.`);
    }
    if (inferredTopics.length) {
      bannerParts.push(`Inferred from your interests: ${inferredTopics.join(", ")}.`);
    }
    if (matched.length < MIN_RESULTS) {
      bannerParts.push(
        `Only ${matched.length} match${matched.length === 1 ? "" : "es"} found locally. Deploy the Edge Function for web search fallback.`,
      );
    }

    return {
      competitions: matched,
      topics: displayTopics,
      inferredTopics,
      hasExactMatches: matched.length > 0,
      banner: bannerParts.join(" "),
      usedFallback: true,
    };
  }

  return {
    MIN_RESULTS,
    MAX_RESULTS,
    inferTopicsFromInputs,
    rankCompetitions,
    discoverLocally,
  };
})();
