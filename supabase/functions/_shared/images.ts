const TOPIC_HUES: Record<string, number> = {
  Science: 145,
  Mathematics: 220,
  "Art & Creative Writing": 310,
  "History & Humanities": 28,
  "Law & Government": 250,
  Finance: 170,
  Other: 200,
};

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function escapeSvg(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function faviconDomain(url: string): string {
  try {
    const parsed = new URL(url);
    const domainMatch = parsed.search.match(/[?&]domain=([^&]+)/i);
    if (domainMatch) return decodeURIComponent(domainMatch[1]).toLowerCase();
    return parsed.hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function generateCompetitionPlaceholder(
  name: string,
  topic: string,
  link: string,
): string {
  const label = String(name || "Competition").trim();
  const initial = label.replace(/^[^a-z0-9]+/i, "").charAt(0).toUpperCase() || "?";
  const hue = TOPIC_HUES[topic] ?? (hashString(`${topic}:${link}`) % 360);
  const accent = (hue + 36) % 360;
  const safeLabel = label.length > 28 ? `${label.slice(0, 25)}…` : label;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="hsl(${hue} 55% 28%)"/>
        <stop offset="100%" stop-color="hsl(${accent} 60% 18%)"/>
      </linearGradient>
    </defs>
    <rect width="320" height="180" fill="url(#bg)" rx="16"/>
    <circle cx="56" cy="90" r="34" fill="rgba(255,255,255,0.14)"/>
    <text x="56" y="102" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="34" font-weight="700" fill="#ffffff">${initial}</text>
    <text x="112" y="88" font-family="Inter,Arial,sans-serif" font-size="15" font-weight="700" fill="#ffffff">${escapeSvg(safeLabel)}</text>
    <text x="112" y="112" font-family="Inter,Arial,sans-serif" font-size="12" fill="rgba(255,255,255,0.82)">${escapeSvg(topic || "Competition")}</text>
  </svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export class ImageAllocator {
  private used = new Set<string>();
  private usedFaviconDomains = new Set<string>();

  assign(primary: string, fallbackName: string, fallbackTopic: string, fallbackLink: string): string {
    let chosenPrimary = String(primary || "").trim();
    const domain = faviconDomain(chosenPrimary);

    if (domain && this.usedFaviconDomains.has(domain)) {
      chosenPrimary = "";
    }

    const candidates = [
      chosenPrimary,
      generateCompetitionPlaceholder(fallbackName, fallbackTopic, fallbackLink),
    ].filter(Boolean);

    for (const candidate of candidates) {
      const candidateDomain = faviconDomain(candidate);
      if (candidateDomain && this.usedFaviconDomains.has(candidateDomain)) {
        continue;
      }
      if (!this.used.has(candidate)) {
        this.used.add(candidate);
        if (candidateDomain) this.usedFaviconDomains.add(candidateDomain);
        return candidate;
      }
    }

    const uniquePlaceholder = generateCompetitionPlaceholder(
      `${fallbackName}-${this.used.size}`,
      fallbackTopic,
      `${fallbackLink}#${this.used.size}`,
    );
    this.used.add(uniquePlaceholder);
    return uniquePlaceholder;
  }
}
