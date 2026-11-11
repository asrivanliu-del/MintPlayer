import type { ElectronOnlineLyricsResult } from './electronApi';

type LyricsOvhTrack = {
  id?: number;
  title?: string;
  duration?: number;
  artist?: { name?: string };
};

function normalizeTitle(value: string) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

async function requestJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(url, {
    headers: { 'User-Agent': 'MintPlayer/0.1.0 (desktop lyrics lookup)' },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`Lyrics.ovh returned HTTP ${response.status}.`);
  return response.json();
}

async function getLyrics(
  title: string,
  artist: string,
  fetcher: typeof fetch
): Promise<ElectronOnlineLyricsResult | null> {
  const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
  const payload = await requestJson(url, fetcher);
  if (typeof payload !== 'object' || payload === null || !('lyrics' in payload)) return null;
  const lyrics = (payload as { lyrics?: unknown }).lyrics;
  if (typeof lyrics !== 'string' || !lyrics.trim()) return null;
  return {
    id: 0,
    trackName: title,
    artistName: artist,
    albumName: '',
    duration: null,
    plainLyrics: lyrics.trim(),
    syncedLyrics: '',
    source: 'Lyrics.ovh'
  };
}

export async function searchLyricsOvh(
  title: string,
  artist: string,
  fallbackQuery: string,
  fetcher: typeof fetch = globalThis.fetch
): Promise<{ result: ElectronOnlineLyricsResult | null; error?: string }> {
  const normalizedTitle = title.trim();
  const normalizedArtist = artist.trim();
  const errors: string[] = [];

  if (normalizedTitle && normalizedArtist) {
    try {
      const result = await getLyrics(normalizedTitle, normalizedArtist, fetcher);
      if (result) return { result };
    } catch (error) {
      errors.push(String(error));
    }
  }

  const query = fallbackQuery.trim() || [normalizedTitle, normalizedArtist].filter(Boolean).join(' ');
  if (!query) return { result: null };

  try {
    const payload = await requestJson(
      `https://api.lyrics.ovh/suggest/${encodeURIComponent(query)}`,
      fetcher
    );
    if (typeof payload !== 'object' || payload === null || !('data' in payload)) {
      throw new Error('Lyrics.ovh returned an invalid song search response.');
    }
    const data = (payload as { data?: unknown }).data;
    if (!Array.isArray(data)) throw new Error('Lyrics.ovh returned an invalid song list.');

    const expectedTitle = normalizeTitle(normalizedTitle);
    const candidates = (data as LyricsOvhTrack[])
      .filter(track => typeof track.title === 'string' && typeof track.artist?.name === 'string')
      .sort((left, right) => {
        const score = (track: LyricsOvhTrack) => {
          const actualTitle = normalizeTitle(track.title || '');
          if (!expectedTitle) return 0;
          if (actualTitle === expectedTitle) return 2;
          return actualTitle.includes(expectedTitle) || expectedTitle.includes(actualTitle) ? 1 : 0;
        };
        return score(right) - score(left);
      })
      .slice(0, 5);

    for (const candidate of candidates) {
      try {
        const result = await getLyrics(candidate.title!, candidate.artist!.name!, fetcher);
        if (result) {
          if (typeof candidate.id === 'number' && Number.isFinite(candidate.id)) result.id = candidate.id;
          if (typeof candidate.duration === 'number' && Number.isFinite(candidate.duration)) {
            result.duration = candidate.duration;
          }
          return { result };
        }
      } catch (error) {
        errors.push(String(error));
      }
    }
  } catch (error) {
    errors.push(String(error));
  }

  return errors.length
    ? { result: null, error: errors.join(' ') }
    : { result: null };
}
