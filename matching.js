/* Shared competition matching logic (browser fallback when Edge Function unavailable). */
const DiscoveryMatching = (() => {
  const TARGET_RESULTS = 10;
  const MAX_RESULTS = 10;

  const INTEREST_TOPICS = {
    Science: [
      "science", "sciences", "biology", "chemistry", "physics", "lab", "laboratory",
      "experiment", "research", "nature", "environment", "science fair", "scientist",
      "medicine", "anatomy", "ecology", "astronomy", "space",
    ],
    Technology: [
      "technology", "tech", "coding", "programming", "computer", "computers", "robotics",
      "robot", "software", "engineering", "engineer", "hackathon", "developer", "apps",
      "artificial intelligence", "machine learning", "electronics", "hardware", "esports",
    ],
    Mathematics: [
      "mathematics", "math", "maths", "calculus", "algebra", "geometry", "statistics",
      "quantitative", "actuary", "proofs", "finance", "financial", "investing",
      "stock market", "accounting", "budgeting", "economics", "olympiad",
    ],
    Arts: [
      "arts", "art", "music", "musical", "drawing", "painting", "creative", "design",
      "theater", "theatre", "drama", "writing", "poetry", "poem", "recitation", "out loud",
      "film", "visual", "performing", "photography", "dance", "singing", "storytelling",
      "debate", "public speaking", "speech",
    ],
    Finance: [
      "finance", "financial", "investing", "investment", "stocks", "stock market",
      "accounting", "budgeting", "economics", "trading", "portfolio",
    ],
  };

  const TOPIC_FIELD_ALIASES = {
    science: "Science", sciences: "Science", technology: "Technology", tech: "Technology",
    mathematics: "Mathematics", math: "Mathematics", maths: "Mathematics",
    arts: "Arts", art: "Arts", music: "Arts", poetry: "Arts", drama: "Arts",
    "art & creative writing": "Arts", "history & humanities": "Arts", history: "Arts",
    humanities: "Arts",
    finance: "Finance", financial: "Finance", economics: "Finance", stem: "Science",
  };

  const TOPIC_NEGATIVE_KEYWORDS = {
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

  function getCanonicalTopicFromField(competition) {
    const topicField = normalizeInterestText(
      getCompetitionField(competition, ["topic", "topics", "subject", "category"]),
    );
    if (!topicField) return null;
    if (TOPIC_FIELD_ALIASES[topicField]) return TOPIC_FIELD_ALIASES[topicField];
    for (const [alias, canonical] of Object.entries(TOPIC_FIELD_ALIASES)) {
      if (topicField.includes(alias)) return canonical;
    }
    for (const canonical of ["Science", "Technology", "Mathematics", "Arts", "Finance"]) {
      if (textMatchesKeyword(topicField, canonical)) return canonical;
    }
    return null;
  }

  function topicConflictsWithNegativeSignals(topic, searchText) {
    const negatives = TOPIC_NEGATIVE_KEYWORDS[topic] ?? [];
    return negatives.some((phrase) => searchText.includes(normalizeInterestText(phrase)));
  }

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
    const name = normalizeInterestText(
      getCompetitionField(competition, ["name", "title", "competition_name"]),
    );
    const link = normalizeInterestText(getCompetitionField(competition, ["link", "url"]));
    if (!competitionText || !normalizedText) return false;
    if (competitionText.includes(normalizedText) || link.includes(normalizedText.replace(/\s+/g, ""))) {
      return true;
    }
    if (textMatchesKeyword(link, normalizedText)) return true;
    const queryTokens = normalizedText.split(" ").filter((word) => word.length >= 2);
    const nameTokens = name.split(" ").filter((word) => word.length >= 2);
    const significant = queryTokens.filter((word) => word.length >= 3);
    if (significant.length) {
      const allSignificantMatch = significant.every(
        (token) =>
          textMatchesKeyword(competitionText, token) ||
          nameTokens.some((nameToken) => {
            if (token === nameToken || token.includes(nameToken) || nameToken.includes(token)) return true;
            const longer = Math.max(token.length, nameToken.length);
            const maxDistance = longer <= 5 ? 1 : longer <= 9 ? 2 : 3;
            return levenshtein(token, nameToken) <= maxDistance;
          }),
      );
      if (allSignificantMatch) return true;
    }
    if (normalizedText.length >= 5 && textMatchesKeyword(name, normalizedText)) return true;
    return queryTokens.filter((word) => word.length >= 3).some((word) => textMatchesKeyword(competitionText, word));
  }

  function competitionMatchesTopic(competition, topic, otherText = "") {
    if (topic === "Other") return competitionMatchesOtherText(competition, otherText);

    const searchText = getCompetitionSearchText(competition);
    if (topicConflictsWithNegativeSignals(topic, searchText)) return false;

    const canonicalField = getCanonicalTopicFromField(competition);

    if (canonicalField) {
      if (topic === "Finance") return canonicalField === "Finance" || canonicalField === "Mathematics";
      if (canonicalField === topic) return true;
    }

    const keywords = INTEREST_TOPICS[topic] ?? [];
    const strongHit = keywords.some((keyword) => keyword.length >= 4 && textMatchesKeyword(searchText, keyword));
    if (strongHit) return true;

    return textMatchesKeyword(searchText, topic);
  }

  function normalizeLocation(text) {
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

  function extractStates(text) {
    const normalized = normalizeLocation(text);
    const states = new Set();
    for (const [name, abbrev] of Object.entries(US_STATE_ABBREVS)) {
      if (new RegExp(`\\b${name}\\b`).test(normalized) || new RegExp(`\\b${abbrev}\\b`).test(normalized)) {
        states.add(abbrev);
      }
    }
    return [...states];
  }

  function isOnlineOrNationalCompetition(competition, searchText) {
    const compFormat = getCompetitionField(competition, ["format", "delivery", "mode", "type"]).toLowerCase();
    const compLoc = getCompetitionField(competition, ["location", "city", "region", "state", "address", "town"]).toLowerCase();
    const combined = `${searchText} ${compLoc} ${compFormat}`;
    if (compFormat.includes("online") || compFormat.includes("virtual") || compFormat.includes("remote")) {
      return true;
    }
    return NATIONAL_LOCATION_SIGNALS.some((signal) => combined.includes(signal));
  }

  function locationMatchesUser(competition, userLocation, userFormat = "") {
    if (!userLocation.trim()) return true;

    const compLoc = getCompetitionField(competition, ["location", "city", "region", "state", "address", "town"]);
    const searchText = getCompetitionSearchText(competition);
    const onlineNational = isOnlineOrNationalCompetition(competition, searchText);
    const userWantsOnline = userFormat === "online";
    const userWantsInPerson = userFormat === "in-person";

    if (onlineNational && userWantsOnline) return true;
    if (onlineNational && !userWantsInPerson && !compLoc) return true;
    if (!compLoc) return false;

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

  function parseAgeNumber(value) {
    const trimmed = String(value).trim();
    if (!trimmed || /-/.test(trimmed)) return null;
    const match = trimmed.match(/^\d+/);
    if (!match) return null;
    const n = parseInt(match[0], 10);
    if (!Number.isFinite(n) || n < 1 || n > 25) return null;
    return n;
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
    const trimmed = String(text).trim();
    if (!trimmed || /-/.test(trimmed)) return null;
    const match = trimmed.match(/^\d+/);
    if (!match) return null;
    const n = parseInt(match[0], 10);
    if (!Number.isFinite(n) || n < 1 || n > 12) return null;
    return n;
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

  function scoreLocation(competition, userLocation, userFormat = "") {
    if (!userLocation) return 1;
    if (!locationMatchesUser(competition, userLocation, userFormat)) return 0;
    const userNorm = normalizeLocation(userLocation);
    const locText = normalizeLocation(getCompetitionField(competition, ["location", "city", "region", "state", "address", "town"]));
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

  function inferFormatFromText(text) {
    const normalized = normalizeInterestText(text);
    if (/\bonline\b|\bvirtual\b|\bremote\b|\bwebinar\b|\bzoom\b/.test(normalized)) {
      return "online";
    }
    if (/\bin person\b|\bin-person\b|\blocal (school|schools|chapter|test center|testing center)\b|\bonsite\b/.test(normalized)) {
      return "in-person";
    }
    return "both";
  }

  function resolveCompetitionFormat(competition) {
    const name = getCompetitionField(competition, ["name", "title"]);
    const details = getCompetitionField(competition, ["details", "description", "summary", "about"]);
    const location = getCompetitionField(competition, ["location", "city", "region", "state"]);
    const link = getCompetitionField(competition, ["link", "url"]);
    const stored = getCompetitionField(competition, ["format", "delivery", "mode", "type"]).toLowerCase();
    const titleLower = name.toLowerCase();

    if (/devpost\.com/i.test(link)) return "online";
    if (/\bonline\b/.test(titleLower) || /^virtual\b/.test(titleLower)) return "online";

    const fromText = inferFormatFromText(`${name} ${details} ${location}`);
    if (fromText === "online") return "online";
    if (fromText === "in-person") return "in-person";

    if (stored.includes("online") || stored.includes("virtual") || stored.includes("remote")) return "online";
    if (stored.includes("in-person") || stored.includes("in person")) return "in-person";
    if (stored.includes("both") || stored.includes("hybrid")) return "both";

    return stored || "both";
  }

  function scoreFormat(competition, format) {
    if (!format) return 1;
    const competitionFormat = resolveCompetitionFormat(competition).toLowerCase();
    const text = normalizeInterestText(getCompetitionSearchText(competition));
    const normalizedFormat = format.toLowerCase();

    if (normalizedFormat === "online") {
      if (competitionFormat.includes("online") || competitionFormat.includes("virtual") || competitionFormat.includes("remote")) {
        return 1;
      }
      if (competitionFormat === "both" || competitionFormat.includes("hybrid")) {
        return /\bonline\b|\bvirtual\b|\bremote\b/.test(text) ? 1 : 0.5;
      }
      return 0;
    }

    if (normalizedFormat === "in-person") {
      if (competitionFormat.includes("in-person") || competitionFormat.includes("in person")) return 1;
      if (competitionFormat === "both" || competitionFormat.includes("hybrid")) {
        if (/\bonline\b|\bvirtual\b|\bremote\b/.test(text) && !/\blocal (school|schools|chapter)\b/.test(text)) {
          return 0;
        }
        if (/\blocal (school|schools|chapter|test center)\b|\bin person\b|\bin-person\b/.test(text)) {
          return 1;
        }
        return 0;
      }
      return 0;
    }

    if (competitionFormat === "both" || competitionFormat.includes("hybrid")) return 1;
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
    };
  }

  function getUserSearchTopics(inputs) {
    const selected = inputs.selectedTopics.filter((t) => t !== "Other");
    if (selected.length) return selected;
    return inferTopicsFromInputs(inputs).topics;
  }

  function rankCompetitions(competitions, inputs) {
    const userTopics = getUserSearchTopics(inputs);
    const searchTopics = inputs.selectedTopics.includes("Other") ? [...userTopics, "Other"] : userTopics;
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

  function isCompetitionUpcoming(competition) {
    const months = {
      january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
      may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7, september: 8,
      sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
    };
    const scheduleText = [
      getCompetitionField(competition, ["time", "date", "deadline"]),
      getCompetitionField(competition, ["details", "description", "summary", "about"]),
      getCompetitionField(competition, ["name", "title"]),
    ].join(" ");

    if (!scheduleText.trim()) return true;
    if (/\b(was held|took place|registration closed|deadline passed|winners announced|students? won)\b/i.test(scheduleText)) {
      return false;
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yearMatches = [...scheduleText.matchAll(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{4})\b/gi)];

    for (const match of yearMatches) {
      const month = months[match[1].toLowerCase().replace(/\./g, "")];
      const year = Number(match[2]);
      if (month !== undefined) {
        const date = new Date(year, month, 1);
        if (date >= today) return true;
        if (date < today) return false;
      }
    }

    const timeField = getCompetitionField(competition, ["time", "date", "deadline"]);
    const monthMatch = timeField.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\b/i);
    if (monthMatch) {
      const month = months[monthMatch[1].toLowerCase().replace(/\./g, "")];
      if (month !== undefined) {
        const year = now.getMonth() > month ? now.getFullYear() + 1 : now.getFullYear();
        return new Date(year, month, 1) >= today;
      }
    }

    return true;
  }

  function discoverLocally(competitions, inputs) {
    const { topics, inferredTopics } = inferTopicsFromInputs(inputs);
    const scored = rankCompetitions(competitions, inputs)
      .filter((entry) => isCompetitionUpcoming(entry.competition));
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
    if (matched.length < TARGET_RESULTS) {
      bannerParts.push(
        `Found ${matched.length} match${matched.length === 1 ? "" : "es"} for your area and topics. Deploy the Edge Function for web search to fill up to ${TARGET_RESULTS}.`,
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
    TARGET_RESULTS,
    MAX_RESULTS,
    inferTopicsFromInputs,
    rankCompetitions,
    discoverLocally,
  };
})();
