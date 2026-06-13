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

function isHttpImageUrl(url: string): boolean {
  const trimmed = String(url || "").trim();
  if (!trimmed || trimmed.startsWith("data:image/svg")) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function faviconForCompetitionLink(link: string): string {
  try {
    const host = new URL(link).hostname;
    if (!host) return "";
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
  } catch {
    return "";
  }
}

/** Real image only: stored URL, Serper thumbnail, or site favicon — never generated placeholders. */
export function resolveCompetitionImage(existingImage: string, link: string): string {
  const existing = String(existingImage || "").trim();
  if (isHttpImageUrl(existing)) return existing;

  const favicon = link ? faviconForCompetitionLink(link) : "";
  return isHttpImageUrl(favicon) ? favicon : "";
}

export class ImageAllocator {
  /** Kept for compatibility — returns real images only, allows shared favicons across cards. */
  assign(primary: string, _fallbackName: string, _fallbackTopic: string, fallbackLink: string): string {
    return resolveCompetitionImage(primary, fallbackLink);
  }
}
