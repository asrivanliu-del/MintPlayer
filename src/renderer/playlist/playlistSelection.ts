import type { MutableRefObject } from 'react';

export type MediaFront = 'lyrics' | 'cover';
export type LyricsMode = 'static' | 'synchronized';
export type TrackActivationEvent = {
  detail?: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  preventDefault?: () => void;
};

export const PLAYLIST_TRACK_PREVIEW_DELAY_MS = 350;

export function getMediaFrontAfterTrackChange(current: MediaFront, isVideo: boolean): MediaFront {
  return isVideo ? 'cover' : current;
}

export function getLyricsModeAfterTrackLoad(current: LyricsMode, hasTimedLyrics: boolean): LyricsMode {
  return hasTimedLyrics ? current : 'static';
}

export function clearPlaylistTrackPreview(timerRef: MutableRefObject<number | null>) {
  if (timerRef.current === null) return;
  window.clearTimeout(timerRef.current);
  timerRef.current = null;
}

export function shouldSchedulePlaylistTrackPreview(event: TrackActivationEvent): boolean {
  return !event.shiftKey && !event.ctrlKey && !event.metaKey && (event.detail ?? 1) <= 1;
}

export function schedulePlaylistTrackPreview(
  index: number,
  timerRef: MutableRefObject<number | null>,
  playTrack: (index: number, options: { shouldPlay: false }) => void
) {
  clearPlaylistTrackPreview(timerRef);
  timerRef.current = window.setTimeout(() => {
    timerRef.current = null;
    playTrack(index, { shouldPlay: false });
  }, PLAYLIST_TRACK_PREVIEW_DELAY_MS);
}

export function activatePlaylistTrackImmediately(
  index: number,
  event: TrackActivationEvent,
  timerRef: MutableRefObject<number | null>,
  selectTrack: (index: number) => void,
  playTrack: (index: number) => void | Promise<void>
) {
  event.preventDefault?.();
  if (event.shiftKey || event.ctrlKey || event.metaKey) return;
  clearPlaylistTrackPreview(timerRef);
  selectTrack(index);
  void playTrack(index);
}
