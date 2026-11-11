import { useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Track } from '../types';
import { hasElectronCapability } from '../../electron/electronApi';
import { getTrackCoverCacheKey, TRACK_COVER_CACHE_LIMIT, TRACK_COVER_LOAD_CONCURRENCY } from './coverUtils';
import { TRACK_ROW_STRIDE } from '../playlist/playlistUtils';
import { parseAudioBlob } from '../metadata/parseAudioBlob';

type UseCoverCacheOptions = {
  tracks: Track[];
  current: number | null;
  selected: number | null;
  showCover: boolean;
  trackListRef: MutableRefObject<HTMLUListElement | null>;
  trackVirtualWindow: { start: number; end: number };
  isVideoTrack: (track: Track | null | undefined) => boolean;
  setLogs: Dispatch<SetStateAction<string[]>>;
};

export function useCoverCache({
  tracks,
  current,
  selected,
  showCover,
  trackListRef,
  trackVirtualWindow,
  isVideoTrack,
  setLogs
}: UseCoverCacheOptions) {
  const [trackCoverCache, setTrackCoverCache] = useState<Map<string, string>>(() => new Map());
  const trackCoverCacheRef = useRef(trackCoverCache);
  const trackCoverLastUsedRef = useRef(new Map<string, number>());
  const trackCoverAccessSequenceRef = useRef(0);
  const visibleCoverQueueRef = useRef<Track[]>([]);
  const activeCoverLoadsRef = useRef(0);
  const coverLoadRequestsRef = useRef(new Map<string, Promise<void>>());
  const attemptedCoverLoadsRef = useRef(new Set<string>());

  useEffect(() => () => {
    for (const coverUrl of trackCoverCacheRef.current.values()) {
      if (coverUrl.startsWith('blob:')) URL.revokeObjectURL(coverUrl);
    }
  }, []);

  function touchTrackCoverCacheKey(cacheKey: string) {
    if (trackCoverCacheRef.current.has(cacheKey)) {
      trackCoverAccessSequenceRef.current += 1;
      trackCoverLastUsedRef.current.set(cacheKey, trackCoverAccessSequenceRef.current);
    }
  }

  function cacheTrackCover(cacheKey: string, coverUrl: string) {
    const currentCache = trackCoverCacheRef.current;
    if (currentCache.has(cacheKey)) {
      if (coverUrl !== currentCache.get(cacheKey) && coverUrl.startsWith('blob:')) {
        URL.revokeObjectURL(coverUrl);
      }
      touchTrackCoverCacheKey(cacheKey);
      return;
    }

    const nextCache = new Map(currentCache);
    nextCache.set(cacheKey, coverUrl);
    trackCoverAccessSequenceRef.current += 1;
    trackCoverLastUsedRef.current.set(cacheKey, trackCoverAccessSequenceRef.current);

    while (nextCache.size > TRACK_COVER_CACHE_LIMIT) {
      let leastRecentlyUsedKey: string | undefined;
      let leastRecentlyUsedAt = Number.POSITIVE_INFINITY;
      for (const key of nextCache.keys()) {
        const lastUsedAt = trackCoverLastUsedRef.current.get(key) ?? 0;
        if (lastUsedAt < leastRecentlyUsedAt) {
          leastRecentlyUsedAt = lastUsedAt;
          leastRecentlyUsedKey = key;
        }
      }
      if (leastRecentlyUsedKey === undefined) break;

      const evictedCover = nextCache.get(leastRecentlyUsedKey);
      nextCache.delete(leastRecentlyUsedKey);
      trackCoverLastUsedRef.current.delete(leastRecentlyUsedKey);
      attemptedCoverLoadsRef.current.delete(leastRecentlyUsedKey);
      if (evictedCover?.startsWith('blob:')) URL.revokeObjectURL(evictedCover);
    }

    trackCoverCacheRef.current = nextCache;
    setTrackCoverCache(nextCache);
  }

  async function extractCoverFromFile(file: File | Blob): Promise<string | null> {
    try {
      const metadata = await parseAudioBlob(file);
      const picture = metadata?.common?.picture?.[0];
      if (!picture) return null;
      return URL.createObjectURL(new Blob([picture.data as BlobPart], { type: picture.format || 'image/jpeg' }));
    } catch (error) {
      console.warn('music metadata parse failed', error);
      setLogs(logs => [...logs, `cover metadata parse failed: ${String(error)}`]);
      return null;
    }
  }

  async function loadTrackCover(track: Track): Promise<void> {
    if (track.cover || isVideoTrack(track)) return;
    const cacheKey = getTrackCoverCacheKey(track);
    const existingRequest = coverLoadRequestsRef.current.get(cacheKey);
    if (existingRequest) return existingRequest;
    if (attemptedCoverLoadsRef.current.has(cacheKey)) return;

    const request = (async () => {
      attemptedCoverLoadsRef.current.add(cacheKey);
      try {
        let cover: string | null = null;
        const api = window.electronAPI;
        if (track.path && hasElectronCapability(api, 'getCover')) {
          const result = await api.getCover(track.path);
          if (!result.ok) throw new Error(result.error || `Could not read cover for ${track.name}`);
          if (result.coverBase64) {
            const binary = atob(result.coverBase64);
            const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
            cover = URL.createObjectURL(new Blob([bytes], { type: result.mime || 'image/jpeg' }));
          }
        } else if (track.file) {
          cover = await extractCoverFromFile(track.file);
        } else if (track.path && hasElectronCapability(api, 'readFile')) {
          const result = await api.readFile(track.path);
          if (!result.ok || !result.data) throw new Error(result.error || `Could not read ${track.name}`);
          const binary = atob(result.data);
          const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
          cover = await extractCoverFromFile(new Blob([bytes], { type: result.mime || 'application/octet-stream' }));
        } else {
          throw new Error('File access is unavailable');
        }

        if (cover) cacheTrackCover(cacheKey, cover);
      } catch (error) {
        console.warn(`Unable to read cover for ${track.name}`, error);
        setLogs(logs => [...logs, `cover read failed for ${track.name}: ${String(error)}`]);
      }
    })();

    coverLoadRequestsRef.current.set(cacheKey, request);
    try {
      await request;
    } finally {
      if (coverLoadRequestsRef.current.get(cacheKey) === request) {
        coverLoadRequestsRef.current.delete(cacheKey);
      }
    }
  }

  function pumpVisibleCoverQueue() {
    while (
      activeCoverLoadsRef.current < TRACK_COVER_LOAD_CONCURRENCY &&
      visibleCoverQueueRef.current.length > 0
    ) {
      const track = visibleCoverQueueRef.current.shift();
      if (!track) break;
      const cacheKey = getTrackCoverCacheKey(track);
      if (
        track.cover ||
        trackCoverCacheRef.current.has(cacheKey) ||
        isVideoTrack(track) ||
        attemptedCoverLoadsRef.current.has(cacheKey) ||
        coverLoadRequestsRef.current.has(cacheKey)
      ) continue;

      activeCoverLoadsRef.current += 1;
      void loadTrackCover(track).finally(() => {
        activeCoverLoadsRef.current -= 1;
        pumpVisibleCoverQueue();
      });
    }
  }

  useEffect(() => {
    const list = trackListRef.current;
    if (!showCover || !list) {
      visibleCoverQueueRef.current = [];
      return;
    }

    const firstVisible = Math.max(0, Math.floor(list.scrollTop / TRACK_ROW_STRIDE));
    const lastVisible = Math.min(
      tracks.length,
      Math.ceil((list.scrollTop + list.clientHeight) / TRACK_ROW_STRIDE)
    );
    const visibleTracks = tracks.slice(firstVisible, lastVisible);
    visibleTracks.forEach(track => touchTrackCoverCacheKey(getTrackCoverCacheKey(track)));
    const activeIndex = current ?? selected;
    if (activeIndex !== null && tracks[activeIndex]) {
      touchTrackCoverCacheKey(getTrackCoverCacheKey(tracks[activeIndex]));
    }
    visibleCoverQueueRef.current = visibleTracks.filter(track => {
      const cacheKey = getTrackCoverCacheKey(track);
      return !track.cover &&
        !trackCoverCacheRef.current.has(cacheKey) &&
        !isVideoTrack(track) &&
        !attemptedCoverLoadsRef.current.has(cacheKey) &&
        !coverLoadRequestsRef.current.has(cacheKey);
    });
    pumpVisibleCoverQueue();
  }, [tracks, current, selected, trackCoverCache, trackVirtualWindow.start, trackVirtualWindow.end, showCover]);

  return { trackCoverCache, extractCoverFromFile };
}

