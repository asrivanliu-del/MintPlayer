import type { Track } from '../types';

export const TRACK_COVER_CACHE_LIMIT = 100;
export const TRACK_COVER_LOAD_CONCURRENCY = 4;

export function getTrackCoverCacheKey(track: Track) {
  return track.path ? `path:${track.path}` : track.id;
}
