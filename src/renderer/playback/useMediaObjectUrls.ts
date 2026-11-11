import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Playlist, Track } from '../types';

type UseMediaObjectUrlsOptions = {
  tracks: Track[];
  playlists: Playlist[];
  activeMediaRef: MutableRefObject<HTMLMediaElement | null>;
  setTracks: Dispatch<SetStateAction<Track[]>>;
  setPlaylists: Dispatch<SetStateAction<Playlist[]>>;
};

export function useMediaObjectUrls({
  tracks,
  playlists,
  activeMediaRef,
  setTracks,
  setPlaylists
}: UseMediaObjectUrlsOptions) {
  const tracksRef = useRef(tracks);
  const playlistsRef = useRef(playlists);
  const ownedUrlsRef = useRef(new Set<string>());
  const cleanupTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  tracksRef.current = tracks;
  playlistsRef.current = playlists;

  function revoke(url: string) {
    if (!ownedUrlsRef.current.delete(url)) return;
    try {
      URL.revokeObjectURL(url);
    } catch (error) {
      console.warn('Unable to release media object URL', error);
    }
  }

  function releaseUnreferenced() {
    const referencedUrls = new Set<string>();
    for (const track of tracksRef.current) {
      if (track.src?.startsWith('blob:')) referencedUrls.add(track.src);
      if (track.backingSrc?.startsWith('blob:')) referencedUrls.add(track.backingSrc);
    }
    for (const playlist of playlistsRef.current) {
      for (const track of playlist.tracks) {
        if (track.src?.startsWith('blob:')) referencedUrls.add(track.src);
        if (track.backingSrc?.startsWith('blob:')) referencedUrls.add(track.backingSrc);
      }
    }

    const activeMedia = activeMediaRef.current;
    const activeSource = activeMedia?.getAttribute('src') || activeMedia?.currentSrc || '';
    if (activeSource.startsWith('blob:')) referencedUrls.add(activeSource);

    for (const url of ownedUrlsRef.current) {
      if (!referencedUrls.has(url)) revoke(url);
    }
  }

  function createMediaObjectUrl(blob: Blob): string | null {
    const url = URL.createObjectURL(blob);
    if (!mountedRef.current) {
      URL.revokeObjectURL(url);
      return null;
    }
    ownedUrlsRef.current.add(url);
    return url;
  }

  function scheduleCleanup() {
    if (cleanupTimerRef.current !== null) {
      window.clearTimeout(cleanupTimerRef.current);
    }
    cleanupTimerRef.current = window.setTimeout(() => {
      cleanupTimerRef.current = null;
      releaseUnreferenced();
    }, 0);
  }

  function updateTrackSourceReferences(trackId: string, src: string, file?: File) {
    setTracks(currentTracks => currentTracks.map(track => track.id === trackId
      ? { ...track, src, ...(file ? { file } : {}) }
      : track));
    setPlaylists(currentPlaylists => {
      let changed = false;
      const updatedPlaylists = currentPlaylists.map(playlist => ({
        ...playlist,
        tracks: playlist.tracks.map(track => {
          if (track.id !== trackId) return track;
          changed = true;
          return { ...track, src, ...(file ? { file } : {}) };
        })
      }));
      return changed ? updatedPlaylists : currentPlaylists;
    });
    scheduleCleanup();
  }

  useEffect(() => {
    releaseUnreferenced();
  }, [tracks, playlists]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (cleanupTimerRef.current !== null) {
        window.clearTimeout(cleanupTimerRef.current);
        cleanupTimerRef.current = null;
      }
      for (const url of ownedUrlsRef.current) revoke(url);
    };
  }, []);

  return {
    createMediaObjectUrl,
    scheduleCleanup,
    updateTrackSourceReferences
  };
}