export function useFullResolutionCover(
  track: Track | null,
  cacheKey: string | null,
  showCover: boolean,
  isVideoTrack: (track: Track | null | undefined) => boolean,
  extractCoverFromFile: (file: File | Blob) => Promise<string | null>,
  setLogs: Dispatch<SetStateAction<string[]>>
) {
  const [fullResolutionCover, setFullResolutionCover] = useState<{ key: string; url: string } | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestRef.current;
    let disposed = false;
    let createdCoverUrl: string | null = null;

    if (!showCover || !track || !cacheKey || isVideoTrack(track) || track.cover) {
      setFullResolutionCover(null);
      return;
    }

    setFullResolutionCover(null);
    const loadFullResolutionCover = async () => {
      try {
        let imageBlob: Blob | null = null;
        const api = window.electronAPI;
        if (track.path && hasElectronCapability(api, 'getCover')) {
          const result = await api.getCover(track.path, false);
          if (!result.ok) throw new Error(result.error || `Could not read cover for ${track.name}`);
          if (result.coverBase64) {
            const binary = atob(result.coverBase64);
            const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
            imageBlob = new Blob([bytes], { type: result.mime || 'image/jpeg' });
          }
        } else if (track.file) {
          const coverUrl = await extractCoverFromFile(track.file);
          if (coverUrl) {
            if (disposed || requestId !== requestRef.current) {
              URL.revokeObjectURL(coverUrl);
              return;
            }
            createdCoverUrl = coverUrl;
            setFullResolutionCover({ key: cacheKey, url: coverUrl });
            return;
          }
        } else if (track.path && hasElectronCapability(api, 'readFile')) {
          const result = await api.readFile(track.path);
          if (!result.ok || !result.data) throw new Error(result.error || `Could not read ${track.name}`);
          const binary = atob(result.data);
          const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
          const coverUrl = await extractCoverFromFile(new Blob([bytes], { type: result.mime || 'application/octet-stream' }));
          if (coverUrl) {
            if (disposed || requestId !== requestRef.current) {
              URL.revokeObjectURL(coverUrl);
              return;
            }
            createdCoverUrl = coverUrl;
            setFullResolutionCover({ key: cacheKey, url: coverUrl });
            return;
          }
        }

        if (!imageBlob) return;
        const coverUrl = URL.createObjectURL(imageBlob);
        if (disposed || requestId !== requestRef.current) {
          URL.revokeObjectURL(coverUrl);
          return;
        }
        createdCoverUrl = coverUrl;
        setFullResolutionCover({ key: cacheKey, url: coverUrl });
      } catch (error) {
        console.warn(`Unable to load full-resolution cover for ${track.name}`, error);
        setLogs(logs => [...logs, `full-resolution cover read failed for ${track.name}: ${String(error)}`]);
      }
    };

    void loadFullResolutionCover();
    return () => {
      disposed = true;
      if (createdCoverUrl?.startsWith('blob:')) URL.revokeObjectURL(createdCoverUrl);
    };
  }, [track?.id, track?.path, track?.cover, track?.file, cacheKey, showCover]);

  return fullResolutionCover;
}
