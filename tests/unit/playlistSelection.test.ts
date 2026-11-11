import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearPlaylistTrackPreview,
  activatePlaylistTrackImmediately,
  getLyricsModeAfterTrackLoad,
  getMediaFrontAfterTrackChange,
  PLAYLIST_TRACK_PREVIEW_DELAY_MS,
  schedulePlaylistTrackPreview,
  shouldSchedulePlaylistTrackPreview
} from '../../src/renderer/playlist/playlistSelection';

afterEach(() => {
  vi.useRealTimers();
});

describe('playlist track selection display modes', () => {
  it('preserves the current lyrics or cover view when selecting an audio track', () => {
    expect(getMediaFrontAfterTrackChange('lyrics', false)).toBe('lyrics');
    expect(getMediaFrontAfterTrackChange('cover', false)).toBe('cover');
  });

  it('switches to cover for video tracks', () => {
    expect(getMediaFrontAfterTrackChange('lyrics', true)).toBe('cover');
    expect(getMediaFrontAfterTrackChange('cover', true)).toBe('cover');
  });

  it('preserves the chosen lyric timing mode when timed lyrics are available', () => {
    expect(getLyricsModeAfterTrackLoad('synchronized', true)).toBe('synchronized');
    expect(getLyricsModeAfterTrackLoad('static', true)).toBe('static');
  });

  it('falls back to static lyrics if timed lyrics are unavailable', () => {
    expect(getLyricsModeAfterTrackLoad('synchronized', false)).toBe('static');
    expect(getLyricsModeAfterTrackLoad('static', false)).toBe('static');
  });
});

describe('playlist single-click preview', () => {
  it('previews on an unmodified single click but not on multi-select or double-click events', () => {
    expect(shouldSchedulePlaylistTrackPreview({
      detail: 1,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false
    })).toBe(true);
    expect(shouldSchedulePlaylistTrackPreview({
      detail: 1,
      shiftKey: true,
      ctrlKey: false,
      metaKey: false
    })).toBe(false);
    expect(shouldSchedulePlaylistTrackPreview({
      detail: 1,
      shiftKey: false,
      ctrlKey: true,
      metaKey: false
    })).toBe(false);
    expect(shouldSchedulePlaylistTrackPreview({
      detail: 2,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false
    })).toBe(false);
  });

  it('does not start playback immediately and previews the selected track after the delay', () => {
    vi.useFakeTimers();
    const timerRef = { current: null as number | null };
    const playTrack = vi.fn();

    schedulePlaylistTrackPreview(2, timerRef, playTrack);
    expect(playTrack).not.toHaveBeenCalled();

    vi.advanceTimersByTime(PLAYLIST_TRACK_PREVIEW_DELAY_MS - 1);
    expect(playTrack).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(playTrack).toHaveBeenCalledWith(2, { shouldPlay: false });
    expect(timerRef.current).toBeNull();
  });

  it('cancels the previous preview when a different track is selected', () => {
    vi.useFakeTimers();
    const timerRef = { current: null as number | null };
    const playTrack = vi.fn();

    schedulePlaylistTrackPreview(1, timerRef, playTrack);
    schedulePlaylistTrackPreview(3, timerRef, playTrack);
    vi.advanceTimersByTime(PLAYLIST_TRACK_PREVIEW_DELAY_MS);

    expect(playTrack).toHaveBeenCalledOnce();
    expect(playTrack).toHaveBeenCalledWith(3, { shouldPlay: false });
  });

  it('cancels pending preview when playback starts by another action', () => {
    vi.useFakeTimers();
    const timerRef = { current: null as number | null };
    const playTrack = vi.fn();

    schedulePlaylistTrackPreview(1, timerRef, playTrack);
    clearPlaylistTrackPreview(timerRef);
    vi.advanceTimersByTime(PLAYLIST_TRACK_PREVIEW_DELAY_MS);

    expect(playTrack).not.toHaveBeenCalled();
    expect(timerRef.current).toBeNull();
  });

  it('starts playback immediately on an unmodified double-click and cancels preview', () => {
    const timerRef = { current: 123 as number | null };
    const selectTrack = vi.fn();
    const playTrack = vi.fn();
    const preventDefault = vi.fn();
    const event = {
      detail: 2,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault
    };

    activatePlaylistTrackImmediately(4, event, timerRef, selectTrack, playTrack);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(timerRef.current).toBeNull();
    expect(selectTrack).toHaveBeenCalledWith(4);
    expect(playTrack).toHaveBeenCalledWith(4);
  });

  it('does not start playback on a modified double-click', () => {
    const timerRef = { current: null as number | null };
    const selectTrack = vi.fn();
    const playTrack = vi.fn();

    activatePlaylistTrackImmediately(2, {
      detail: 2,
      shiftKey: true,
      ctrlKey: false,
      metaKey: false
    }, timerRef, selectTrack, playTrack);

    expect(selectTrack).not.toHaveBeenCalled();
    expect(playTrack).not.toHaveBeenCalled();
  });
});
