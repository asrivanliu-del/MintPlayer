export const MEDIA_DOWNLOADER_RECENTS_KEY = 'mediaDownloaderRecentUrls';
export const MEDIA_DOWNLOADER_RECENTS_LIMIT = 3;

export type RecentVideoUrl = {
  url: string;
  title: string;
  thumbnailUrl?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseRecentVideoUrls(value: string | null): RecentVideoUrl[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .flatMap((item): RecentVideoUrl[] => {
        if (typeof item === 'string') {
          const url = item.trim();
          return url ? [{ url, title: url }] : [];
        }
        if (!isRecord(item)) return [];
        const entry = item;
        if (typeof entry.url !== 'string') return [];
        const url = entry.url.trim();
        if (!url) return [];
        const title = typeof entry.title === 'string' && entry.title.trim()
          ? entry.title.trim()
          : url;
        const thumbnailUrl = typeof entry.thumbnailUrl === 'string' && entry.thumbnailUrl.trim()
          ? entry.thumbnailUrl.trim()
          : undefined;
        return [{ url, title, ...(thumbnailUrl ? { thumbnailUrl } : {}) }];
      })
      .filter((item, index, items) => items.findIndex(candidate => candidate.url === item.url) === index)
      .slice(0, MEDIA_DOWNLOADER_RECENTS_LIMIT);
  } catch {
    return [];
  }
}

export function addRecentVideoUrl(
  recentUrls: RecentVideoUrl[],
  url: string,
  title: string,
  thumbnailUrl?: string | null
): RecentVideoUrl[] {
  const normalizedUrl = url.trim();
  if (!normalizedUrl) return recentUrls.slice(0, MEDIA_DOWNLOADER_RECENTS_LIMIT);
  const existing = recentUrls.find(recentUrl => recentUrl.url === normalizedUrl);
  const normalizedThumbnailUrl = thumbnailUrl?.trim() || existing?.thumbnailUrl;
  return [
    {
      url: normalizedUrl,
      title: title.trim() || normalizedUrl,
      ...(normalizedThumbnailUrl ? { thumbnailUrl: normalizedThumbnailUrl } : {})
    },
    ...recentUrls.filter(recentUrl => recentUrl.url !== normalizedUrl)
  ].slice(0, MEDIA_DOWNLOADER_RECENTS_LIMIT);
}
