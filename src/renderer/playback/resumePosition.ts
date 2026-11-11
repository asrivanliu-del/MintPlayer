import type { PlaybackResumePosition } from '../types';

const PLAYBACK_RESUME_STORAGE_KEY = 'playbackResumePosition';

export function readPlaybackResumePosition(): PlaybackResumePosition | null {
  try {
    const raw = localStorage.getItem(PLAYBACK_RESUME_STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;

    const candidate = value as Partial<PlaybackResumePosition>;
    if (
      typeof candidate.playlistName !== 'string' ||
      typeof candidate.trackId !== 'string' ||
      typeof candidate.trackName !== 'string' ||
      typeof candidate.time !== 'number' ||
      !Number.isFinite(candidate.time) ||
      candidate.time < 0
    ) return null;

    return {
      playlistName: candidate.playlistName,
      trackId: candidate.trackId,
      trackPath: typeof candidate.trackPath === 'string' ? candidate.trackPath : undefined,
      trackName: candidate.trackName,
      time: candidate.time,
      backingActive: candidate.backingActive === true
    };
  } catch (error) {
    console.warn('Unable to read saved playback position', error);
    return null;
  }
}

export function writePlaybackResumePosition(position: PlaybackResumePosition) {
  try {
    localStorage.setItem(PLAYBACK_RESUME_STORAGE_KEY, JSON.stringify(position));
  } catch (error) {
    console.warn('Unable to save playback position', error);
  }
}
