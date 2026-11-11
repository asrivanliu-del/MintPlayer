import type { OnlineLyricsResult, Track, TrackPathHints } from '../types';

export const METADATA_RESULTS_PER_PAGE = 9;
export const TRACK_ROW_HEIGHT = 58;
export const TRACK_ROW_GAP = 8;
export const TRACK_ROW_STRIDE = TRACK_ROW_HEIGHT + TRACK_ROW_GAP;
export const TRACK_LIST_OVERSCAN = 6;
export const TRACK_LIST_VIRTUALIZATION_THRESHOLD = 100;

export function getTrackFilePath(track: Pick<Track, 'id' | 'path' | 'src'>): string | undefined {
  if (track.path) return track.path;
  if (track.id.startsWith('path:')) return track.id.slice('path:'.length) || undefined;
  if (!track.src) return undefined;

  try {
    const source = new URL(track.src);
    if (source.protocol === 'music:') {
      const encodedPath = source.pathname.startsWith('/') ? source.pathname.slice(1) : source.pathname;
      return decodeURIComponent(encodedPath) || undefined;
    }
    if (source.protocol === 'file:') {
      const filePath = decodeURIComponent(source.pathname);
      return filePath.replace(/^\/([A-Za-z]:[\\/])/, '$1') || undefined;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function serializePlaylistTracks(tracks: Track[]) {
  return tracks.map(track => ({
    id: track.id,
    name: track.name,
    path: track.path,
    src: track.src,
    cover: track.cover,
    bitrate: track.bitrate,
    resolution: track.resolution
  }));
}

export function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function titleMatchScore(actual: string, expected: string): number {
  const normalizedActual = normalizeSearchText(actual);
  const normalizedExpected = normalizeSearchText(expected);
  if (!normalizedActual || !normalizedExpected) return 0;
  if (normalizedActual === normalizedExpected) return 2;
  return ` ${normalizedActual} `.includes(` ${normalizedExpected} `) ? 1 : 0;
}

export function countMetadataMatches(
  result: Pick<OnlineLyricsResult, 'trackName' | 'artistName' | 'albumName'>,
  hints: { title: string; artist: string; album: string }
): number {
  const matches = [
    [result.trackName, hints.title, true],
    [result.artistName, hints.artist, false],
    [result.albumName, hints.album, true]
  ] as const;
  return matches.reduce((count, [actual, expected, allowPartial]) => {
    const normalizedActual = normalizeSearchText(actual);
    const normalizedExpected = normalizeSearchText(expected);
    if (!normalizedActual || !normalizedExpected) return count;
    return count + Number(
      normalizedActual === normalizedExpected ||
      (allowPartial && (normalizedActual.includes(normalizedExpected) || normalizedExpected.includes(normalizedActual)))
    );
  }, 0);
}

export function parseTrackPathHints(filePath?: string): TrackPathHints {
  const emptyHints: TrackPathHints = { title: '', artist: '', album: '', year: '', track: '' };
  if (!filePath) return emptyHints;

  const parts = filePath.split(/[\\/]+/).filter(Boolean);
  if (parts.length < 4) return emptyHints;
  const filename = parts[parts.length - 1];
  const stem = filename.replace(/\.[^.]+$/, '');
  const trackMatch = /^\s*(\d{1,3})(?:[\s._-]+|$)(.*)$/.exec(stem);
  const albumFolder = parts[parts.length - 2];
  const yearMatch = /^\s*((?:19|20)\d{2})(?:[\s._-]+|$)(.*)$/.exec(albumFolder);

  return {
    title: (trackMatch?.[2] || stem).trim(),
    artist: parts[parts.length - 3],
    album: (yearMatch?.[2] || albumFolder).trim(),
    year: yearMatch?.[1] || '',
    track: trackMatch?.[1] || ''
  };
}
